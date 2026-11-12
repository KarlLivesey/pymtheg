/** Bounded propositional implication of captured cfg syntax, never feature evaluation.
 * Unknown atoms remain distinct; quoted contents are preserved. */
type Clause = Map<string, boolean>;
function split(s: string): string[] {
  const out: string[] = [];
  let depth = 0,
    quote = "",
    start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"') quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && !depth) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (s.slice(start).trim()) out.push(s.slice(start));
  return out;
}
function and(a: Clause[], b: Clause[]): Clause[] {
  const out: Clause[] = [];
  for (const x of a)
    for (const y of b) {
      if ([...y].some(([k, v]) => x.has(k) && x.get(k) !== v)) continue;
      out.push(new Map([...x, ...y]));
      if (out.length > 128) throw new Error("cfg complexity");
    }
  return out;
}
function dnf(s: string, negate = false): Clause[] {
  const m = /^(all|any|not)\((.*)\)$/s.exec(s.trim());
  if (!m || s.includes("?") || /r#+"/.test(s)) return [new Map([[s, !negate]])];
  const args = split(m[2]!);
  if (m[1] === "not")
    return args.length === 1
      ? dnf(args[0]!, !negate)
      : [new Map([[s, !negate]])];
  const conjunction = (m[1] === "all") !== negate;
  return args.reduce<Clause[]>(
    (acc, arg) =>
      conjunction ? and(acc, dnf(arg, negate)) : [...acc, ...dnf(arg, negate)],
    conjunction ? [new Map()] : [],
  );
}
export function implies(caller: readonly string[], condition: string): boolean {
  if (condition.includes("?")) return false;
  // A conjunction implies each of its own conjuncts, regardless of the
  // expansion cost of unrelated predicates. Try individual conjuncts before
  // expanding the whole caller into DNF.
  if (caller.includes(condition)) return true;
  for (const conjunct of caller) {
    try {
      const left = dnf(conjunct),
        right = dnf(condition);
      if (
        left.length &&
        left.every((x) =>
          right.some((y) => [...y].every(([k, v]) => x.get(k) === v)),
        )
      )
        return true;
    } catch {
      /* An unexpanded conjunct cannot prove anything by itself. */
    }
  }
  try {
    const left = caller.reduce((acc, s) => and(acc, dnf(s)), [
      new Map(),
    ] as Clause[]);
    const right = dnf(condition);
    return (
      left.length > 0 &&
      left.every((x) =>
        right.some((y) => [...y].every(([k, v]) => x.get(k) === v)),
      )
    );
  } catch {
    return false;
  }
}
export function possible(conditions: readonly string[]): boolean {
  try {
    return (
      conditions.reduce((acc, s) => and(acc, dnf(s)), [new Map()] as Clause[])
        .length > 0
    );
  } catch {
    return true;
  }
}
