// SPDX-License-Identifier: MIT
// Build with the pinned compiler and capture its real output writes in memory.
// No package-manager command, project script, config JS or plugin is loaded.
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const [scratch, receipts, drawPath, output] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const pins = new Map(read(receipts).repos.map((repo) => [repo.id, repo]));
const lib = dirname(
  realpathSync(createRequire(import.meta.url).resolve("typescript")),
);
const candidateConfig = /^(?:tsconfig|jsconfig).*\.json$/;
const inside = (root, path) => path === root || path.startsWith(root + sep);
const emitted = /\.(?:d\.[cm]?ts|[cm]?js|jsx)$/;

function environment(root) {
  const safe = (name, libraries = false) => {
    const path = resolve(root, name);
    if (!inside(root, path) && !(libraries && inside(lib, path)))
      return undefined;
    try {
      const real = realpathSync(path);
      return inside(root, real) || (libraries && inside(lib, real))
        ? path
        : undefined;
    } catch {
      return undefined;
    }
  };
  const fileExists = (name) => {
    const path = safe(name, true);
    return !!path && ts.sys.fileExists(path);
  };
  const readFile = (name) => {
    const path = safe(name, true);
    return path && ts.sys.readFile(path);
  };
  const directoryExists = (name) => {
    const path = safe(name, true);
    return !!path && ts.sys.directoryExists(path);
  };
  const entries = (name) => {
    const directory = safe(name, true);
    if (!directory || !ts.sys.directoryExists(directory))
      return { files: [], directories: [] };
    const files = [];
    const directories = [];
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      const kind =
        item.isSymbolicLink() && safe(path, true) ? statSync(path) : item;
      if (kind.isDirectory()) directories.push(item.name);
      else if (kind.isFile()) files.push(item.name);
    }
    return { files: files.sort(), directories: directories.sort() };
  };
  const readDirectory = (name, extensions, excludes, includes, depth) =>
    ts.matchFiles(
      name,
      extensions,
      excludes,
      includes,
      true,
      root,
      depth,
      entries,
      (path) => path,
    );
  function parse(config) {
    return ts.getParsedCommandLineOfConfigFile(
      config,
      {},
      {
        useCaseSensitiveFileNames: true,
        readDirectory,
        readFile,
        fileExists,
        getCurrentDirectory: () => root,
        onUnRecoverableConfigFileDiagnostic() {},
      },
    );
  }
  return {
    safe,
    parse,
    emit(parsed, wanted) {
      const host = {
        ...ts.createCompilerHost(parsed.options),
        fileExists,
        readFile,
        directoryExists,
        getSourceFile(name, languageVersion) {
          const text = readFile(name);
          return text === undefined
            ? undefined
            : ts.createSourceFile(name, text, languageVersion, true);
        },
        getDirectories: (path) => entries(path).directories,
        getCurrentDirectory: () => root,
        getParsedCommandLine: (path) => parse(path),
        realpath: (name) => {
          const path = safe(name, true);
          return path ? realpathSync(path) : name;
        },
        writeFile: () => {
          throw Error("Audit builds capture their writes");
        },
      };
      const picked = new Map();
      try {
        const program = ts.createProgram({
          rootNames: parsed.fileNames,
          options: parsed.options,
          projectReferences: parsed.projectReferences,
          host,
        });
        const result = program.emit(
          undefined,
          (name, text, _bom, _error, sources) => {
            if (!inside(root, name) || !emitted.test(name)) return;
            const path = relative(root, name);
            const inputs = (sources ?? []).map((source) =>
              relative(root, source.fileName),
            );
            if (wanted.has(path) || inputs.some((input) => wanted.has(input)))
              picked.set(path, { path, inputs, text: text.slice(0, 24_000) });
          },
        );
        return {
          skipped: result.emitSkipped,
          diagnostics: result.diagnostics.map(({ code }) => code),
          found: [...picked.values()],
        };
      } catch (error) {
        return { unavailable: error.constructor.name, found: [] };
      }
    },
  };
}

const answer = [];
for (const [pin, rows] of Map.groupBy(read(drawPath), (row) => row.pin)) {
  const repo = pins.get(pin);
  const root = realpathSync(
    resolve(scratch, repo.sourceAttempt ?? repo.attempt, "checkout"),
  );
  const io = environment(root);
  const byConfig = new Map();
  for (const row of rows) {
    let config = row.note.config;
    if (row.note.proof === "convention") {
      // Only use a concrete captured tsc config for this experiment.
      let dir = dirname(join(root, row.note.output));
      while (inside(root, dir) && !io.safe(join(dir, "package.json"))) {
        if (dir === root) break;
        dir = dirname(dir);
      }
      const choices = ["tsconfig.build.json", "tsconfig.json"]
        .map((file) => join(dir, file))
        .filter((file) => io.safe(file));
      config = choices.length ? relative(root, choices[0]) : "";
    }
    answer.push(row);
    if (!candidateConfig.test(config.split("/").at(-1) ?? "")) continue;
    const path = io.safe(join(root, config));
    if (!path) continue;
    const selected = byConfig.get(path) ?? [];
    selected.push(row);
    byConfig.set(path, selected);
  }
  for (const [config, rows] of byConfig) {
    const parsed = io.parse(config);
    if (!parsed || parsed.errors.length || parsed.options.noEmit) continue;
    const wanted = new Set(
      rows.flatMap((row) => [row.note.output, row.target[0]]),
    );
    const result = io.emit(parsed, wanted);
    for (const row of rows)
      row.build = {
        config: relative(root, config),
        skipped: result.skipped,
        diagnostics: result.diagnostics,
        unavailable: result.unavailable,
        selected: result.found.find(({ path }) => path === row.note.output),
        declarations: result.found.filter(
          ({ inputs, path }) =>
            inputs.includes(row.target[0]) && /\.d\.[cm]?ts$/.test(path),
        ),
      };
  }
}
writeFileSync(output, JSON.stringify(answer));
