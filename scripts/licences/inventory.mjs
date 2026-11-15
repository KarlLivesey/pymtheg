// Licence inventory of exactly what the published Pymtheg tarball installs or
// contains. No dependencies beyond Node and the project's own dev tools (Vite
// is used only to read the browser bundle's real module graph).
//
//   node scripts/licences/inventory.mjs --write   regenerate docs/licences.md
//                                                 and THIRD-PARTY-NOTICES
//   node scripts/licences/inventory.mjs --check   exit 1 if either is stale or
//                                                 a policy problem is found
//
// Needs `npm ci` (dev dependencies included: the bundle is computed by running
// the real Vite build in memory, written nowhere).
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, parse, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Licences a shipped third-party component may carry (SPDX ids). */
export const allowed = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
]);

/** One-line obligations, plain words, not legal advice. */
const obligations = {
  MIT: "keep the copyright notice and licence text with copies",
  ISC: "keep the copyright notice and licence text with copies",
  "BSD-2-Clause":
    "keep the copyright notice, conditions and disclaimer with copies",
  "BSD-3-Clause":
    "keep the copyright notice, conditions and disclaimer; do not use the authors' names to endorse",
  "Apache-2.0":
    "keep the licence text and any NOTICE file; mark files you changed; includes a patent licence that ends for anyone who sues over patents in the work",
  "0BSD": "no conditions",
  "BlueOak-1.0.0": "give each recipient the licence text or a link to it",
  "CC0-1.0": "no conditions (public-domain dedication)",
  Unlicense: "no conditions (public-domain dedication)",
  "MPL-2.0":
    "file-level copyleft: changed MPL files must stay MPL and their source be available",
};

const licenceFile =
  /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|ThirdPartyNotice(Text)?|CopyrightNotice)([._-].*)?$/i;
/** Files that carry notices rather than a licence grant. */
const noticeFile = /^(NOTICE|ThirdPartyNotice|CopyrightNotice)/i;

/**
 * Reviewed explanations for flagged components (shown, never used to hide a
 * problem): keyed by package name, applied to every version.
 */
const explanations = {
  "@modelcontextprotocol/server":
    "LICENSE explains a licensing transition from MIT to Apache-2.0: code from authors who have not consented to relicensing stays MIT. The file carries both texts; treat the package as Apache-2.0 and MIT together",
  "@modelcontextprotocol/core":
    "same LICENSE as @modelcontextprotocol/server: MIT-to-Apache-2.0 transition, both texts apply",
};

/** Recognise a licence text by its distinctive wording. */
export function classify(text) {
  const t = text.replace(/\s+/g, " ");
  const found = [];
  if (/Apache License,? Version 2\.0/i.test(t)) found.push("Apache-2.0");
  if (/Blue Oak Model License/i.test(t)) found.push("BlueOak-1.0.0");
  if (/Mozilla Public License,? (Version )?2\.0/i.test(t))
    found.push("MPL-2.0");
  if (/CC0 1\.0 Universal/i.test(t)) found.push("CC0-1.0");
  if (
    /This is free and unencumbered software released into the public domain/i.test(
      t,
    )
  )
    found.push("Unlicense");
  if (
    /Permission is hereby granted, free of charge, to any person obtaining/i.test(
      t,
    )
  )
    found.push("MIT");
  if (
    /Permission to use, copy, modify, and\/?(or)? distribute this software for any purpose with or without fee is hereby granted/i.test(
      t,
    )
  )
    found.push(
      /provided that the above copyright notice and this permission notice appear in all copies/i.test(
        t,
      )
        ? "ISC"
        : "0BSD",
    );
  if (/Redistribution and use in source and binary forms/i.test(t))
    found.push(
      /Neither the name|names of (its|the|any) contributors|name of the copyright holder/i.test(
        t,
      )
        ? "BSD-3-Clause"
        : "BSD-2-Clause",
    );
  if (/GNU (LESSER|LIBRARY) GENERAL PUBLIC LICENSE/i.test(t))
    found.push("LGPL");
  else if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) found.push("AGPL");
  else if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) found.push("GPL");
  return found;
}

