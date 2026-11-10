import { readFile, readdir } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

/** Emit the actual bundled packages' notices; npm retains server dependency licences. */
export function bundledLicenseNotices() {
  return {
    name: "bundled-license-notices",
    async generateBundle(_options, bundle) {
      const roots = new Map();
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const moduleId of Object.keys(chunk.modules)) {
          if (moduleId.startsWith("\0") || !moduleId.includes("node_modules/"))
            continue;
          let directory = dirname(moduleId.split("?")[0]);
          if (roots.has(directory)) continue;
          const initial = directory;
          while (directory !== parse(directory).root) {
            try {
              const pkg = JSON.parse(
                await readFile(join(directory, "package.json"), "utf8"),
              );
              if (
                typeof pkg.name === "string" &&
                typeof pkg.version === "string"
              ) {
                packages.set(pkg.name + "@" + pkg.version, { directory, pkg });
                break;
              }
            } catch (error) {
              if (error.code !== "ENOENT" && error.code !== "ENOTDIR")
                throw error;
            }
            directory = dirname(directory);
          }
          roots.set(initial, directory);
        }
      }
      const sections = [
        "Third-party packages included in the Pymtheg browser build.\nOriginal licence and notice text follows. Runtime npm dependencies retain their own licence files.\n",
      ];
      for (const [name, { directory, pkg }] of [...packages].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const files = (await readdir(directory, { withFileTypes: true }))
          .filter(
            (entry) =>
              entry.isFile() &&
              /^(LICEN[CS]E|COPYING|NOTICE)([._-].*)?$/i.test(entry.name),
          )
          .map((entry) => entry.name)
          .sort();
        if (!files.some((file) => /^(LICEN[CS]E|COPYING)/i.test(file)))
          throw Error(
            `Missing bundled licence text for ${name}; inspect its distribution before shipping it`,
          );
        sections.push(
          `\n${"=".repeat(72)}\n${name}\nLicence identifier: ${JSON.stringify(pkg.license ?? "See notice below")}\n`,
        );
        for (const file of files)
          sections.push(
            `\n--- ${file} ---\n${await readFile(join(directory, file), "utf8")}`,
          );
      }
      if (!packages.size)
        throw Error("No browser dependency licences were collected");
      this.emitFile({
        type: "asset",
        fileName: "third-party-notices.txt",
        source: sections.join("\n"),
      });
    },
  };
}
