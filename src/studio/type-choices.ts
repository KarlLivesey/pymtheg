// SPDX-License-Identifier: MIT
export interface TypeChoice {
  name: string;
  kind: "record" | "choice" | "resource";
  symbolId?: string;
  file?: string;
}
/** Keep nominal identities distinct; equal spelling does not establish equal type. */
export function typeChoices(
  types: readonly TypeChoice[],
  query: string,
  selected: { name: string; symbolId?: string },
) {
  const unique = [
    ...new Map(types.map((t) => [t.symbolId ?? "local:" + t.name, t])).values(),
  ];
  const counts = new Map<string, number>();
  for (const type of unique)
    counts.set(type.name, (counts.get(type.name) ?? 0) + 1);
  const key = (t: TypeChoice) =>
    (counts.get(t.name) ?? 0) > 1 ? (t.symbolId ?? "local:" + t.name) : t.name;
  const selection = selected.symbolId
    ? unique.find((t) => t.symbolId === selected.symbolId)
    : (unique.find((t) => !t.symbolId && t.name === selected.name) ??
      ((counts.get(selected.name) ?? 0) === 1
        ? unique.find((t) => t.name === selected.name)
        : undefined));
  const needle = query.toLowerCase();
  const matched = unique.filter((t) =>
    (
      t.name +
      " " +
      (/^(?:\/|[A-Za-z]:[\\/])/.test(t.file ?? "")
        ? t.file!.split(/[\\/]/).at(-1)!
        : (t.file ?? ""))
    )
      .toLowerCase()
      .includes(needle),
  );
  const visible = matched.slice(0, 25);
  if (selection && !visible.includes(selection)) visible.unshift(selection);
  return {
    items: visible.map((t) => ({
      ...t,
      value: key(t),
      label:
        (counts.get(t.name) ?? 0) > 1
          ? t.name + " · " + (t.file ?? "local definition")
          : t.name,
    })),
    selectedValue: selection ? key(selection) : "",
    total: matched.length,
    all: unique,
  };
}
