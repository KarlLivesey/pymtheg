// SPDX-License-Identifier: MIT
/**
 * Build constraints of Go files, only as far as is needed to tell whether two
 * files can be built in one configuration (`//go:build` or a legacy `+build`
 * line, and `_GOOS`/`_GOARCH` filename suffixes). Nothing here selects one
 * configuration; an expression it cannot read is unknown.
 */
import {
  KNOWN_GOARCH,
  KNOWN_GOOS,
  PORTS,
  PORT_GOARCH,
  PORT_GOOS,
  type FileFact,
} from "./model.js";

export type Formula =
  | { k: "t" }
  | { k: "v"; n: string }
  | { k: "not"; x: Formula }
  | { k: "and"; a: Formula; b: Formula }
  | { k: "or"; a: Formula; b: Formula };

const TRUE: Formula = { k: "t" };
const and = (a: Formula, b: Formula): Formula =>
  a.k === "t" ? b : b.k === "t" ? a : { k: "and", a, b };
/** A `//go:build` expression; undefined when it cannot be read. */
function parseExpression(text: string): Formula | undefined {
  const tokens = text.match(/\|\||&&|!|\(|\)|[A-Za-z0-9_.]+|\S/g) ?? [];
  let at = 0;
  const or = (): Formula | undefined => {
    let left = andExpr();
    while (left && tokens[at] === "||") {
      at++;
      const right = andExpr();
      left = right ? { k: "or", a: left, b: right } : undefined;
    }
    return left;
  };
  const andExpr = (): Formula | undefined => {
    let left = unary();
    while (left && tokens[at] === "&&") {
      at++;
      const right = unary();
      left = right ? { k: "and", a: left, b: right } : undefined;
    }
    return left;
  };
  const unary = (): Formula | undefined => {
    const token = tokens[at++];
    if (token === "!") {
      const inner = unary();
      return inner ? { k: "not", x: inner } : undefined;
    }
    if (token === "(") {
      const inner = or();
      return tokens[at++] === ")" ? inner : undefined;
    }
    return token !== undefined && /^[A-Za-z0-9_.]+$/.test(token)
      ? { k: "v", n: token }
      : undefined;
  };
  const result = or();
  return at === tokens.length ? result : undefined;
}

/** A legacy `+build` line: space-separated options of comma-joined terms. */
function parseLegacy(text: string): Formula | undefined {
  let any: Formula | undefined;
  for (const option of text.trim().split(/\s+/)) {
    let all: Formula = TRUE;
    for (const term of option.split(",")) {
      const negated = term.startsWith("!");
      const name = negated ? term.slice(1) : term;
      if (!/^[A-Za-z0-9_.]+$/.test(name)) return undefined;
      const value: Formula = { k: "v", n: name };
      all = and(all, negated ? { k: "not", x: value } : value);
    }
    any = any ? { k: "or", a: any, b: all } : all;
  }
  return any;
}

/** Real cgo enablement, apart from the `cgo` tag (not a valid tag name). */
const CGO_ENABLED = "cgo!enabled";
const withCgo = (formula: Formula): Formula => {
  switch (formula.k) {
    case "v":
      return formula.n === "cgo"
        ? { k: "or", a: formula, b: { k: "v", n: CGO_ENABLED } }
        : formula;
    case "not":
      return { k: "not", x: withCgo(formula.x) };
    case "and":
    case "or":
      return { k: formula.k, a: withCgo(formula.a), b: withCgo(formula.b) };
    default:
      return formula;
  }
};

/** The file's constraint (TRUE: none); undefined when it cannot be read. */
export function fileConstraint(fact: FileFact): Formula | undefined {
  let formula: Formula = TRUE;
  if (fact.build !== undefined) {
    if (fact.build.startsWith("+build ")) {
      // Legacy lines, one per line: all of them hold.
      for (const line of fact.build.split("\n")) {
        const parsed = line.startsWith("+build ")
          ? parseLegacy(line.slice("+build ".length))
          : undefined;
        if (!parsed) return undefined;
        formula = and(formula, parsed);
      }
    } else {
      const parsed = parseExpression(fact.build);
      if (!parsed) return undefined;
      formula = parsed;
    }
  }
  // The `cgo` tag holds when cgo is enabled or `-tags=cgo` sets it by hand;
  // a cgo file (`import "C"`) is built only when cgo is really enabled.
  formula = withCgo(formula);
  if (fact.imports.some((item) => item.path === "C"))
    formula = and(formula, { k: "v", n: CGO_ENABLED });
  if (fact.goos !== undefined) formula = and(formula, { k: "v", n: fact.goos });
  if (fact.goarch !== undefined)
    formula = and(formula, { k: "v", n: fact.goarch });
  return formula;
}

function names(formula: Formula, out: Set<string>): Set<string> {
  if (formula.k === "v") out.add(formula.n);
  else if (formula.k === "not") names(formula.x, out);
  else if (formula.k === "and" || formula.k === "or") {
    names(formula.a, out);
    names(formula.b, out);
  }
  return out;
}

/**
 * Is there an assignment of the named tags, each one free (a GOOS or GOARCH
 * name too: `-tags=freebsd` sets `freebsd` on Linux), in which every formula
 * holds, with one of Go's port GOOS values and one of its GOARCH values
 * true (every build has its own)? Every real configuration is such an
 * assignment, so false proves no build has them all. A backtracking search
 * over the names, pruned as soon as a formula is decided; undefined when it
 * takes more than `MAX_STEPS` steps.
 */