/** SPDX ids mentioned in a declared expression. */
export function spdxIds(expression) {
  return String(expression ?? "")
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(AND|OR|WITH)$/i.test(w));
}
/** Whether an SPDX expression can be satisfied using only allowed ids. */
export function satisfiable(expression, ids = allowed) {
  const tokens = String(expression ?? "")
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  const primary = () => {
    if (tokens[i] === "(") {
      i++;
      const v = or();
      i++;
      return v;
    }
    const id = tokens[i++];
    if (tokens[i] === "WITH") i += 2;
    return ids.has(id);
  };
  const and = () => {
    let v = primary();
    while (tokens[i] === "AND") {
      i++;
      v = primary() && v;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (tokens[i] === "OR") {
      i++;
      v = and() || v;
    }
    return v;
  };
  return tokens.length > 0 && or();
}
function declaredLicence(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string")
    return pkg.license.type;
  if (Array.isArray(pkg.licenses))
    return pkg.licenses
      .map((l) => (typeof l === "string" ? l : l.type))
      .join(" OR ");
  return null;
}
function sourceUrl(pkg) {
  const repo =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repo) {
    const shorthand = /^(github:)?([\w.-]+\/[\w.-]+)$/.exec(repo);
    if (shorthand) return `https://github.com/${shorthand[2]}`;
    return repo
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@/, "https://")
      .replace(/\.git$/, "");
  }
  return pkg.homepage ?? null;
}
function copyrights(texts) {
  const lines = new Set();
  for (const text of texts)
    for (const line of text.split("\n")) {
      const l = line.trim();
      if (
        /^(copyright\s|\(c\)\s|©)/i.test(l) &&
        (/\d{4}/.test(l) || /^copyright\s/i.test(l)) &&
        !/You must retain|this (license|notice)|^copyright\s(and|or|to)\b/i.test(
          l,
        ) &&
        !/^copyright (notice|holder|owner|license)/i.test(l) &&
        !/\[(yyyy|year)\]|<year>|\{yyyy\}/i.test(l)
      )
        lines.add(l.replace(/\s+/g, " "));
    }
  return [...lines];
}
async function licenceFiles(directory) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((e) => e.isFile() && licenceFile.test(e.name))
    .map((e) => e.name)
    .sort();
  const texts = [];
  for (const f of files) texts.push(await readFile(join(directory, f), "utf8"));
  return { files, texts };
}

/** Every package the published tarball's production install contains. */
async function dependencies() {
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  const out = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev || entry.link) continue;
    const directory = join(root, path);
    const pkg = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    const { files, texts } = await licenceFiles(directory);
    out.push({
      name: pkg.name,
      version: pkg.version,
      shipped:
        entry.optional || entry.devOptional
          ? "optional dependency"
          : "dependency",
      direct:
        Object.hasOwn(lock.packages[""].dependencies ?? {}, pkg.name) ||
        Object.hasOwn(lock.packages[""].optionalDependencies ?? {}, pkg.name),
      declared: declaredLicence(pkg),
      files,
      texts,
      source: sourceUrl(pkg),
      location: path,
    });
  }
  return out;
}

