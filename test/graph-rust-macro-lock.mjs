// SPDX-License-Identifier: MIT
// A small lockfile with explicit registry dependencies for graph fixtures.
export function macroLock(packages, ownerVersion = "0.0.0") {
  const packageRow = (name, version, dependencies, source) =>
    `[[package]]\nname=${JSON.stringify(name)}\nversion=${JSON.stringify(version)}\n` +
    (dependencies?.length
      ? `dependencies=${JSON.stringify(dependencies)}\n`
      : "") +
    (source
      ? `source="registry+https://github.com/rust-lang/crates.io-index"\n`
      : "");
  return (
    "version=4\n" +
    packageRow(
      "app",
      ownerVersion,
      packages.map(([name]) => name),
      false,
    ) +
    packages
      .map(
        ([name, version, implementation]) =>
          packageRow(
            name,
            version,
            implementation && [implementation[0]],
            true,
          ) + (implementation ? packageRow(...implementation, [], true) : ""),
      )
      .join("")
  );
}
