// SPDX-License-Identifier: MIT
// C-22 equality check on a real pin: seeded random single-file edits, each
// followed by an incremental `graph index` (a fresh process, as the CLI) and
// a cold index of the same tree into a new store with the same project id;
// the two stores must be identical row for row (dump.mjs).
//   node scripts/reindex/random-edits.mjs <dist> <scratch> <repo id> <seed> <count> <out.json>
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compareRows, setPageCache, storeRows } from "./dump.mjs";

const [distArg, scratch, id, seedArg, countArg, outArg, ...flags] =
  process.argv.slice(2);
if (!outArg)
  throw Error(
    "usage: random-edits.mjs <dist> <scratch> <repo id> <seed> <count> <out.json> [--resume] [--store-dir DIR] [--cache-pages N] [--command] [--files LIST.json]",
  );
const dist = resolve(distArg);
const expectedSteps = Number(countArg);
if (!Number.isSafeInteger(expectedSteps) || expectedSteps < 1)
  throw Error("The edit count must be a positive integer");
const here = new URL(".", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync("sweep/repos.json", "utf8"));
const repo = (manifest.repos ?? manifest).find((item) => item.id === id);
const extensions = {
  go: [".go"],
  rust: [".rs"],
  typescript: [".ts", ".tsx", ".mts", ".cts"],
}[repo.language];
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const base = join(scratch, "random", `${name}.${seedArg}`);
const root = join(base, "tree");
const resume = flags.includes("--resume");
const storeDirAt = flags.indexOf("--store-dir");
const storeDir = storeDirAt < 0 ? undefined : resolve(flags[storeDirAt + 1]);
const temporary = storeDir && join(storeDir, `${name}.${seedArg}.sqlite`);
// C-33: the incremental side runs `graph index` on the project's own store,
// the cold side in the store directory, and each step is followed by an
// unchanged `graph index` that must verify without an index run and leave
// the store's bytes as they were.
const command = flags.includes("--command");
if (command && !temporary) throw Error("--command requires --store-dir");
const cacheAt = flags.indexOf("--cache-pages");
const cachePages = cacheAt < 0 ? undefined : Number(flags[cacheAt + 1]);
if (
  cachePages !== undefined &&
  (!temporary ||
    !Number.isSafeInteger(cachePages) ||
    cachePages < 1 ||
    cachePages > 262144)
)
  throw Error("--cache-pages requires --store-dir and 1 to 262144 pages");
if (existsSync(base) && !resume) throw Error(`exists: ${base}`);
mkdirSync(base, { recursive: true });
if (!existsSync(root))
  cpSync(join(scratch, "pins", name), root, { recursive: true });

// Deterministic PRNG (mulberry32).
let state = Number(seedArg) >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const sourceFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString()
  .split("\0")
  .filter((path) => extensions.some((extension) => path.endsWith(extension)))
  .sort();
// C-46: --files LIST.json names files (package manifests, followed source
// entries) that half of the edits target; the rest pick any source file.
const filesAt = flags.indexOf("--files");
const targeted =
  filesAt < 0 ? [] : JSON.parse(readFileSync(flags[filesAt + 1], "utf8"));
const files = sourceFiles;
const pickFile = () =>
  targeted.length && random() < 0.5 ? pick(targeted) : pick(files);
/** A manifest edit that keeps the JSON valid: add a field, drop the type
 * entry, or change the version. */
function manifestEdit(file, source) {
  const json = JSON.parse(source);
  const kind = pick(["manifest-field", "manifest-types", "manifest-version"]);
  if (kind === "manifest-field") json.c46RandomEdit = (json.c46RandomEdit ?? 0) + 1;
  if (kind === "manifest-types") {
    delete json.types;
    delete json.typings;
  }
  if (kind === "manifest-version") json.version = `0.0.${Math.floor(random() * 1000)}`;
  return { file, kind, text: JSON.stringify(json, null, 2) + "\n" };
}
const run = (script, ...rest) =>
  execFileSync(process.execPath, [join(here, script), dist, ...rest], {
    stdio: ["ignore", "ignore", "inherit"],
  });