/** Packages Vite actually puts into dist-web, from the bundle's module graph. */
async function bundled() {
  const { build } = await import("vite");
  const modules = new Set();
  const capture = {
    name: "pymtheg-licence-inventory",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle))
        if (chunk.type === "chunk")
          for (const id of Object.keys(chunk.modules)) modules.add(id);
    },
  };
  const outDir = await mkdtemp(join(tmpdir(), "pymtheg-licence-bundle-"));
  try {
    await build({
      configFile: join(root, "web/vite.config.ts"),
      configLoader: "runner",
      logLevel: "silent",
      plugins: [capture],
      build: { write: false, outDir, emptyOutDir: false },
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
  const packages = new Map();
  const virtual = new Set();
  for (const raw of modules) {
    // "\0" marks a plugin's virtual module. A CommonJS proxy wraps a real
    // package file (counted as that package); the rest are Vite's own helpers.
    const id = raw.startsWith("\0") ? raw.slice(1) : raw;
    if (raw.startsWith("\0") && !id.includes("node_modules")) {
      virtual.add(id.split("?")[0]);
      continue;
    }
    if (!id.includes(`node_modules${sep}`) && !id.includes("node_modules/"))
      continue;
    let directory = dirname(id.split("?")[0]);
    while (directory !== parse(directory).root) {
      const file = join(directory, "package.json");
      if (existsSync(file)) {
        const pkg = JSON.parse(await readFile(file, "utf8"));
        if (typeof pkg.name === "string" && typeof pkg.version === "string") {
          packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg });
          break;
        }
      }
      directory = dirname(directory);
    }
  }
  const out = [];
  for (const { directory, pkg } of packages.values()) {
    const { files, texts } = await licenceFiles(directory);
    out.push({
      name: pkg.name,
      version: pkg.version,
      shipped: "bundled in dist-web",
      direct: false,
      declared: declaredLicence(pkg),
      files,
      texts,
      source: sourceUrl(pkg),
      location: relative(root, directory),
    });
  }
  // Helpers Vite injects into the bundle (module preload, CommonJS interop).
  if (virtual.size) {
    const directory = join(root, "node_modules/vite");
    const pkg = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    const { files, texts } = await licenceFiles(directory);
    out.push({
      name: "vite",
      version: pkg.version,
      shipped: "bundled in dist-web",
      direct: false,
      declared: declaredLicence(pkg),
      files,
      // Vite's LICENSE.md also carries the licences of everything Vite itself
      // bundles; only Vite's own (first) section applies to the injected helpers.
      texts: texts.map(
        (t) => t.split(/\n#+ Licenses of bundled dependencies/i)[0],
      ),
      source: sourceUrl(pkg),
      location: "node_modules/vite",
      note: `injected helper modules: ${[...virtual].sort().join(", ")}`,
    });
  }
  return out;
}

/** Code checked into this repository from other projects and shipped. */
async function vendored() {
  const out = [];
  for (const language of ["go", "rust"]) {
    const directory = join(root, "grammars", language);
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    );
    const { files, texts } = await licenceFiles(directory);
    const upstream = manifest.upstream;
    out.push({
      name: `tree-sitter-${language} (grammar, built to grammars/${language}/${manifest.output})`,
      version: `${upstream.tag} @ ${upstream.commit}`,
      shipped: "vendored (compiled .wasm)",
      direct: false,
      declared: /^MIT\b/.test(upstream.license) ? "MIT" : upstream.license,
      files,
      texts,
      source: upstream.repository,
      location: `grammars/${language}`,
      patches: manifest.patches.map((p) => ({
        file: p.file,
        origin: p.pullRequest ?? "own patch (Pymtheg)",
        what: p.what,
      })),
      note: `built with ${Object.entries(manifest.tools ?? {})
        .map(([k, v]) => `${k} ${v}`)
        .join(
          ", ",
        )}; imports its libc functions from web-tree-sitter at load time`,
    });
  }
  return out;
}

