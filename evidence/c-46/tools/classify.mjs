// SPDX-License-Identifier: MIT
// C-46 classify.mjs SCRATCH RUN.json OUT.json : the TypeScript links stored
// with reason `workspace-build-output-missing` or `workspace-entry-unavailable`
// in each finished installed graph, by why the compiler mapping is not
// proven for the workspace package they reach.
//
// A link is attributed to a package through its file: the module links
// (`imports` with a specifier) in that file with one of the two reasons name
// the packages; a file whose failing specifiers name one package gives all
// its such links to that package, otherwise "several packages". Each package
// is classified from its manifest and files, read as data:
//   - the build tool its build scripts name (tsup, tsdown, unbuild, rollup,
//     vite, esbuild, tsc, a node script, wireit, other, none);
//   - a declaration roll-up (api-extractor, rollup-plugin-dts,
//     dts-bundle-generator, rollupTypes);
//   - the type entries its manifest names (types, typings, exports `types`
//     conditions and `.d.ts` values, typesVersions), and for each whether a
//     `src/` twin exists: the path with its first segment (dist, lib, build,
//     out, types, esm, cjs) replaced by `src` and a source extension;
//   - a visible bundler config with a literal entry list.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, runPath, out] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runPath, "utf8"));
const REASONS = ["workspace-build-output-missing", "workspace-entry-unavailable"];
const OUTPUT_DIRS = new Set(["dist", "lib", "build", "out", "types", "esm", "cjs"]);
const SECOND = new Set(["types", "src", "esm", "cjs", "dts", "mjs"]);
const SOURCE_EXT = [".ts", ".tsx", ".mts", ".cts"];
const BUNDLER_CONFIG = /^(tsup|tsdown|unbuild|build|rollup|vite|rolldown|esbuild)\.config(?:\.[\w-]+)*\.(?:[cm]?[jt]s|json)$/;
const ROLLUP = /\b(?:api-extractor|dts-bundle-generator|rollup-plugin-dts)\b|\b(?:rollupTypes|bundleTypes)\s*["']?\s*:\s*true\b/;

function typeEntries(json) {
  const found = new Set();
  const walk = (value, typesCondition) => {
    if (typeof value === "string") {
      if (/\.(?:d\.[cm]?ts|[cm]?js|jsx)$/.test(value) || typesCondition) found.add(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v) => walk(v, typesCondition));
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value))
        walk(child, typesCondition || key === "types" || key === "typings");
  };
  walk(json.types, true);
  walk(json.typings, true);
  walk(json.exports, false);
  walk(json.typesVersions, true);
  for (const field of ["main", "module"]) if (typeof json[field] === "string") found.add(json[field]);
  return [...found].map((path) => path.replace(/^\.\//, ""));
}

function twin(root, entry, has) {
  const parts = entry.split("/");
  if (!OUTPUT_DIRS.has(parts[0]) || entry.includes("*")) return undefined;
  // dist/x, or dist/types/x, dist/src/x, dist/esm/x, lib/cjs/x
  const skip = SECOND.has(parts[1]) && parts.length > 2 ? 2 : 1;
  const stem = ["src", ...parts.slice(skip)].join("/").replace(/\.d\.[cm]?ts$|\.[cm]?js$|\.jsx$/, "");
  const hits = SOURCE_EXT.map((ext) => stem + ext).filter((p) => has(posix.join(root, p)));
  return hits.length === 1 ? hits[0] : hits.length ? "several" : undefined;
}

function buildTool(json, files, root) {
  const scripts = json.scripts && typeof json.scripts === "object" ? json.scripts : {};
  const commands = Object.entries(scripts)
    .filter(([name]) => /(?:^|[:.-])(?:build|compile|bundle|prepack|prepare)(?:$|[:.-])|^(?:build|prepack|prepare|prepublishOnly)$/.test(name))
    .map(([, command]) => String(command));
  const text = commands.join(" ; ");
  const tools = [];
  for (const [tool, pattern] of [
    ["wireit", /^\s*wireit\s*$/m],
    ["tsup", /\btsup\b/],
    ["tsdown", /\btsdown\b/],
    ["unbuild", /\bunbuild\b/],
    ["rollup", /\brollup\b/],
    ["vite", /\bvite\b/],
    ["esbuild", /\besbuild\b/],
    ["zshy", /\bzshy\b/],
    ["tsc", /\btsc\b/],
    ["node script", /\b(?:node|tsx|ts-node|bun|esno|jiti)\s+[\w./-]+\.[cm]?[jt]sx?\b/],
  ])
    if (pattern.test(text)) tools.push(tool);
  if (json.wireit) tools.push("wireit");
  if (!commands.length) return "no build script";
  return tools.length ? [...new Set(tools)].join("+") : "other script";
}

const totals = {};
const packagesOut = {};
const add = (key, n) => (totals[key] = (totals[key] ?? 0) + n);
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const checkout = join(scratch, repo.attempt, "checkout");
  const tracked = execFileSync("git", ["-C", checkout, "ls-files"], { maxBuffer: 1 << 28 })
    .toString()
    .split("\n")
    .filter(Boolean);
  const trackedSet = new Set(tracked);
  const has = (p) => trackedSet.has(p) || existsSync(join(checkout, p));
  const manifests = new Map();
  for (const file of tracked) {
    if (posix.basename(file) !== "package.json" || file.includes("node_modules/")) continue;
    try {
      const json = JSON.parse(readFileSync(join(checkout, file), "utf8"));
      // A fixture can reuse a workspace package name: the shallowest outside test folders wins.
      const fixture = /(?:^|\/)(?:tests?|__tests__|fixtures?|examples?|e2e|playground)\//.test(file);
      const rank = (fixture ? 1000 : 0) + file.split("/").length;
      const previous = manifests.get(json.name);
      if (typeof json.name === "string" && (!previous || rank < previous.rank))
        manifests.set(json.name, { root: posix.dirname(file), json, rank });
    } catch {}
  }
  const configsOf = (root) =>
    tracked.filter(
      (f) => posix.dirname(f) === (root === "." ? "." : root) && BUNDLER_CONFIG.test(posix.basename(f)),
    );
  const classOf = new Map();
  function classify(name) {
    if (classOf.has(name)) return classOf.get(name);
    const pkg = manifests.get(name);
    let result;
    if (!pkg) result = { class: "not a workspace package by name" };
    else {
      const { root, json } = pkg;
      const tool = buildTool(json, tracked, root);
      const configs = configsOf(root);
      const configText = configs.map((f) => readFileSync(join(checkout, f), "utf8")).join("\n");
      const scriptsText = JSON.stringify(json.scripts ?? {}) + JSON.stringify(json.wireit ?? {});
      const rollup = ROLLUP.test(configText) || ROLLUP.test(scriptsText) ||
        tracked.some((f) => posix.dirname(f) === root && /api-extractor.*\.json$/.test(f));
      const entries = typeEntries(json);
      const missing = entries.filter((e) => !has(posix.join(root, e)));
      const twins = missing.map((e) => twin(root, e, has));
      const literalEntry = configs.length
        ? /\b(?:entry|entries|input)\s*:\s*(?:\[\s*)?["'][\w./-]+["']/.test(configText)
          ? "literal bundler entry"
          : "bundler config without a literal entry"
        : "no bundler config";
      const twinState = !missing.length
        ? "entries present"
        : twins.every((t) => t && t !== "several")
          ? "every missing entry has a src twin"
          : twins.some((t) => t && t !== "several")
            ? "some missing entries have a src twin"
            : "no src twin";
      result = {
        class: `${rollup ? "declaration roll-up" : tool}`,
        twin: twinState,
        config: literalEntry,
        root,
        entries: entries.slice(0, 8),
        missing: missing.slice(0, 8),
        twins: twins.slice(0, 8),
      };
    }
    classOf.set(name, result);
    return result;
  }
  const db = new DatabaseSync(join(checkout, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const byFile = new Map();
  const counts = new Map();
  for (const { file, body } of db
    .prepare(
      `SELECT file, body FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason') IN ('${REASONS.join("','")}')`,
    )
    .iterate()) {
    const link = JSON.parse(body);
    counts.set(file, (counts.get(file) ?? 0) + 1);
    const specifier = link.kind === "imports" ? link.data?.specifier : undefined;
    if (typeof specifier !== "string") continue;
    const name = /^(@[^/]+\/[^/]+|[^/@][^/]*)/.exec(specifier)?.[1];
    if (!name) continue;
    const set = byFile.get(file) ?? new Set();
    set.add(name);
    byFile.set(file, set);
  }
  db.close();
  const pinPackages = {};
  for (const [file, n] of counts) {
    const names = [...(byFile.get(file) ?? [])];
    const key =
      names.length === 1
        ? names[0]
        : names.length
          ? "(several packages in one file)"
          : "(no failing module link in the file)";
    const entry = (pinPackages[key] ??= { links: 0, files: 0 });
    entry.links += n;
    entry.files++;
  }
  for (const [name, entry] of Object.entries(pinPackages)) {
    const info = name.startsWith("(") ? { class: name } : classify(name);
    Object.assign(entry, info);
    const key = [info.class, info.twin ?? "", info.config ?? ""].filter(Boolean).join(" | ");
    add(key, entry.links);
  }
  packagesOut[repo.id] = Object.fromEntries(
    Object.entries(pinPackages).sort((a, b) => b[1].links - a[1].links),
  );
}
const sorted = Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
writeFileSync(out, JSON.stringify({ totals: sorted, packages: packagesOut }, null, 1) + "\n");
for (const [key, n] of Object.entries(sorted)) console.log(n, key);
