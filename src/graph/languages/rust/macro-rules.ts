// SPDX-License-Identifier: MIT
// Token-level facts about `macro_rules!` definitions and macro invocation
// arguments. Nothing here expands a macro: it reads the token trees the one
// parse already produced and records what is provable from them. The resolver
// decides, per invocation, whether these facts apply (R1-K).
import type { Node } from "web-tree-sitter";

const compact = (s: string) => s.replace(/\s+/g, "").replace(/\br#/g, "");

export type MacroInput = { names: string[]; mayIntroduceUnknownNames?: true };

/** Rust identifier tokens and possible wildcard imports in the input. */
export function macroInput(nodes: readonly Node[]): MacroInput {
  const pending = [...nodes];
  const names = new Set<string>();
  let star = false;
  let bang = false;
  while (pending.length) {
    const node = pending.pop()!;
    if (/^(?:line_comment|block_comment)$|literal$/.test(node.type)) continue;
    if (node.childCount) {
      for (const child of node.children) pending.push(child);
    } else {
      star ||= node.type === "*";
      bang ||= node.type === "!";
      const name = /^(?:r#|['$])?([_\p{ID_Start}][_\p{ID_Continue}]*)$/u.exec(
        node.text,
      )?.[1];
      if (name) names.add(name.normalize());
    }
  }
  const mayIntroduceUnknownNames =
    (star && names.has("use")) ||
    (names.has("macro_use") && (names.has("mod") || names.has("extern"))) ||
    (bang &&
      [
        "include",
        "automod",
        "paste",
        "pastey",
        "concat_idents",
        "seq_macro",
        "duplicate",
      ].some((name) => names.has(name)));
  return {
    names: [...names].sort(),
    ...(mayIntroduceUnknownNames ? { mayIntroduceUnknownNames: true } : {}),
  };
}

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
export const isMacroItemKeyword = (name: string): boolean =>
  ITEM_WORDS.has(name);
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
/** Builtin macros that consume their tokens without evaluating them as
 * calls and cannot emit items. `include!` is not one of them. */
export const consumingBuiltins = new Set([
  "stringify",
  "concat",
  "line",
  "column",
  "file",
  "module_path",
  "cfg",
  "env",
  "option_env",
  "compile_error",
  "include_str",
  "include_bytes",
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
  /** No caller-scope item, with the same condition on nested macros. */
  itemNeutral: boolean;
  /** Macros invoked at the top level of some arm, as written. */
  nested: string[];
  /** Upper bound on names introduced into the surrounding scope. */
  scope: MacroScopeProfile;
  /** Every arm that takes input passes all of it, unchanged and as the tail of
   * an argument list, to one of these macros; null when unproved. */
  forwards: string[] | null;
  /** Names bound by items in transcriber groups enclosing a forward site
   * (`*` when unknown). Call-site names in forwarded tokens may be shadowed. */
  forwardShadow: string[];
  /** Number of arms. Body facts are per macro, so several arms are unproved. */
  arms: number;
  /** No arm has an attribute anywhere, or an item other than a readable
   * `use`, in the code it emits: nothing in the expansion can remove a call
   * or rebind a name except what `forwardShadow`/`shadow` and the nested
   * invocations (`bodyMacros`, each to be proved harmless) account for. */
  clean: boolean;
  /** Defined inside a block: locals in scope at the definition can capture
   * one-segment names in the body (mixed-site hygiene). */
  blockLocal: boolean;
  /** Path calls written in code positions of the transcribers. */
  calls: {
    path: string;
    argumentCount: number;
    shadow: string[];
    /** A one-segment name in an arm that binds locals, or in a macro defined
     * inside a block (may be one of those locals). */
    local: boolean;
    /** Inside a `$( … )` repetition: may be emitted zero times. */
    repeated: boolean;
    /** Standard-looking macros whose arguments hold the call, outermost
     * first: each must be the standard macro where the expansion lands. */
    within: string[];
  }[];
  /** Every macro invoked in code positions of the transcribers, standard
   * ones included. Each must be harmless where the macro is invoked. */
  bodyMacros: { name: string; shadow: string[]; repeated: boolean }[];
  /** Names that a `use` anywhere in the transcribers binds (`*`: unknown).
   * A macro invoked inside this expansion, at any depth, whose name starts
   * with one of them may be the imported one, not the one it looks like. */
  useNames: string[];
  /** First segment of every macro name the transcribers invoke. */
  macroHeads: string[];
};

export type MacroScopeProfile = {
  names: string[];
  inputCanBind: boolean;
  opaque: boolean;
  keywordFromInput: boolean;
};

function scopeRepetitionsAreWhole(tokens: Node[]): boolean {
  return tokens.every((token, index) => {
    if (token.type !== "token_repetition") return true;
    const repeated = inner(token);
    const previous = tokens[index - 1];
    const last = repeated.at(-1);
    // An omitted repetition inside a declaration can change the name slot:
    // `struct $($name)? Option;` can expand to `struct Option;`.
    return (
      (!previous || previous.type === ";") &&
      (last?.type === ";" || opens(last, "{")) &&
      scopeRepetitionsAreWhole(repeated)
    );
  });
}

function inspectScope(
  top: Node[],
  kinds: ReadonlyMap<string, string>,
  names: Set<string>,
): Omit<MacroScopeProfile, "names"> {
  let inputCanBind = false;
  let keywordFromInput = false;
  // A top-level attribute or macro definition can change the tokens and
  // macro lookup of this expansion. Imports can also rebind nested macros.
  let opaque = false;
  const emitted = invocations(top);
  for (const { call } of emitted)
    for (const name of macroInput([call.group]).names) names.add(name);
  for (let i = 0; i < top.length; i++) {
    const token = top[i]!,
      keyword = word(token);
    if (
      ["#", "$"].includes(token.type) ||
      keyword === "macro" ||
      keyword === "macro_rules"
    )
      opaque = true;
    if (keyword === "let") inputCanBind = true;
    if (token.type === "metavariable") {
      const kind = kinds.get(token.text);
      if (top[i + 1]?.type === "!" || !kind) opaque = true;
      if (kind === "ident") {
        // An ident can be a keyword, as in `$kw Option` with `struct`.
        // Only these positions require the token to be a name.
        const previous = top[i - 1] ? word(top[i - 1]!) : "";
        const before = top[i - 2] ? word(top[i - 2]!) : "";
        if (
          !ITEM_WORDS.has(previous) &&
          previous !== "let" &&
          !(previous === "mut" && ["static", "let"].includes(before))
        ) {
          opaque = true;
          const next = top[i + 1];
          if (
            next &&
            (["identifier", "metavariable", "::"].includes(next.type) ||
              opens(next, "{") ||
              opens(next, "["))
          )
            keywordFromInput = true;
        }
      }
      if (kind && ["tt", "item", "stmt"].includes(kind)) {
        // The input may supply the keyword, not just the new item's name.
        inputCanBind = true;
        // A raw token or item can introduce an import, macro or attribute.
        opaque = true;
      }
    }
    if (!ITEM_WORDS.has(keyword) || keyword === "impl") continue;
    if (keyword === "use" || keyword === "extern") {
      const end = top.findIndex((n, j) => j > i && n.type === ";");
      const tokens = top.slice(i + 1, end < 0 ? undefined : end);
      // Include parent names for `use path::{self, ...}` and both sides
      // of aliases. Globs and macro-use imports have unbounded exports.
      if (
        emitted.length ||
        // A foreign block can introduce declarations via another macro.
        (keyword === "extern" &&
          (opens(top[i + 1], "{") || opens(top[i + 2], "{"))) ||
        tokens.some(
          (n) =>
            n.type === "*" ||
            n.descendantsOfType("*").length > 0 ||
            n.type === "metavariable" ||
            n.descendantsOfType("metavariable").length > 0,
        )
      )
        opaque = true;
      for (const name of macroInput(tokens).names) names.add(name);
      continue;
    }
    const next =
      top[i + (keyword === "static" && top[i + 1]?.text === "mut" ? 2 : 1)];
    if (next?.type === "metavariable") inputCanBind = true;
    else if (next?.type === "identifier")
      names.add(compact(next.text).normalize());
    else if (
      next &&
      /^(?:r#)?[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(next.text)
    )
      names.add(compact(next.text).normalize());
    else if (!next || !["_", "("].includes(next.type)) opaque = true;
  }
  return { inputCanBind, opaque, keywordFromInput };
}

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
    neutral = true,
    itemNeutral = true;
  const nested = new Set<string>(),
    scopeNames = new Set<string>(),
    forwardTargets = new Set<string>(),
    forwardShadow = new Set<string>(),
    calls: MacroProfile["calls"] = [],
    bodyMacros: MacroProfile["bodyMacros"] = [],
    useNames = new Set<string>(),
    macroHeads = new Set<string>();
  let forwards = true,
    clean = true,
    scopeInputCanBind = false,
    scopeOpaque = false,
    scopeKeywordFromInput = false;
  let blockLocal = false;
  for (let a = definition.parent; a && a.type !== "source_file"; a = a.parent)
    if (a.type === "block") blockLocal = true;
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
    const transcriber = inner(body);
    const top = flat(transcriber);
    const scope = inspectScope(top, kinds, scopeNames);
    scopeInputCanBind ||= scope.inputCanBind;
    scopeOpaque ||= scope.opaque || !scopeRepetitionsAreWhole(transcriber);
    scopeKeywordFromInput ||= scope.keywordFromInput;
    for (let i = 0; i < top.length; i++) {
      const n = top[i]!,
        w = word(n);
      // `if let`, `while let` and let chains bind only inside their block.
      const statementLet =
        w === "let" &&
        !["if", "while", "&&"].includes(top[i - 1] ? word(top[i - 1]!) : "");
      if (statementLet) neutral = false;
      if (ITEM_WORDS.has(w) || n.type === "#") neutral = itemNeutral = false;
      if (n.type === "metavariable") {
        const kind = kinds.get(n.text);
        if (!kind || ["tt", "item", "stmt"].includes(kind))
          neutral = itemNeutral = false;
        if (top[i + 1]?.type === "!") neutral = itemNeutral = false;
      }
    }
    for (const { call } of invocations(top))
      if (
        call.name.split("::").some((s) => s.startsWith("$") && s !== "$crate")
      )
        neutral = itemNeutral = false;
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
    const visitSeq = (
      seq: Node[],
      shadow: string[],
      arms: boolean,
      repeated = false,
      within: string[] = [],
    ) => {
      const bound = itemNames(seq);
      for (const x of bound) useNames.add(x);
      const here = [...shadow, ...bound];
      const mask = patternMask(seq, arms);
      const skipped = new Set<number>();
      // Attributes (cfg and others) and items other than `use` make the
      // expansion unclean. A nested `macro_rules!`/`macro` definition is not
      // code at this site: nothing in it is read.
      for (let i = 0; i < seq.length; i++) {
        const w = word(seq[i]!);
        if (seq[i]!.type === "#") clean = false;
        if (ITEM_WORDS.has(w) && w !== "use") clean = false;
        if (w === "macro_rules" || w === "macro") {
          let j = i + 1;
          while (j < seq.length && !isGroup(seq[j])) j++;
          for (let k = i; k <= j && k < seq.length; k++) skipped.add(k);
        }
      }
      const calls = invocations(seq).filter(
        ({ call }) => !skipped.has(seq.indexOf(call.group)),
      );
      for (const { at, call } of calls) {
        macroHeads.add(call.name.replace(/^::/, "").split("::")[0]!);
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
          // A forward site inside a repetition may be emitted zero times.
          if (
            plain &&
            !repeated &&
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
        const rest = forwarded
          ? contents.filter((_, i) => i !== forwardIndex)
          : contents;
        if (std)
          visitSeq(
            std === "matches" ? pieces(rest, false)[0]! : rest,
            here,
            false,
            repeated,
            [...within, call.name],
          );
        if (
          call.name.split("::").some((x) => x.startsWith("$") && x !== "$crate")
        )
          clean = false;
        else armMacros.push({ name: call.name, shadow: here, repeated });
        void at;
      }
      for (let i = 0; i < seq.length; i++) {
        const n = seq[i]!;
        if (isGroup(n)) {
          if (!skipped.has(i))
            visitSeq(inner(n), here, matchArmsGroup(seq, i), repeated, within);
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
                repeated,
                within,
                local:
                  (bindsLocals || blockLocal) && path.segments.length === 1,
                path: path.segments.join("::"),
                argumentCount: pieces(inner(n), false).filter((p) => p.length)
                  .length,
                shadow: here,
              });
          }
        } else if (n.type === "token_repetition" && !skipped.has(i))
          visitSeq(inner(n), here, false, true, within);
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
  if (!readable) neutral = itemNeutral = false;
  // A `use` in the expansion that could rebind a macro name the expansion
  // invokes (or any name, for a glob) leaves the expansion unclean.
  if (useNames.has("*") || [...useNames].some((x) => macroHeads.has(x)))
    clean = false;
  return {
    readable,
    neutral,
    itemNeutral,
    nested: [...nested].sort(),
    scope: {
      names: [...scopeNames].sort(),
      inputCanBind: scopeInputCanBind,
      opaque: !readable || scopeOpaque,
      keywordFromInput: scopeKeywordFromInput,
    },
    forwards: readable && forwards ? [...forwardTargets].sort() : null,
    forwardShadow: [...forwardShadow].sort(),
    arms: rules.length,
    clean: readable && clean,
    blockLocal,
    useNames: [...useNames].sort(),
    macroHeads: [...macroHeads].sort(),
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
      // A block in the arguments that invokes any macro directly may have
      // items defined in it by that macro: its names are not read (R1-K).
      if (opens(n, "{") && invocations(inner(n)).length) continue;
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