/** The Go helper shipped as source: confirm it uses the standard library only. */
async function goHelper() {
  const path = "src/graph/languages/go/toolchain/golinks.go";
  const text = await readFile(join(root, path), "utf8");
  const block = /import\s*\(([\s\S]*?)\)/.exec(text)?.[1] ?? "";
  const single = [...text.matchAll(/^import\s+"([^"]+)"/gm)].map((m) => m[1]);
  const imports = [...block.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .concat(single);
  const external = imports.filter((p) => p.split("/")[0].includes("."));
  return { path, imports: [...new Set(imports)].sort(), external };
}

/** Tracked binary assets the tarball ships (fonts, icons, images). */
async function assets() {
  const { files } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  void files;
  const html = await readFile(join(root, "web/index.html"), "utf8");
  const css = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(css|tsx?)$/.test(e.name))
        css.push(await readFile(p, "utf8"));
    }
  };
  await walk(join(root, "web/src"));
  const all = [html, ...css].join("\n");
  return {
    fonts: [
      ...new Set(
        [
          ...all.matchAll(
            /url\(([^)]*\.(woff2?|ttf|otf))\)|fonts\.googleapis/g,
          ),
        ].map((m) => m[0]),
      ),
    ],
    images: [
      ...new Set(
        [
          ...all.matchAll(
            /["'(]([^"'()]*\.(png|jpe?g|gif|webp|ico|svg))["')]/g,
          ),
        ].map((m) => m[1]),
      ),
    ],
  };
}

export async function collect() {
  const components = [
    ...(await dependencies()),
    ...(await bundled()),
    ...(await vendored()),
  ];
  for (const c of components) {
    // A notice file quotes other projects' licences; it is not the grant.
    c.found = [
      ...new Set(
        c.texts
          .filter((_, i) => !noticeFile.test(c.files[i]))
          .flatMap(classify),
      ),
    ];
    // Licence files' own copyright lines first, then those quoted in notices.
    c.copyright = copyrights([
      ...c.texts.filter((_, i) => !noticeFile.test(c.files[i])),
      ...c.texts.filter((_, i) => noticeFile.test(c.files[i])),
    ]);
    const declared = spdxIds(c.declared);
    c.problems = [];
    if (!c.files.some((f) => !noticeFile.test(f)))
      c.problems.push("no licence text in the package");
    if (!c.declared) c.problems.push("no declared licence");
    else if (!satisfiable(c.declared))
      c.problems.push(`declared ${c.declared} is outside the allow-list`);
    const extra = c.found.filter((id) => !declared.includes(id));
    if (c.found.length && extra.length)
      c.problems.push(
        `licence file reads as ${extra.join(", ")} but ${c.declared ?? "nothing"} is declared`,
      );
    if (c.files.length && !c.found.length)
      c.problems.push("licence file text not recognised");
    if (c.problems.length && explanations[c.name])
      c.explanation = explanations[c.name];
  }
  components.sort((a, b) =>
    a.name === b.name
      ? a.version < b.version
        ? -1
        : 1
      : a.name < b.name
        ? -1
        : 1,
  );
  return { components, go: await goHelper(), assets: await assets() };
}

/** The licence a component is grouped under: its declared expression. */
const group = (c) => c.declared ?? "(none declared)";
const pkgJson = async () =>
  JSON.parse(await readFile(join(root, "package.json"), "utf8"));

