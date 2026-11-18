// SPDX-License-Identifier: MIT
// A small language for graph storage tests: lines "def NAME" declare a
// function, "call NAME" calls one. The resolver links a call to the only
// declaration with that name.
export function fixtureModule() {
  return {
    id: "fixture",
    version: "1",
    extensions: [".x"],
    parse({ text }) {
      const symbols = [];
      const links = [];
      let offset = 0;
      let owner;
      for (const line of text.split("\n")) {
        const [word, name] = line.split(" ");
        const range = { start: offset, end: offset + line.length };
        if (word === "def") {
          owner = name;
          symbols.push({ key: name, name, identity: name, kind: "function", range });
        } else if (word === "call" && owner)
          links.push({ sourceKey: owner, kind: "calls", targetName: name, range });
        offset += line.length + 1;
      }
      return { status: "clean", diagnostics: [], symbols, links };
    },
    resolve({ symbols, links }) {
      return links.map((link) => {
        const named = symbols.filter((s) => s.name === link.targetName);
        return { linkId: link.id, targetId: named.length === 1 ? named[0].id : null };
      });
    },
  };
}
/** Files of a fixture project: calls within and across files. */
export function fixtureFiles(count = 6) {
  const files = {};
  for (let i = 0; i < count; i++)
    files[`f${i}.x`] =
      `def f${i}\ncall f${(i + 1) % count}\ncall g${i}\ndef g${i}\ncall f${i}\n`;
  return files;
}