const init = () =>
  execFileSync(
    process.execPath,
    [
      join(dist, "cli/main.js"),
      "init",
      ".",
      "--name",
      name,
      "--format",
      "json",
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
const graph =
  temporary && !command
    ? join(base, "incremental.sqlite")
    : join(root, ".pymtheg/rebuildable/graph.sqlite");
const directId = `random-${name}-${seedArg}`;
const clearStore = (store) => {
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(store + suffix)) rmSync(store + suffix);
};
function prepareStore(path) {
  if (cachePages !== undefined) setPageCache(path, cachePages);
}
function incremental(metrics) {
  if (!temporary || command) return run("index-once.mjs", root, metrics);
  clearStore(temporary);
  try {
    if (existsSync(graph)) copyFileSync(graph, temporary);
    prepareStore(temporary);
    run("cold-once.mjs", root, temporary, directId, metrics);
    copyFileSync(temporary, `${graph}.tmp`);
    renameSync(`${graph}.tmp`, graph);
  } finally {
    clearStore(temporary);
  }
}
if (!existsSync(graph)) {
  if (!temporary || command) init();
  incremental(join(base, "first.json"));
}
const projectId =
  temporary && !command ? directId : storeRows(graph).project[0];
// Choose renames from declarations a different file actually called in the
// initial graph. Keep that list for deterministic replay after an interruption.
const signatureTargetPath = join(base, "signature-targets.json");
let signatureTargets = [];
if (repo.language === "go") {
  if (!existsSync(signatureTargetPath)) {
    const db = new DatabaseSync(graph, { readOnly: true });
    try {
      const targets = db
        .prepare(
          `SELECT DISTINCT s.file,s.name FROM graph_links l
        JOIN graph_symbols s ON s.id=l.target
        WHERE l.module='go' AND l.kind='calls' AND s.kind='function' AND s.file!=l.file
        ORDER BY s.file,s.name`,
        )
        .all();
      writeFileSync(signatureTargetPath, JSON.stringify(targets));
    } finally {
      db.close();
    }
  }
  signatureTargets = JSON.parse(readFileSync(signatureTargetPath, "utf8"));
}
// Edits that keep, move or break code: a comment line, a blank line, a
// duplicated line, a deleted line, a no-op statement after an opening brace.
const kinds = ["comment", "blank", "duplicate", "delete", "statement"];
const statement = { go: "_ = 0", rust: "let _ = 0;", typescript: "void 0;" }[
  repo.language
];
const steps =
  resume && existsSync(outArg)
    ? JSON.parse(readFileSync(outArg, "utf8")).steps
    : [];
if (steps.some((step) => !step.equal))
  throw Error(
    "The previous run found a difference. Start a fresh run to retest.",
  );
const goKinds = [
  "body",
  "comment",
  "export",
  "signature",
  "signature",
  "interface",
  "interface",
  "embed",
  "embed",
  "import",
  "dot",
  "file-add",
  "file-delete",
  "build",
];
const goTargets = new Map();
const created = [];
function report() {
  writeFileSync(
    `${outArg}.tmp`,
    JSON.stringify(
      {
        id,
        seed: Number(seedArg),
        expectedSteps,
        steps,
        equal:
          steps.length === expectedSteps && steps.every((step) => step.equal),
      },
      null,
      1,
    ),
  );
  renameSync(`${outArg}.tmp`, outArg);
}

function goEdit(step, file, source) {
  const header = /^package ([\p{L}_][\p{L}\p{N}_]*)[^\S\n]*$/mu.exec(source);
  if (!header)
    return { file, kind: "comment", text: source + "\n// Random edit.\n" };
  const kind = pick(goKinds);
  const anchor = header.index + header[0].length;
  const insert = (at, text) => source.slice(0, at) + text + source.slice(at);
  const suffix = file.endsWith("_test.go") ? "_test.go" : ".go";
  const added = join(dirname(file), `c27_random_${step}${suffix}`);
  const name = `C27Random${step}`;
  const declaration = goTargets.get(file);
  switch (kind) {
    case "body": {
      const functions = [...source.matchAll(/^func [^\n{}]*\)[^\n{}]*\{/gm)];
      if (functions.length) {
        const match = pick(functions);
        return {
          file,
          kind,
          text: insert(match.index + match[0].length, " _ = 0;"),
        };
      }
      break;
    }
    case "signature": {
      const start = Math.floor(random() * signatureTargets.length);
      for (const { file: targetFile, name: targetName } of [
        ...signatureTargets.slice(start),
        ...signatureTargets.slice(0, start),
      ]) {
        const text = sourceOf(targetFile);
        const header = new RegExp(
          `^(func\\s+)${targetName}(?=\\s*[\\[(])`,
          "mu",
        );
        if (header.test(text))
          return {
            file: targetFile,
            kind,
            text: text.replace(header, `$1${name}`),
          };
      }
      break;
    }
    case "interface": {
      const interfaces = [...source.matchAll(/^type \w+ interface \{/gm)];
      if (interfaces.length) {
        const match = pick(interfaces);
        return {
          file,
          kind,
          text: insert(match.index + match[0].length, `\n${name}()\n`),
        };
      }
      return {
        file,
        kind,
        text: source + `\ntype ${name} interface { String() string }\n`,
      };
    }
    case "embed":
      return {
        file,
        kind,
        text:
          source +
          `\ntype ${name}Inner struct{}\nfunc (${name}Inner) String() string { return "" }\ntype ${name} struct{ ${name}Inner }\n`,
      };
    case "import":
    case "dot":
      return {
        file,
        kind,
        text: insert(
          anchor,
          `\n\nimport ${kind === "dot" ? "." : "_"} "${pick(["io", "context", "bytes", "strings"])}"\n`,
        ),
      };
    case "file-add":
      created.push(added);
      return {
        file: added,
        kind,
        text: `package ${header[1]}\n\nfunc ${name}() int { return 1 }\n`,
      };
    case "file-delete": {
      if (created.length) {
        const index = Math.floor(random() * created.length);
        return { file: created.splice(index, 1)[0], kind };
      }
      created.push(added);
      return {
        file: added,
        kind: "file-add",
        text: `package ${header[1]}\n\nfunc ${name}() int { return 1 }\n`,
      };
    }
    case "build":
      return {
        file,
        kind,
        text: /^\/\/go:build .+$/m.test(source)
          ? source.replace(/^\/\/go:build .+$/m, `//go:build c27_tag_${step}`)
          : `//go:build c27_tag_${step}\n\n${source}`,
      };
    case "export": {
      if (declaration && source.includes(declaration)) {
        goTargets.delete(file);
        return {
          file,
          kind: "remove-export",
          text: source.replace(declaration, ""),
        };
      }
      const added = `\nfunc ${name}() int { return 1 }\n`;
      goTargets.set(file, added);
      return { file, kind: "add-export", text: source + added };
    }
  }
  return { file, kind: "comment", text: source + "\n// Random edit.\n" };
}

// Replay the seed from pristine source when resuming so no PRNG state or
// generated source needs to be kept in the evidence.
const sourceByFile = new Map();
const sourceOf = (file) =>
  sourceByFile.get(file) ??
  readFileSync(join(scratch, "pins", name, file), "utf8");
for (let step = 0; step < expectedSteps; step++) {
  let file = pickFile();
  const original = sourceOf(file);
  let edit;
  let at = 0;
  if (repo.language === "go") edit = goEdit(step, file, original);
  else if (file.endsWith(".json")) edit = manifestEdit(file, original);
  else {
    const lines = original.split("\n");
    let kind = pick(kinds);
    at = Math.floor(random() * lines.length);
    if (kind === "statement") {
      const braces = lines
        .map((line, index) => (line.trimEnd().endsWith("{") ? index : -1))
        .filter((index) => index >= 0);
      if (braces.length) lines.splice(pick(braces) + 1, 0, statement);
      else kind = "comment";
    }
    if (kind === "comment") lines.splice(at, 0, "// c22 random edit");
    if (kind === "blank") lines.splice(at, 0, "");
    if (kind === "duplicate") lines.splice(at, 0, lines[at] ?? "");
    if (kind === "delete") lines.splice(at, 1);
    edit = { file, kind, text: lines.join("\n") };
  }
  file = edit.file;
  const { kind, text } = edit;
  if (text !== undefined) sourceByFile.set(file, text);
  else sourceByFile.delete(file);
  if (step < steps.length) continue;
  const path = join(root, file);
  if (text !== undefined) writeFileSync(path, text);
  else if (existsSync(path)) rmSync(path);
  incremental(join(base, `step-${step}.json`));
  const cold = temporary ?? join(base, `cold-${step}.sqlite`);
  clearStore(cold);
  let differences;
  try {
    prepareStore(cold);
    run("cold-once.mjs", root, cold, projectId);
    differences = compareRows(storeRows(graph), storeRows(cold));
  } finally {
    clearStore(cold);
  }
  const measured = JSON.parse(
    readFileSync(join(base, `step-${step}.json`), "utf8"),
  );
  let noEdit;
  if (command) {
    const before = readFileSync(graph);
    run("index-once.mjs", root, join(base, `no-edit-${step}.json`));
    const again = JSON.parse(
      readFileSync(join(base, `no-edit-${step}.json`), "utf8"),
    );
    noEdit = {
      complete: again.complete,
      verified: again.stages["store.beginRun"] === undefined,
      identical: before.equals(readFileSync(graph)),
      cpuMs: again.cpuMs,
    };
    if (!noEdit.complete || !noEdit.verified || !noEdit.identical)
      differences.push({ table: "no-edit", noEdit });
  }
  steps.push({
    step,
    file,
    kind,
    line: at + 1,
    equal: differences.length === 0,
    differences,
    wallMs: measured.wallMs,
    failed: measured.report?.failedCount,
    resolvedFiles: measured.counts?.["resolve.go.decisionFiles"] ?? 0,
    ...(noEdit ? { noEdit } : {}),
  });
  console.log(
    `${id} step ${step} ${kind} ${file}:${at + 1}: ${differences.length ? "DIFFERENT " + JSON.stringify(differences).slice(0, 1500) : "equal"}`,
  );
  report();
  if (differences.length)
    throw Error(`Incremental graph differs after ${id} step ${step}`);
}
report();