export async function render(data) {
  const { components, go, assets } = data;
  const pkg = await pkgJson();
  const groups = new Map();
  for (const c of components) {
    const g = group(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const order = [...groups.keys()].sort(
    (a, b) => groups.get(b).length - groups.get(a).length || (a < b ? -1 : 1),
  );
  const by = (kind) =>
    components.filter((c) => c.shipped.startsWith(kind)).length;
  const problems = components.filter((c) => c.problems.length);
  const ids = new Set(components.flatMap((c) => spdxIds(c.declared)));
  const unusual = [...ids].filter((id) => !allowed.has(id));
  const md = [];
  md.push(
    "# Third-party licences in the published package",
    "",
    "Generated by `node scripts/licences/inventory.mjs --write` from `package-lock.json`,",
    "the installed packages, the browser bundle's module graph and `grammars/*/manifest.json`.",
    "`test/licences.test.mjs` fails when this file or `THIRD-PARTY-NOTICES` is out of date.",
    "Do not edit by hand. This is an inventory, not legal advice.",
    "",
    `**Pymtheg's own licence is not yet chosen.** \`package.json\` has ${pkg.license ? `\`license: ${pkg.license}\`` : "no `license` field"}${pkg.private ? ' and `"private": true`' : ""}, and the repository has no LICENSE file for Pymtheg itself. That choice is the owner's.`,
    "",
    "## Summary",
    "",
    `${components.length} third-party components are shipped: ${by("dependency")} installed npm dependencies` +
      ` (direct and transitive, production only; ${by("optional")} optional), ${by("bundled")} packages bundled into \`dist-web/\`,` +
      ` and ${by("vendored")} vendored grammars. Dev-only packages are not shipped and are listed separately at the end.`,
    "",
    "| Licence (as declared) | Components | What it asks of a redistributor |",
    "|---|---:|---|",
  );
  for (const g of order) {
    const ob = spdxIds(g)
      .map((id) => obligations[id])
      .filter(Boolean);
    md.push(
      `| ${g} | ${groups.get(g).length} | ${ob.length ? [...new Set(ob)].join("; ") : "see the text"} |`,
    );
  }
  md.push(
    "",
    `- Copyleft (GPL, LGPL, AGPL, MPL) in shipped components: ${components.some((c) => c.found.some((f) => /GPL|MPL/.test(f)) || spdxIds(c.declared).some((f) => /GPL|MPL/.test(f))) ? "**yes, see below**" : "none"}.`,
    `- Licences outside the allow-list (${[...allowed].join(", ")}): ${unusual.length ? unusual.join(", ") : "none"}.`,
    `- Components with no licence text: ${
      components
        .filter((c) => c.problems.includes("no licence text in the package"))
        .map((c) => `${c.name}@${c.version}`)
        .join(", ") || "none"
    }.`,
    `- Declared licence disagreeing with the licence file, or text not recognised: ${
      components
        .filter((c) =>
          c.problems.some((p) => /reads as|not recognised/.test(p)),
        )
        .map((c) => `${c.name}@${c.version}`)
        .join(", ") || "none"
    }.`,
    `- Components with NOTICE or third-party notice files (their text must travel with redistributions; all are in THIRD-PARTY-NOTICES): ${
      components
        .filter((c) => c.files.some((f) => noticeFile.test(f)))
        .map(
          (c) =>
            `${c.name}@${c.version} (${c.files.filter((f) => noticeFile.test(f)).join(", ")})`,
        )
        .join(", ") || "none"
    }.`,
    `- Go helper \`${go.path}\` (shipped as source, run only with the user's own \`go\`): imports ${go.imports.map((i) => `\`${i}\``).join(", ")}; ${go.external.length ? `**non-standard imports: ${go.external.join(", ")}**` : "standard library only"}.`,
    `- Fonts: ${assets.fonts.length ? assets.fonts.join(", ") : "none (system fonts only)"}. Images referenced by the web app: ${assets.images.length ? assets.images.map((i) => `\`${i}\``).join(", ") + " (Pymtheg's own)" : "none"}.`,
    `- \`dist/\` contains only the TypeScript compiler's output of \`src/\`; no third-party source is copied into it.`,
    "",
  );
  if (problems.length) {
    md.push(
      "## Flagged",
      "",
      "| Component | Shipped as | Problem | Explanation |",
      "|---|---|---|---|",
    );
    for (const c of problems)
      md.push(
        `| ${c.name}@${c.version} | ${c.shipped} | ${c.problems.join("; ")} | ${c.explanation ?? "not yet reviewed"} |`,
      );
    md.push("");
  }
  md.push("## Vendored code", "");
  for (const c of components.filter((c) => c.shipped.startsWith("vendored"))) {
    md.push(
      `### ${c.name}`,
      "",
      `- Upstream: ${c.source}, ${c.version}`,
      `- Licence: ${c.declared} (file \`${c.location}/${c.files.join(", ")}\`, reads as ${c.found.join(", ") || "unrecognised"})`,
      `- Copyright: ${c.copyright.join("; ") || "none stated"}`,
      `- ${c.note}`,
      "- Patches applied before building:",
    );
    for (const p of c.patches)
      md.push(`  - \`${p.file}\` — ${p.origin}: ${p.what}`);
    md.push("");
  }
  for (const g of order) {
    md.push(
      `## ${g}`,
      "",
      "| Component | Version | Shipped as | Licence file reads as | Copyright | Source |",
      "|---|---|---|---|---|---|",
    );
    for (const c of groups.get(g))
      md.push(
        `| ${c.name.replace(/\|/g, "\\|")} | ${c.version.split(" @ ")[0]} | ${c.shipped}${c.direct ? " (direct)" : ""} | ${c.found.join(", ") || (c.files.length ? "unrecognised" : "no file")} | ${(c.copyright[0] ?? "—").replace(/\|/g, "\\|")}${c.copyright.length > 1 ? ` (+${c.copyright.length - 1})` : ""} | ${c.source ?? "—"} |`,
      );
    md.push("");
  }
  md.push(...(await devOnly()));
  const notices = [
    "THIRD-PARTY NOTICES",
    "",
    "The Pymtheg package contains or installs the third-party components below.",
    "Each section gives the component, how it is shipped, where it comes from,",
    "and its full licence and notice text as distributed by its authors.",
    "Generated by scripts/licences/inventory.mjs; see docs/licences.md.",
    "",
  ];
  for (const c of components) {
    notices.push(
      "=".repeat(78),
      `${c.name} ${c.version}`,
      `Shipped as: ${c.shipped}`,
      `Licence: ${c.declared ?? "not declared"}`,
      `Source: ${c.source ?? "not stated"}`,
    );
    if (c.note) notices.push(`Note: ${c.note}`);
    if (c.patches)
      for (const p of c.patches) notices.push(`Patch: ${p.file} (${p.origin})`);
    notices.push("");
    c.files.forEach((f, i) =>
      notices.push(`--- ${f} ---`, c.texts[i].trimEnd(), ""),
    );
  }
  return {
    markdown: md.join("\n").trimEnd() + "\n",
    notices: notices.join("\n").trimEnd() + "\n",
  };
}

