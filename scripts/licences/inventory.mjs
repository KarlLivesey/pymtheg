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
    "LICENSE explains a licensing transition from MIT to Apache-2.0: code from authors who have not consented to relicensing stays MIT. The file carries both texts; treat the package as Apache-2.0 and MIT together. It also says the project's documentation (not specifications) is CC-BY-4.0; the npm package ships code, a README and the LICENSE",
  "@modelcontextprotocol/core":
    "same LICENSE as @modelcontextprotocol/server: MIT-to-Apache-2.0 transition, both texts apply; documentation CC-BY-4.0",
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
  if (/CC-BY-4\.0|Creative Commons Attribution 4\.0/i.test(t))
    found.push("CC-BY-4.0");
  if (
    /\bW3C License\b|W3C\S* SOFTWARE (AND DOCUMENT )?NOTICE AND LICENSE/i.test(
      t,
    )
  )
    found.push("W3C");
  if (
    /UNICODE,? INC\.? LICENSE AGREEMENT|UNICODE LICENSE V3|Unicode License/i.test(
      t,
    )
  )
    found.push("Unicode");
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

/**
 * Code a build tool writes into dist-web itself, by the virtual module id the
 * bundler gives it ("\0" prefix stripped). Each rule names the project the
 * code comes from and, when that project is vendored inside another package,
 * the host whose LICENSE.md carries its licence. A virtual module matching no
 * rule is reported as unattributed and fails the licence test.
 */