export function satisfiableAnyTags(given: Formula[]): boolean | undefined {
  const key = JSON.stringify(given);
  if (anyTagsMemo.has(key)) return anyTagsMemo.get(key);
  const answer = searchAnyTags(given);
  if (anyTagsMemo.size > MAX_MEMO) anyTagsMemo.clear();
  anyTagsMemo.set(key, answer);
  return answer;
}
const anyTagsMemo = new Map<string, boolean | undefined>();
const MAX_MEMO = 100_000;

/** Does `a` imply `b` in every build (free tags, ports)? Undefined: not known. */
export function impliesAnyTags(a: Formula, b: Formula): boolean | undefined {
  const counter = satisfiableAnyTags([a, { k: "not", x: b }]);
  return counter === undefined ? undefined : !counter;
}

function searchAnyTags(given: Formula[]): boolean | undefined {
  const anyOf = (values: string[]): Formula =>
    values
      .map((n): Formula => ({ k: "v", n }))
      .reduce((a, b) => ({ k: "or", a, b }));
  return searchWith(
    [...given, anyOf(PORT_GOOS), anyOf(PORT_GOARCH)],
    new Map(),
  );
}

/**
 * Is there an ordinary build, one that sets reserved names only as Go does
 * (a real port's GOOS and GOARCH with the names they imply, real cgo on or
 * off with the `cgo` tag equal to it; release and custom tags free), in which
 * every formula holds? Used where a build that exists only because a
 * reserved name is set by hand must not count (a call with no declaration
 * there does not compile, and no build has another answer).
 */
export function satisfiableOrdinary(given: Formula[]): boolean | undefined {
  const key = `o\u0000${JSON.stringify(given)}`;
  if (anyTagsMemo.has(key)) return anyTagsMemo.get(key);
  let answer: boolean | undefined = false;
  for (const port of PORTS) {
    const [goos, goarch] = port.split("/") as [string, string];
    for (const cgo of [false, true]) {
      const preset = new Map<string, boolean>();
      for (const name of KNOWN_GOOS) preset.set(name, false);
      for (const name of KNOWN_GOARCH) preset.set(name, false);
      preset.set(goos, true);
      if (IMPLIED_GOOS[goos]) preset.set(IMPLIED_GOOS[goos]!, true);
      preset.set(goarch, true);
      preset.set("unix", UNIX_GOOS.has(goos));
      preset.set("cgo", cgo);
      preset.set(CGO_ENABLED, cgo);
      const found = searchWith(given, preset);
      if (found) {
        answer = true;
        break;
      }
      if (found === undefined) answer = undefined;
    }
    if (answer === true) break;
  }
  if (anyTagsMemo.size > MAX_MEMO) anyTagsMemo.clear();
  anyTagsMemo.set(key, answer);
  return answer;
}
/** GOOS values whose builds also set another GOOS tag (go/build). */
const IMPLIED_GOOS: { [goos: string]: string } = {
  android: "linux",
  ios: "darwin",
  illumos: "solaris",
};
/** GOOS values that set the `unix` tag (go/build). */
const UNIX_GOOS = new Set([
  "aix",
  "android",
  "darwin",
  "dragonfly",
  "freebsd",
  "hurd",
  "illumos",
  "ios",
  "linux",
  "netbsd",
  "openbsd",
  "solaris",
]);

/** A backtracking search over the names not in `preset`. */
function searchWith(
  formulas: Formula[],
  preset: Map<string, boolean>,
): boolean | undefined {
  const all = [
    ...formulas.reduce((out, f) => names(f, out), new Set<string>()),
  ].filter((name) => !preset.has(name));
  const value = new Map<string, boolean>(preset);
  // Three-valued: undefined while a name it needs is not assigned.
  const partial = (formula: Formula): boolean | undefined => {
    switch (formula.k) {
      case "t":
        return true;
      case "v":
        return value.get(formula.n);
      case "not": {
        const inner = partial(formula.x);
        return inner === undefined ? undefined : !inner;
      }
      case "and": {
        const a = partial(formula.a);
        if (a === false) return false;
        const b = partial(formula.b);
        if (b === false) return false;
        return a && b ? true : undefined;
      }
      case "or": {
        const a = partial(formula.a);
        if (a === true) return true;
        const b = partial(formula.b);
        if (b === true) return true;
        return a === false && b === false ? false : undefined;
      }
    }
  };
  let steps = 0;
  const search = (at: number): boolean | undefined => {
    if (++steps > MAX_STEPS) return undefined;
    let open = false;
    for (const formula of formulas) {
      const known = partial(formula);
      if (known === false) return false;
      if (known === undefined) open = true;
    }
    if (!open) return true;
    const name = all[at]!;
    let unknown = false;
    for (const choice of [true, false]) {
      value.set(name, choice);
      const found = search(at + 1);
      if (found) {
        value.delete(name);
        return true;
      }
      if (found === undefined) unknown = true;
    }
    value.delete(name);
    return unknown ? undefined : false;
  };
  return search(0);
}
/** Above this many search steps `satisfiableAnyTags` is not computed (unknown). */
const MAX_STEPS = 1 << 16;
