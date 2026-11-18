// SPDX-License-Identifier: MIT
/**
 * Build constraints of Go files, only as far as is needed to tell whether two
 * files can be built in one configuration (`//go:build` or a legacy `+build`
 * line, and `_GOOS`/`_GOARCH` filename suffixes). Nothing here selects one
 * configuration; an expression it cannot read is unknown.
 */
import { KNOWN_GOARCH, KNOWN_GOOS, type FileFact } from "./model.js";

export type Formula =
  | { k: "t" }
  | { k: "v"; n: string }
  | { k: "not"; x: Formula }
  | { k: "and"; a: Formula; b: Formula }
  | { k: "or"; a: Formula; b: Formula };

const TRUE: Formula = { k: "t" };
const and = (a: Formula, b: Formula): Formula =>
  a.k === "t" ? b : b.k === "t" ? a : { k: "and", a, b };
/** GOOS values that imply another GOOS tag. */
const IMPLIED: { [goos: string]: string } = {
  android: "linux",
  ios: "darwin",
  illumos: "solaris",
};
const UNIX = new Set([
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
/** Above this many free tags satisfiability is not computed (unknown). */
const MAX_FREE_TAGS = 10;

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

/** The file's constraint (TRUE: none); undefined when it cannot be read. */
export function fileConstraint(fact: FileFact): Formula | undefined {
  let formula: Formula = TRUE;
  if (fact.build !== undefined) {
    const parsed = fact.build.startsWith("+build ")
      ? parseLegacy(fact.build.slice("+build ".length))
      : parseExpression(fact.build);
    if (!parsed) return undefined;
    formula = parsed;
  }
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

function evaluate(formula: Formula, tags: Set<string>): boolean {
  switch (formula.k) {
    case "t":
      return true;
    case "v":
      return tags.has(formula.n);
    case "not":
      return !evaluate(formula.x, tags);
    case "and":
      return evaluate(formula.a, tags) && evaluate(formula.b, tags);
    case "or":
      return evaluate(formula.a, tags) || evaluate(formula.b, tags);
  }
}

/**
 * Is there one configuration (one GOOS, one GOARCH, any other tags) in which
 * every formula holds? Undefined when there are too many free tags.
 */
export function satisfiable(formulas: Formula[]): boolean | undefined {
  const all = new Set<string>();
  for (const formula of formulas) names(formula, all);
  const goos = [...all].filter((name) => KNOWN_GOOS.has(name));
  const goarch = [...all].filter((name) => KNOWN_GOARCH.has(name));
  const free = [...all].filter(
    (name) => !KNOWN_GOOS.has(name) && !KNOWN_GOARCH.has(name),
  );
  // Another GOOS than those named makes each named one false; it may still
  // be a Unix one (`unix` stays free then).
  const implied = Object.entries(IMPLIED)
    .filter(([, base]) => goos.includes(base))
    .map(([os]) => os);
  const oses = [...new Set([...goos, ...implied]), undefined];
  const arches = [...goarch, undefined];
  const unixFree = free.includes("unix");
  const freeTags = free.filter((name) => name !== "unix");
  if (freeTags.length > MAX_FREE_TAGS) return undefined;
  for (const os of oses)
    for (const arch of arches)
      for (let bits = 0; bits < 1 << freeTags.length; bits++) {
        const tags = new Set<string>();
        if (os) {
          tags.add(os);
          if (IMPLIED[os]) tags.add(IMPLIED[os]!);
        }
        if (arch) tags.add(arch);
        freeTags.forEach((name, index) => {
          if (bits & (1 << index)) tags.add(name);
        });
        const unixChoices = os
          ? [UNIX.has(os)]
          : unixFree
            ? [false, true]
            : [false];
        for (const unix of unixChoices) {
          const with_ = unix ? new Set([...tags, "unix"]) : tags;
          if (formulas.every((formula) => evaluate(formula, with_)))
            return true;
        }
      }
  return false;
}

/** Does `a` imply `b` in every configuration? Undefined when not known. */
export function implies(a: Formula, b: Formula): boolean | undefined {
  const counter = satisfiable([a, { k: "not", x: b }]);
  return counter === undefined ? undefined : !counter;
}
