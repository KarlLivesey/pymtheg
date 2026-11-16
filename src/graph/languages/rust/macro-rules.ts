// Token-level facts about `macro_rules!` definitions and macro invocation
// arguments. Nothing here expands a macro: it reads the token trees the one
// parse already produced and records what is provable from them. The resolver
// decides, per invocation, whether these facts apply (R1-K).
import type { Node } from "web-tree-sitter";

const compact = (s: string) => s.replace(/\s+/g, "").replace(/\br#/g, "");

/** Keywords that start an item or a binding when they open a statement. */
const ITEM_WORDS = new Set([
  "fn",
  "struct",
  "enum",
  "union",
  "trait",
  "impl",
  "mod",
  "use",
  "extern",
  "const",
  "static",
  "type",
  "macro_rules",
  "macro",
]);
/** Tokens that make an argument's names or call syntax unreadable without parsing. */
const ARGUMENT_HAZARDS = new Set([
  ...ITEM_WORDS,
  "let",
  "match",
  "for",
  "while",
  "loop",
  "async",
  "move",
  "|",
  "||",
  "=>",
  "$",
  "'",
  "#",
  "yield",
]);
/** Standard macros whose arguments are all expressions (optionally `name = expr`). */
export const formatStandardMacros = new Set([
  "print",
  "println",
  "eprint",
  "eprintln",
  "format",
  "format_args",
  "write",
  "writeln",
  "panic",
  "todo",
  "unreachable",
  "unimplemented",
  "assert",
  "assert_eq",
  "assert_ne",
  "debug_assert",
  "debug_assert_eq",
  "debug_assert_ne",
  "dbg",
  "vec",
]);
/** `matches!(expr, pattern)`: only the first piece is an expression. */
const FIRST_PIECE_ONLY = new Set(["matches"]);

export const standardFormatName = (path: string): string | null => {
  const m = /^(?:(?:::)?(?:std|core|alloc)::)?([a-z_]+)$/.exec(path);
  return m && (formatStandardMacros.has(m[1]!) || FIRST_PIECE_ONLY.has(m[1]!))
    ? m[1]!
    : null;
};

/** A token's word: keyword or identifier text; null for groups and others. */
function word(n: Node): string {
  if (n.type === "identifier") return compact(n.text);
  if (n.type === "token_tree" || n.type === "token_repetition") return "";
  return n.text;
}
const isGroup = (n: Node | undefined): boolean =>
  !!n && n.type === "token_tree";
const opens = (n: Node | undefined, c: string) =>
  !!n && isGroup(n) && n.children[0]?.type === c;
/** Group contents without delimiters or comments. */
export function inner(n: Node): Node[] {
  const cs = n.children.filter((c) => !c.type.endsWith("comment"));
  if (n.type === "token_repetition") {
    // `$ ( … ) sep? op`
    const close = cs.findIndex((c, i) => i > 1 && c.type === ")");
    return cs.slice(2, close < 0 ? cs.length : close);
  }
  const first = cs[0],
    last = cs.at(-1);
  const delimited =
    first && ["(", "[", "{"].includes(first.type) && last !== first;
  return delimited ? cs.slice(1, last?.isMissing ? cs.length : -1) : cs;
}
/** Top-level tokens with repetitions spliced in place (they expand in place). */
function flat(seq: Node[]): Node[] {
  return seq.flatMap((n) =>
    n.type === "token_repetition" ? flat(inner(n)) : [n],
  );
}
type PathAt = { start: number; segments: string[]; nodes: Node[] };
/** The path ending at index i (inclusive) of seq, walking back over `::`. */
function pathEndingAt(seq: Node[], i: number): PathAt | null {
  const nodes: Node[] = [];
  let j = i;
  for (;;) {
    const n = seq[j];
    if (
      !n ||
      !["identifier", "self", "super", "crate", "metavariable"].includes(n.type)
    )
      return null;
    nodes.unshift(n);
    if (seq[j - 1]?.type === "::") {
      nodes.unshift(seq[j - 1]!);
      j -= 2;
      continue;
    }
    if (n.type === "crate" && seq[j - 1]?.type === "$") {
      nodes.unshift(seq[j - 1]!);
      j -= 1;
    }
    break;
  }
  // A leading `::` (global path) belongs to the path too.
  if (seq[j - 1]?.type === "::" && nodes[0]?.type !== "::") {
    nodes.unshift(seq[j - 1]!);
    j -= 1;
  }
  const segments = nodes
    .filter((n) => n.type !== "::" && n.type !== "$")
    .map((n) =>
      n.type === "crate" && n.previousSibling?.type === "$"
        ? "$crate"
        : word(n),
    );
  if (nodes[0]?.type === "::") segments.unshift("");
  return { start: j, segments, nodes };
}

export type MacroCall = {
  /** Macro path as written, compacted (`$crate::x` kept). */
  name: string;
  node: Node;
  group: Node;
};
/** Nested invocations `path ! group` in one token sequence. */
function invocations(seq: Node[]): { at: number; call: MacroCall }[] {
  const found: { at: number; call: MacroCall }[] = [];
  for (let i = 1; i + 1 < seq.length; i++) {
    if (seq[i]!.type !== "!" || !isGroup(seq[i + 1])) continue;
    const path = pathEndingAt(seq, i - 1);
    if (!path) continue;
    found.push({
      at: path.start,
      call: {
        name: path.segments.join("::"),
        node: path.nodes.find((n) => n.type !== "::" && n.type !== "$")!,
        group: seq[i + 1]!,
      },
    });
  }
  return found;
}

export type MacroProfile = {
  /** Every arm was read. */
  readable: boolean;
  /** No arm emits an item or a `let` into the caller's scope, provided every
   * name in `nested` is itself neutral where the macro is invoked. */
  neutral: boolean;
  /** Macros invoked at the top level of some arm, as written. */
  nested: string[];
  /** Every arm that takes input passes all of it, unchanged and as the tail of
   * an argument list, to one of these macros; null when unproved. */
  forwards: string[] | null;
  /** Names bound by items in transcriber groups enclosing a forward site
   * (`*` when unknown). Call-site names in forwarded tokens may be shadowed. */
  forwardShadow: string[];
  /** Number of arms. Body facts are per macro, so several arms are unproved. */
  arms: number;
  /** Path calls written in code positions of the transcribers. */
  calls: {
    path: string;
    argumentCount: number;
    shadow: string[];
    /** A one-segment name in an arm that binds locals (may be one of them). */
    local: boolean;
  }[];
  /** Macros invoked in code positions of the transcribers (transitive calls). */
  bodyMacros: { name: string; shadow: string[] }[];
};

/** Names an item statement in `seq` binds, `*` when not readable. */
function itemNames(seq: Node[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    const w = word(seq[i]!);
    if (!ITEM_WORDS.has(w)) continue;
    if (w === "use") {
      let j = i + 1;
      const tree: Node[] = [];
      while (j < seq.length && seq[j]!.type !== ";") tree.push(seq[j++]!);
      const leaves = (ns: Node[]): void => {
        for (let k = 0; k < ns.length; k++) {
          const n = ns[k]!;
          if (isGroup(n)) leaves(inner(n));
          else if (n.type === "*" || n.type === "metavariable") names.push("*");
          else if (word(n) === "as" && ns[k + 1]) {
            names.pop();
            names.push(word(ns[k + 1]!));
            k++;
          } else if (
            ["identifier", "self", "super", "crate"].includes(n.type) &&
            ns[k + 1]?.type !== "::"
          )
            names.push(word(n));
        }
      };
      leaves(tree);
      i = j;
      continue;
    }
    if (w === "impl" || w === "extern") {
      // `extern crate x as y;` binds y; impl blocks bind nothing.
      if (w === "extern" && word(seq[i + 1] ?? seq[i]!) === "crate") {
        let j = i + 2;
        let name = seq[j] ? word(seq[j]!) : "*";
        if (seq[j + 1] && word(seq[j + 1]!) === "as")
          name = seq[j + 2] ? word(seq[j + 2]!) : "*";
        names.push(name || "*");
      } else if (w === "extern") names.push("*");
      continue;
    }
    const next = seq[i + (seq[i + 1]?.type === "!" ? 2 : 1)];
    if (!next || next.type === "metavariable") names.push("*");
    else if (next.type === "identifier") names.push(word(next));
  }
  return names;
}

/**
 * Pattern positions in a token sequence: after `let` to the `=`, `for` to
 * `in`, and match-arm heads up to `=>`. Calls are never recorded there.
 */
function patternMask(seq: Node[], arms: boolean): boolean[] {
  const mask = seq.map(() => false);
  let armStart = arms;
  for (let i = 0; i < seq.length; i++) {
    const w = word(seq[i]!);
    if (armStart) {
      let j = i;
      while (j < seq.length && seq[j]!.type !== "=>") mask[j++] = true;
      i = j;
      armStart = false;
      continue;
    }
    if (
      arms &&
      (seq[i]!.type === "," ||
        (isGroup(seq[i]) && opens(seq[i], "{") && seq[i - 1]?.type === "=>"))
    )
      armStart = seq[i]!.type === "," || seq[i + 1]?.type !== ",";
    if (w === "let" || w === "for") {
      const stop = w === "let" ? "=" : "in";
      let j = i + 1;
      while (j < seq.length && word(seq[j]!) !== stop && seq[j]!.type !== ";")
        mask[j++] = true;
      i = j;
    }
  }
  return mask;
}
const matchArmsGroup = (seq: Node[], i: number): boolean => {
  if (!opens(seq[i], "{")) return false;
  for (let j = i - 1; j >= 0; j--) {
    if (word(seq[j]!) === "match") return true;
    if (seq[j]!.type === ";" || opens(seq[j], "{")) return false;
  }
  return false;
};

/** Analyse one `macro_definition` node. */
export function macroProfile(definition: Node): MacroProfile {
  const rules = definition.namedChildren.filter((c) => c.type === "macro_rule");
  let readable = rules.length > 0,
    neutral = true;
  const nested = new Set<string>(),
    forwardTargets = new Set<string>(),
    forwardShadow = new Set<string>(),
    calls: MacroProfile["calls"] = [],
    bodyMacros: MacroProfile["bodyMacros"] = [];
  let forwards = true;
  for (const rule of rules) {
    const matcher = rule.childForFieldName("left"),
      body = rule.childForFieldName("right");
    if (!matcher || !body) {
      readable = false;
      continue;
    }
    // Fragment kinds by metavariable name.
    const kinds = new Map<string, string>();
    for (const b of matcher.descendantsOfType("token_binding_pattern")) {
      const v = b.namedChildren.find((c) => c.type === "metavariable"),
        k = b.namedChildren.find((c) => c.type === "fragment_specifier");
      if (v && k) kinds.set(v.text, k.text);
    }
    // Whole-input forwarding: the matcher is exactly `$($x:tt)*` (or `+`),
    // or empty. Any other matcher shape is left unproved.
    const m = inner(matcher).filter((c) => !c.type.endsWith("comment"));
    let whole: string | null = null;
    if (m.length === 1 && m[0]!.type === "token_repetition_pattern") {
      const parts = m[0]!.children.filter((c) => !c.type.endsWith("comment"));
      const bindings = parts.filter((c) => c.type === "token_binding_pattern");
      const op = parts.at(-1)?.type;
      if (
        bindings.length === 1 &&
        parts.length === 5 &&
        (op === "*" || op === "+") &&
        kinds.get(bindings[0]!.namedChildren[0]!.text) === "tt"
      )
        whole = bindings[0]!.namedChildren[0]!.text;
    }
    const takesInput = m.length > 0;
    let armForwards = false;
    // Neutrality: inspect the top level of the transcriber.
    const top = flat(inner(body));
    for (let i = 0; i < top.length; i++) {
      const n = top[i]!,
        w = word(n);
      // `if let`, `while let` and let chains bind only inside their block.
      const statementLet =
        w === "let" &&
        !["if", "while", "&&"].includes(top[i - 1] ? word(top[i - 1]!) : "");
      if (ITEM_WORDS.has(w) || statementLet || n.type === "#") neutral = false;
      if (n.type === "metavariable") {
        const kind = kinds.get(n.text);
        if (!kind || ["tt", "item", "stmt"].includes(kind)) neutral = false;
        if (top[i + 1]?.type === "!") neutral = false;
      }
    }
    for (const { call } of invocations(top))
      if (
        call.name.split("::").some((s) => s.startsWith("$") && s !== "$crate")
      )
        neutral = false;
      else nested.add(call.name);
    // Code positions: walk groups, skipping nested invocations other than the
    // standard format macros (their arguments are expressions).
    const armCalls: typeof calls = [];
    const bindsLocals = body
      .descendantsOfType(["let", "|", "||", "match", "for", "fn"])
      .some(() => true);
    const armMacros: typeof bodyMacros = [];
    const sites: { target: string; shadow: string[] }[] = [];
    let strayUse = false;
    const visitSeq = (seq: Node[], shadow: string[], arms: boolean) => {
      const here = [...shadow, ...itemNames(seq)];
      const mask = patternMask(seq, arms);
      const calls = invocations(seq);
      const skipped = new Set<number>();
      for (const { at, call } of calls) {
        const groupIndex = seq.indexOf(call.group);
        skipped.add(groupIndex);
        const contents = inner(call.group);
        const forwardIndex = contents.findIndex(
          (c) =>
            c.type === "token_repetition" &&
            inner(c).length === 1 &&
            inner(c)[0]!.text === whole,
        );
        if (whole && forwardIndex >= 0) {
          const before = contents[forwardIndex - 1];
          const repetition = contents[forwardIndex]!;
          const separator = repetition.children.filter(
            (c) => !c.type.endsWith("comment"),
          );
          const plain =
            separator.length === 5 &&
            ["*", "+"].includes(separator.at(-1)!.type);
          if (
            plain &&
            (!before || before.type === ",") &&
            forwardIndex === contents.length - 1
          ) {
            sites.push({ target: call.name, shadow: here });
            armForwards = true;
          }
        }
        if (whole)
          for (const v of call.group.descendantsOfType("metavariable"))
            if (v.text === whole && forwardIndex < 0) strayUse = true;
        const std = standardFormatName(call.name);
        // The forwarded repetition is accounted for above; read the rest.
        const forwarded =
          sites.at(-1)?.target === call.name && forwardIndex >= 0;
        if (std)
          visitSeq(
            forwarded
              ? contents.filter((_, i) => i !== forwardIndex)
              : contents,
            here,
            false,
          );
        else if (!call.name.includes("$") || call.name.startsWith("$crate::"))
          armMacros.push({ name: call.name, shadow: here });
        void at;
      }
      for (let i = 0; i < seq.length; i++) {
        const n = seq[i]!;
        if (isGroup(n)) {
          if (!skipped.has(i)) visitSeq(inner(n), here, matchArmsGroup(seq, i));
          if (opens(n, "(") && !mask[i] && !skipped.has(i)) {
            const path = pathEndingAt(seq, i - 1);
            const before = path ? seq[path.start - 1] : undefined;
            if (
              path &&
              !mask[path.start] &&
              !path.segments.some((s) => s.startsWith("$") && s !== "$crate") &&
              before?.type !== "." &&
              !(before && ITEM_WORDS.has(word(before)))
            )
              armCalls.push({
                local: bindsLocals && path.segments.length === 1,
                path: path.segments.join("::"),
                argumentCount: pieces(inner(n), false).filter((p) => p.length)
                  .length,
                shadow: here,
              });
          }
        } else if (n.type === "token_repetition")
          visitSeq(inner(n), here, false);
        else if (whole && n.type === "metavariable" && n.text === whole)
          strayUse = true;
      }
    };
    visitSeq(inner(body), [], false);
    if (takesInput && (!armForwards || strayUse)) forwards = false;
    for (const s of sites) {
      forwardTargets.add(s.target);
      for (const x of s.shadow) forwardShadow.add(x);
    }
    calls.push(...armCalls);
    bodyMacros.push(...armMacros);
  }
  if (!readable) neutral = false;
  return {
    readable,
    neutral,
    nested: [...nested].sort(),
    forwards: readable && forwards ? [...forwardTargets].sort() : null,
    forwardShadow: [...forwardShadow].sort(),
    arms: rules.length,
    calls,
    bodyMacros,
  };
}

/** Split a token sequence into top-level pieces at `,` (and `;` when asked). */
export function pieces(seq: Node[], semicolons: boolean): Node[][] {
  const out: Node[][] = [[]];
  for (const n of seq) {
    if (n.type === "," || (semicolons && n.type === ";")) out.push([]);
    else out.at(-1)!.push(n);
  }
  return out;
}

export type ArgumentCall = {
  /** Path call: written path segments. Method call: receiver and method. */
  path?: string[];
  method?: string;
  /** Simple receiver token (identifier or `self`), when the receiver is one. */
  receiver?: Node;
  /** Text range of the callee as written (path, or receiver chain + method). */
  start: number;
  end: number;
  /** Node anchoring scope and binding lookups. */
  anchor: Node;
  argumentCount: number;
  /** Start offsets of the invocations' macro names, outermost first. */
  macros: number[];
  /** Macro names of those invocations, as written. */
  macroNames: string[];
};

const hazardous = (seq: Node[]): boolean =>
  seq.some(
    (n) =>
      ARGUMENT_HAZARDS.has(word(n)) ||
      n.type === "metavariable" ||
      n.type === "lifetime" ||
      ((isGroup(n) || n.type === "token_repetition") && hazardous(inner(n))),
  );

/**
 * Calls written in a macro invocation's arguments, read as a format-style
 * argument list: pieces separated by `,` (and `;` for `vec!`), each an
 * expression or `name = expression`. Pieces with closures, bindings, items,
 * labels or metavariables are skipped whole. Calls inside nested invocations
 * are read only for the standard format macros.
 */
export function argumentCalls(invocation: {
  name: string;
  nameNode: Node;
  group: Node;
}): ArgumentCall[] {
  const out: ArgumentCall[] = [];
  const read = (
    name: string,
    group: Node,
    macros: number[],
    macroNames: string[],
  ) => {
    const std = standardFormatName(name);
    let ps = pieces(inner(group), std === "vec");
    if (std && FIRST_PIECE_ONLY.has(std)) ps = ps.slice(0, 1);
    // Unknown macros are read the same way, but only when every piece is a
    // plain expression list; the resolver marks those links unverified.
    for (let piece of ps) {
      if (
        piece.length >= 2 &&
        piece[0]!.type === "identifier" &&
        piece[1]!.type === "="
      )
        piece = piece.slice(2);
      if (!piece.length || hazardous(piece)) continue;
      scan(piece, macros, macroNames);
    }
  };
  const scan = (seq: Node[], macros: number[], macroNames: string[]) => {
    const nestedGroups = new Set<Node["id"]>();
    for (const { call } of invocations(seq)) {
      nestedGroups.add(call.group.id);
      if (standardFormatName(call.name))
        read(
          call.name,
          call.group,
          [...macros, call.node.startIndex],
          [...macroNames, call.name],
        );
    }
    for (let i = 0; i < seq.length; i++) {
      const n = seq[i]!;
      if (!isGroup(n) || nestedGroups.has(n.id)) continue;
      scan(inner(n), macros, macroNames);
      if (!opens(n, "(")) continue;
      const path = pathEndingAt(seq, i - 1);
      if (!path || path.segments.some((s) => s.startsWith("$"))) continue;
      const before = seq[path.start - 1];
      const argumentCount = pieces(inner(n), false).filter(
        (p) => p.length,
      ).length;
      const first = path.nodes.find((x) => x.type !== "::")!;
      const last = path.nodes.at(-1)!;
      if (before?.type === "." && path.segments.length === 1) {
        // Method call: find the start of the receiver chain.
        let j = path.start - 2;
        const receiverEnd = seq[j];
        if (!receiverEnd) continue;
        let k = j;
        for (;;) {
          const t = seq[k];
          if (!t) break;
          if (isGroup(t) && (opens(t, "(") || opens(t, "["))) {
            k--;
            continue;
          }
          if (t.type === "?") {
            k--;
            continue;
          }
          if (["identifier", "self", "integer_literal"].includes(t.type)) {
            if (seq[k - 1]?.type === "." || seq[k - 1]?.type === "::") {
              k -= 2;
              continue;
            }
            break;
          }
          k = -1;
          break;
        }
        if (k < 0 || !seq[k]) continue;
        const head = seq[k]!;
        const simple =
          k === j && ["identifier", "self"].includes(receiverEnd.type);
        out.push({
          method: word(last),
          ...(simple ? { receiver: receiverEnd } : {}),
          start: head.startIndex,
          end: last.endIndex,
          anchor: simple ? receiverEnd : last,
          argumentCount,
          macros,
          macroNames,
        });
        continue;
      }
      // `name!(…)` never reaches here (its group follows `!`), so a `!` or
      // `>` before a path is negation or comparison: still a call.
      if (before && (before.type === "." || ITEM_WORDS.has(word(before))))
        continue;
      out.push({
        path: path.segments,
        start: (path.nodes[0]!.type === "::" ? path.nodes[0]! : first)
          .startIndex,
        end: last.endIndex,
        anchor: first,
        argumentCount,
        macros,
        macroNames,
      });
    }
  };
  read(
    invocation.name,
    invocation.group,
    [invocation.nameNode.startIndex],
    [invocation.name],
  );
  return out;
}