export const injectedOrigins = [
  {
    test: (id) => id === "commonjsHelpers.js" || /\?commonjs-[a-z-]+$/.test(id),
    origin: "@rollup/plugin-commonjs",
    host: "vite",
    what: "CommonJS interop helpers and module wrappers",
  },
  {
    test: (id) =>
      /^vite\/(modulepreload-polyfill|preload-helper)(\.js)?$/.test(id),
    origin: "vite",
    what: "module preload code",
  },
];
/** A package's own licence: the part of LICENSE.md before its bundled-dependency notices. */
async function ownLicence(directory) {
  const { files, texts } = await licenceFiles(directory);
  return {
    files,
    texts: texts.map(
      (t) => t.split(/\n#+ Licenses of bundled dependencies/i)[0],
    ),
  };
}
/** A project vendored inside `host`, from the host's LICENSE.md bundled-dependency section. */
async function vendoredInside(host, name) {
  const directory = join(root, "node_modules", host);
  const hostPkg = JSON.parse(
    await readFile(join(directory, "package.json"), "utf8"),
  );
  const text = await readFile(join(directory, "LICENSE.md"), "utf8");
  const section = text.split(/\n-{5,}\n/).find((part) => {
    const heading = /^## (.+)$/m.exec(part)?.[1] ?? "";
    return heading.split(/,\s*/).includes(name);
  });
  if (!section) throw Error(`${host}/LICENSE.md has no section for ${name}`);
  const licence = section
    .split("\n")
    .filter((l) => l.startsWith(">"))
    .map((l) => l.replace(/^> ?/, ""))
    .join("\n");
  return {
    name,
    version:
      hostPkg.devDependencies?.[name] ??
      hostPkg.dependencies?.[name] ??
      `bundled in ${host}`,
    declared: /^License: (.+)$/m.exec(section)?.[1] ?? null,
    files: [`${host}/LICENSE.md (section "${/^## (.+)$/m.exec(section)[1]}")`],
    texts: [licence],
    source: /^Repository: (.+)$/m.exec(section)?.[1] ?? null,
    location: `node_modules/${host} (vendored inside ${host}@${hostPkg.version})`,
  };
}
/** Packages and build-tool code Vite actually puts into dist-web, from the bundle's module graph. */
async function bundled() {
  const { build } = await import("vite");
  const modules = new Set();
  const capture = {
    name: "pymtheg-licence-inventory",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle))
        if (chunk.type === "chunk")
          for (const [id, info] of Object.entries(chunk.modules))
            if (info.renderedLength > 0) modules.add(id);
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
  const injected = new Map();
  const unattributed = new Set();
  for (const raw of modules) {
    const id = raw.startsWith("\0") ? raw.slice(1) : raw;
    if (raw.startsWith("\0") || /\?commonjs-[a-z-]+$/.test(id)) {
      // A virtual module is build-tool code, even when it wraps a package file.
      const rule = injectedOrigins.find((r) =>
        r.test(id.includes("node_modules") ? "x?" + id.split("?").pop() : id),
      );
      const shown = id.includes("node_modules")
        ? `<package file>?${id.split("?").pop()}`
        : id;
      if (rule) {
        if (!injected.has(rule.origin))
          injected.set(rule.origin, { rule, ids: new Set() });
        injected.get(rule.origin).ids.add(shown);
      } else unattributed.add(shown);
      if (!id.includes("node_modules")) continue;
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
  const tool = async (name) => {
    const directory = join(root, "node_modules", name);
    const pkg = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    return {
      name,
      version: pkg.version,
      declared: declaredLicence(pkg),
      ...(await ownLicence(directory)),
      source: sourceUrl(pkg),
      location: `node_modules/${name}`,
    };
  };
  for (const [origin, { rule, ids }] of injected) {
    const base = rule.host
      ? await vendoredInside(rule.host, origin)
      : await tool(origin);
    out.push({
      ...base,
      shipped: "build-tool code in dist-web",
      direct: false,
      note: `${rule.what}: ${[...ids].sort().join(", ")}`,
    });
  }
  // Rollup writes the import/export statements that link the chunks.
  out.push({
    ...(await tool("rollup")),
    shipped: "build-tool code in dist-web",
    direct: false,
    note: "import/export statements linking the bundle's chunks",
  });
  for (const id of unattributed)
    out.push({
      name: `unattributed build-tool module ${id}`,
      version: "-",
      shipped: "build-tool code in dist-web",
      direct: false,
      declared: null,
      files: [],
      texts: [],
      source: null,
      location: "-",
      unattributed: true,
    });
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

/**
 * Problems of one component, from its declared licence and licence/notice
 * texts. The licence gate (`blocking`) and the test both use this.
 */
export function assess(c) {
  const grant = c.texts.filter((_, i) => !noticeFile.test(c.files[i]));
  // A notice file quotes other projects' licences; it is not the grant.
  c.found = [...new Set(grant.flatMap(classify))];
  // Every licence found anywhere in the package's licence or notice files.
  c.embedded = [...new Set(c.texts.flatMap(classify))];
  // Only the licence files' own copyright lines (a notice quotes other projects').
  c.copyright = copyrights(grant);
  const declared = spdxIds(c.declared);
  c.problems = [];
  if (c.unattributed)
    c.problems.push("build-tool code in the bundle with no known origin");
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
  const disallowed = c.found.filter((id) => !allowed.has(id));
  if (disallowed.length)
    c.problems.push(
      `licence file reads as ${disallowed.join(", ")}, outside the allow-list`,
    );
  if (c.files.length && !c.found.length)
    c.problems.push("licence file text not recognised");
  c.explanation = c.problems.length ? explanations[c.name] : undefined;
  return c;
}
/**
 * Problems that block shipping: a licence outside the allow-list (declared, or
 * read from a licence file without a reviewed explanation), missing licence
 * text, or build-tool code with no known origin.
 */
export function blocking(c) {
  return c.problems.filter(
    (p) =>
      /no licence text|no known origin|no declared licence|^declared .* outside the allow-list/.test(
        p,
      ) ||
      (/^licence file reads as .*, outside the allow-list$/.test(p) &&
        !c.explanation),
  );
}
export async function collect() {
  const components = [
    ...(await dependencies()),
    ...(await bundled()),
    ...(await vendored()),
  ];
  for (const c of components) assess(c);
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
  /** "A, B, C or D", most-used licence first. */
  const listing = (set) => {
    const uses = (id) =>
      components.filter((c) => spdxIds(c.declared).includes(id)).length;
    const sorted = [...set].sort(
      (a, b) => uses(b) - uses(a) || (a < b ? -1 : 1),
    );
    return sorted.length > 1
      ? `${sorted.slice(0, -1).join(", ")} or ${sorted.at(-1)}`
      : sorted.join("");
  };
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
    "The npm dependencies are as pinned by `package-lock.json`. A user's `npm install` of the",
    "published tarball does not use that lockfile: npm resolves transitive dependencies afresh",
    "within each package's version ranges, so a later install can receive newer versions (with",
    "possibly different licences) than this inventory lists. The bundled, build-tool and",
    "vendored code is fixed inside the tarball.",
    "",
    ...(pkg.license && existsSync(join(root, "LICENSE"))
      ? [
          `**Pymtheg is ${pkg.license} licensed;** see \`LICENSE\`.`,
          "",
          `All shipped third-party components are declared under ${listing(ids)}.` +
            ` These licences permit redistribution inside ${/^(MIT|[AEIOU])/.test(pkg.license) ? "an" : "a"} ${pkg.license}-licensed package provided` +
            " their notices are kept, which `THIRD-PARTY-NOTICES` does. Licences embedded inside some of" +
            " those packages are listed below and travel in `THIRD-PARTY-NOTICES` with their packages'" +
            " notices.",
        ]
      : [
          `**Pymtheg's own licence is not yet chosen.** \`package.json\` has no \`license\` field or the repository has no LICENSE file.`,
        ]),
    "",
    "## Summary",
    "",
    `${components.length} third-party components are shipped: ${by("dependency")} installed npm dependencies` +
      ` (direct and transitive, production only; ${by("optional")} optional), ${by("bundled")} packages bundled into \`dist-web/\`,` +
      ` ${by("build-tool")} sources of code the build tools write into \`dist-web/\` themselves, and ${by("vendored")} vendored grammars.` +
      ` Dev-only packages are not shipped and are listed separately at the end.`,
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
    `- Declared licences outside the allow-list (${[...allowed].join(", ")}): ${unusual.length ? unusual.join(", ") : "none"}.` +
      ' This covers each component\'s declared licence only; some shipped packages also carry other licences inside them, listed under "Licences embedded inside shipped packages".',
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
  const embedded = components
    .map((c) => ({
      c,
      rows: c.files
        .map((file, i) => ({
          file,
          ids: classify(c.texts[i]).filter(
            (id) => !spdxIds(c.declared).includes(id),
          ),
        }))
        .filter((r) => r.ids.length),
    }))
    .filter((e) => e.rows.length);
  md.push(
    "## Licences embedded inside shipped packages",
    "",
    "Licences found in a shipped package's licence or notice files that differ from the licence it",
    "declares (recognised by wording; text the reader does not recognise is not listed here). They",
    "cover parts of the package, such as code or data it took from other projects or its documentation.",
    "",
  );
  if (embedded.length) {
    md.push(
      "| Component | Declared | Embedded | In file |",
      "|---|---|---|---|",
    );
    for (const { c, rows } of embedded)
      for (const r of rows)
        md.push(
          `| ${c.name}@${c.version} | ${c.declared} | ${r.ids.join(", ")} | ${r.file} |`,
        );
  } else md.push("None.");
  md.push("");
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
  md.push(
    "## Code written by the build tools",
    "",
    "Besides the npm packages it bundles, the build writes some code of its own into `dist-web/`.",
    "Each origin is found from the bundler's virtual modules; `test/licences.test.mjs` also checks the",
    "built bundle's source maps independently, so emitted code from an unlisted origin fails the test.",
    "",
    "| Origin | Version | Licence | What it writes | Licence text from |",
    "|---|---|---|---|---|",
  );
  for (const c of components.filter((c) => c.shipped.startsWith("build-tool")))
    md.push(
      `| ${c.name} | ${c.version} | ${c.declared ?? "unknown"} | ${(c.note ?? "").replace(/\|/g, "\\|")} | ${c.files.join(", ") || "none"} |`,
    );
  md.push("", "## Vendored code", "");
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
        `| ${c.name.replace(/\|/g, "\\|")} | ${c.version.split(" @ ")[0]} | ${c.shipped}${c.direct ? " (direct)" : ""} | ${c.found.join(", ") || (c.files.length ? "unrecognised" : "no file")} | ${(c.copyright[0] ?? "none in its licence file").replace(/\|/g, "\\|")}${c.copyright.length > 1 ? ` (+${c.copyright.length - 1})` : ""} | ${c.source ?? "—"} |`,
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
    const blocked = data.components.filter((c) => blocking(c).length);
    for (const c of blocked)
      console.error(`${c.name}@${c.version}: ${blocking(c).join("; ")}`);
    process.exitCode = stale || blocked.length ? 1 : 0;
  } else {
    process.stdout.write(markdown);
  }
}