/** Dev-only packages with licences outside the allow-list (not shipped). */
async function devOnly() {
  const lock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  const rows = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || !entry.dev) continue;
    const file = join(root, path, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(await readFile(file, "utf8"));
    const declared = declaredLicence(pkg);
    if (!declared || !satisfiable(declared))
      rows.push(
        `| ${pkg.name} | ${pkg.version} | ${declared ?? "none declared"} |`,
      );
  }
  return [
    "## Not shipped: dev-only packages outside the allow-list",
    "",
    "Used to build or test Pymtheg; npm does not install them for users of the package.",
    "",
    ...(rows.length
      ? ["| Package | Version | Licence |", "|---|---|---|", ...rows]
      : ["None."]),
    "",
  ];
}

export async function generate() {
  const data = await collect();
  return { data, ...(await render(data)) };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const mode = process.argv[2];
  const { data, markdown, notices } = await generate();
  const targets = [
    [join(root, "docs/licences.md"), markdown],
    [join(root, "THIRD-PARTY-NOTICES"), notices],
  ];
  if (mode === "--write") {
    const { writeFile } = await import("node:fs/promises");
    for (const [file, text] of targets) await writeFile(file, text);
  } else if (mode === "--check") {
    let stale = false;
    for (const [file, text] of targets)
      if (!existsSync(file) || (await readFile(file, "utf8")) !== text) {
        console.error(
          `${relative(root, file)} is out of date; run node scripts/licences/inventory.mjs --write`,
        );
        stale = true;
      }
    const blocking = data.components.filter((c) =>
      c.problems.some((p) => /allow-list|no licence text/.test(p)),
    );
    for (const c of blocking)
      console.error(`${c.name}@${c.version}: ${c.problems.join("; ")}`);
    process.exitCode = stale || blocking.length ? 1 : 0;
  } else {
    process.stdout.write(markdown);
  }
}
