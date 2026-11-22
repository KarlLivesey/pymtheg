// SPDX-License-Identifier: MIT
/**
 * C-43: the opt-in Rust toolchain route. Locate the user's rust-analyzer,
 * cargo and rustc, run `rust-analyzer scip` on a copy of the project and keep
 * the index keyed by every input that determines it. Only for a project that
 * opted in (`graph.trust: "trusted"` or `graph.toolchain.rust`): running
 * rust-analyzer runs the project's build scripts and proc macros, as building
 * it would.
 *
 * Policy (decisions D17, D21, D22; docs/changes/C-43.md):
 * - offline (CARGO_NET_OFFLINE), never a download;
 * - one configuration: the host target, default features, all targets,
 *   cfg(test) on, build scripts and proc macros on; the rustup toolchain
 *   pinned to the one rustc answers with outside the project, so a
 *   rust-toolchain file in the project cannot pick or install another;
 * - the project is never written: rust-analyzer runs in a copy of the
 *   project (the snapshot's Rust files written over it), with a throwaway
 *   target directory and a crate-cache overlay per run, outside the project,
 *   removed afterwards;
 * - a closed environment, a bounded run and bounded output, cancellable
 *   through the index's signal (the process group is killed).
 * No sandbox.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import {
  cp,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import {
  runProcess,
  type ProcessClock,
  type ProcessResult,
} from "../../../backends/process.js";

/** Bumped whenever the route's run or its records change: old caches are not read. */
export const ROUTE_VERSION = "c43-1";
/** A bound on one rust-analyzer run; a project needing more is reported, not hung on. */
const RUN_LIMIT_MS = 60 * 60 * 1000;
/** rust-analyzer's own output (progress and duplicate-symbol reports). */
const OUTPUT_LIMIT = 256 * 1024 * 1024;
/** The SCIP index is read whole; a larger one is reported. */
const SCIP_LIMIT = 1024 * 1024 * 1024;
/** Cached indexes kept in the rebuildable folder. */
const KEEP = 2;

export type Unavailable = { unavailable: string };

export interface RustInstallation {
  analyzer: string;
  cargo: string;
  rustc: string;
  analyzerVersion: string;
  rustcVersion: string;
  host: string;
  sysroot: string;
  /** The rustup toolchain every process is pinned to, when rustup manages it. */
  rustupToolchain?: string;
  configuration: string;
  cargoHome: string;
  /** Environment shared by every process (PATH, HOME, rustup's own). */
  base: Record<string, string>;
}

/** The rust-analyzer settings of the one configuration. */
export const ANALYZER_CONFIG = {
  cargo: {
    features: [],
    noDefaultFeatures: false,
    allTargets: true,
    buildScripts: { enable: true },
    sysroot: "discover",
  },
  procMacro: { enable: true },
  cfg: { setTest: true },
};

const find = (
  name: string,
  dirs: readonly string[],
): string | undefined => {
  for (const dir of dirs) {
    if (!dir || !isAbsolute(dir)) continue;
    const path = join(dir, name);
    try {
      if (statSync(path).isFile()) return path;
    } catch {
      /* next */
    }
  }
  return undefined;
};

/**
 * The trusted rust-analyzer: the setting's absolute path, or rust-analyzer
 * on the user's PATH. Not resolved through symlinks: a rustup proxy picks
 * the tool by the name it is run as.
 */
function locate(
  setting: unknown,
  env: Readonly<Record<string, string | undefined>>,
): { analyzer: string; cargo: string; rustc: string } | Unavailable {
  const path = (env.PATH ?? "").split(delimiter);
  let analyzer: string | undefined;
  if (typeof setting === "string") {
    if (!isAbsolute(setting))
      return {
        unavailable: `graph.toolchain.rust is not absolute: ${setting}`,
      };
    try {
      if (!statSync(setting).isFile())
        return { unavailable: `${setting} is not a file` };
    } catch {
      return { unavailable: `${setting} does not exist` };
    }
    analyzer = setting;
  } else analyzer = find("rust-analyzer", path);
  if (!analyzer) return { unavailable: "rust-analyzer was not found on PATH" };
  // cargo and rustc beside rust-analyzer first (one toolchain), then PATH.
  const dirs = [dirname(analyzer), ...path];
  const cargo = find("cargo", dirs);
  const rustc = find("rustc", dirs);
  if (!cargo) return { unavailable: "cargo was not found on PATH" };
  if (!rustc) return { unavailable: "rustc was not found on PATH" };
  return { analyzer, cargo, rustc };
}

const firstLine = (result: ProcessResult) =>
  (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
const cancelled = (result: ProcessResult) => {
  if (result.kind === "cancelled") throw Error("Indexing was cancelled");
};

/** The installation, asked of itself in a closed environment outside the project. */
export async function installation(
  setting: unknown,
  env: Readonly<Record<string, string | undefined>>,
  workDir: string,
  signal?: AbortSignal,
): Promise<RustInstallation | Unavailable> {
  const tools = locate(setting, env);
  if ("unavailable" in tools) return tools;
  const scratch = join(workDir, "env");
  await mkdir(scratch, { recursive: true });
  const home = env.HOME ?? "";
  const base: Record<string, string> = {
    // The toolchain first, then the user's own PATH: build scripts and
    // proc macros are linked with the system linker and may call cc,
    // pkg-config or cmake, as building the project would.
    PATH: [
      ...new Set([
        dirname(tools.analyzer),
        dirname(tools.cargo),
        dirname(tools.rustc),
        ...(env.PATH ?? "").split(delimiter).filter((dir) => isAbsolute(dir)),
      ]),
    ].join(delimiter),
    ...(isAbsolute(home) ? { HOME: home } : {}),
    ...(isAbsolute(env.RUSTUP_HOME ?? "")
      ? { RUSTUP_HOME: env.RUSTUP_HOME! }
      : {}),
    // The user's own toolchain choice, asked outside the project; replaced
    // below by the toolchain it names.
    ...(env.RUSTUP_TOOLCHAIN ? { RUSTUP_TOOLCHAIN: env.RUSTUP_TOOLCHAIN } : {}),
    CARGO_TERM_COLOR: "never",
    RUST_BACKTRACE: "0",
  };
  const ask = (command: string, args: string[], extra = {}) =>
    runProcess(command, args, {
      cwd: scratch,
      timeoutMs: 120_000,
      ...(signal ? { signal } : {}),
      env: { ...base, ...extra },
    });
  const sysrootRun = await ask(tools.rustc, ["--print", "sysroot"]);
  cancelled(sysrootRun);
  if (sysrootRun.kind !== "exited" || sysrootRun.code !== 0)
    return {
      unavailable: `${tools.rustc} did not answer --print sysroot: ${firstLine(sysrootRun)}`,
    };
  const sysroot = sysrootRun.stdout.trim();
  // rustup: pin every process to this toolchain.
  const rustupToolchain =
    basename(dirname(sysroot)) === "toolchains" ? basename(sysroot) : undefined;
  if (rustupToolchain) base.RUSTUP_TOOLCHAIN = rustupToolchain;
  const verbose = await ask(tools.rustc, ["-vV"]);
  cancelled(verbose);
  const host = /^host: (\S+)$/m.exec(verbose.stdout)?.[1];
  const release = /^release: (\S+)$/m.exec(verbose.stdout)?.[1];
  if (verbose.kind !== "exited" || verbose.code !== 0 || !host || !release)
    return {
      unavailable: `${tools.rustc} did not answer -vV: ${firstLine(verbose)}`,
    };
  if (!existsSync(join(sysroot, "lib", "rustlib", "src", "rust", "library")))
    return {
      unavailable: `rust-src is not installed for ${rustupToolchain ?? sysroot} (rustup component add rust-src)`,
    };
  const version = await ask(tools.analyzer, ["--version"]);
  cancelled(version);
  const analyzerVersion = version.stdout.trim().split("\n")[0] ?? "";
  if (
    version.kind !== "exited" ||
    version.code !== 0 ||
    !analyzerVersion.startsWith("rust-analyzer")
  )
    return {
      unavailable: `${tools.analyzer} did not answer --version: ${firstLine(version)}`,
    };
  const cargoHome = isAbsolute(env.CARGO_HOME ?? "")
    ? env.CARGO_HOME!
    : isAbsolute(home)
      ? join(home, ".cargo")
      : "";
  if (!cargoHome)
    return { unavailable: "no crate cache location (CARGO_HOME or HOME unset)" };
  return {
    ...tools,
    analyzerVersion,
    rustcVersion: `rustc ${release}`,
    host,
    sysroot,
    ...(rustupToolchain ? { rustupToolchain } : {}),
    configuration: `${host} (host), default features, all targets, cfg(test) on, build scripts and proc macros on, offline`,
    cargoHome,
    base,
  };
}

const sha = (...parts: (string | Uint8Array)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\u0000");
  return hash.digest("hex");
};

/** Directories never copied or listed: version control, build output, dependencies, Pymtheg's own. */
const skipped = (path: string, name: string, top: boolean) =>
  name === ".git" ||
  name === ".pymtheg" ||
  name === "node_modules" ||
  (top && name === "target") ||
  existsSync(join(path, "CACHEDIR.TAG"));

/**
 * Every project file the index does not capture, by path, size and
 * modification time: build scripts, `include_str!` and `include!` read them.
 * A changed time only costs a re-run.
 */
async function treeListing(
  root: string,
  captured: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<string> {
  const lines: string[] = [];
  const walk = async (dir: string, rel: string) => {
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      lines.push(`${rel}/\u0000unreadable`);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skipped(path, entry.name, rel === "")) await walk(path, relative);
      } else if (!captured.has(relative)) {
        try {
          const info = await stat(path);
          lines.push(`${relative}\u0000${info.size}\u0000${info.mtimeMs}`);
        } catch {
          lines.push(`${relative}\u0000missing`);
        }
      }
    }
  };
  await walk(root, "");
  return lines.join("\n");
}

/** Which lockfile packages are in the crate cache, so a later download changes the key. */
async function crateCacheState(
  cargoHome: string,
  lockText: string | undefined,
): Promise<string> {
  const registries: string[] = [];
  try {
    for (const dir of await readdir(join(cargoHome, "registry", "cache")))
      registries.push(join(cargoHome, "registry", "cache", dir));
  } catch {
    /* no cache */
  }
  const archives = new Set<string>();
  for (const dir of registries)
    try {
      for (const name of await readdir(dir)) archives.add(name);
    } catch {
      /* unreadable */
    }
  let gitDb: string[] = [];
  try {
    gitDb = (await readdir(join(cargoHome, "git", "db"))).sort();
  } catch {
    /* none */
  }
  if (lockText === undefined)
    return `no Cargo.lock\n${[...archives].sort().join("\n")}\n${gitDb.join("\n")}`;
  const lines: string[] = [];
  for (const block of lockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const source = /^source = "([^"]+)"/m.exec(block)?.[1];
    if (!name || !version || !source) continue;
    if (source.startsWith("git+")) lines.push(`${name} ${version} git`);
    else
      lines.push(
        `${name} ${version} ${archives.has(`${name}-${version}.crate`) ? 1 : 0}`,
      );
  }
  return `${lines.sort().join("\n")}\n${gitDb.join("\n")}`;
}

/** A copy of a directory tree as hard links; a plain copy across devices. */
async function linkTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await linkTree(source, target);
    else if (entry.isFile())
      try {
        await link(source, target);
      } catch {
        await cp(source, target);
      }
  }
}

/**
 * The run's own CARGO_HOME. The user's configuration is copied; the
 * registry index is hard-linked file by file (cargo may add cache files
 * there); the downloaded archives and git databases are linked read-only
 * (offline, cargo only reads them). Crates are extracted into the overlay.
 */
async function crateCacheOverlay(user: string, overlay: string): Promise<void> {
  await mkdir(join(overlay, "registry"), { recursive: true });
  await mkdir(join(overlay, "git"), { recursive: true });
  for (const name of ["config.toml", "config"])
    if (existsSync(join(user, name)))
      await cp(join(user, name), join(overlay, name));
  if (existsSync(join(user, "registry", "index")))
    await linkTree(
      join(user, "registry", "index"),
      join(overlay, "registry", "index"),
    );
  if (existsSync(join(user, "registry", "cache")))
    await symlink(
      join(user, "registry", "cache"),
      join(overlay, "registry", "cache"),
    );
  if (existsSync(join(user, "git", "db")))
    await symlink(join(user, "git", "db"), join(overlay, "git", "db"));
}

export interface CargoFacts {
  /** Package names whose library is a proc macro. */
  procMacroPackages: string[];
  /** Build-script packages and proc-macro targets the run must have built. */
  buildScripts: string[];
  procMacroTargets: string[];
  /** Workspace library roots under the project, relative. */
  libraryRoots: string[];
}

interface MetadataTarget {
  kind: string[];
  name: string;
  src_path: string;
}
interface Metadata {
  packages: {
    id: string;
    name: string;
    targets: MetadataTarget[];
  }[];
  workspace_members: string[];
  resolve?: { nodes: { id: string }[] } | null;
}

/** What `cargo metadata` says the run must build, for partial detection. */
function cargoFacts(metadata: Metadata, project: string): CargoFacts {
  const resolved = new Set(
    (metadata.resolve?.nodes ?? []).map((node) => node.id),
  );
  const members = new Set(metadata.workspace_members);
  const procMacroPackages = new Set<string>();
  const buildScripts = new Set<string>();
  const procMacroTargets = new Set<string>();
  const libraryRoots = new Set<string>();
  for (const pkg of metadata.packages) {
    const built = resolved.size ? resolved.has(pkg.id) : members.has(pkg.id);
    for (const target of pkg.targets) {
      if (target.kind.includes("proc-macro")) {
        procMacroPackages.add(pkg.name);
        if (built) procMacroTargets.add(target.name.replace(/-/g, "_"));
      }
      if (built && target.kind.includes("custom-build"))
        buildScripts.add(pkg.name);
      if (
        members.has(pkg.id) &&
        (target.kind.includes("lib") || target.kind.includes("proc-macro")) &&
        target.src_path.startsWith(project + "/")
      )
        libraryRoots.add(target.src_path.slice(project.length + 1));
    }
  }
  const sorted = (set: Set<string>) => [...set].sort();
  return {
    procMacroPackages: sorted(procMacroPackages),
    buildScripts: sorted(buildScripts),
    procMacroTargets: sorted(procMacroTargets),
    libraryRoots: sorted(libraryRoots),
  };
}

/**
 * Build scripts that did not finish and proc macros that were not built,
 * read from the run's target directory: rust-analyzer exits 0 and says
 * nothing when a build script fails.
 */
async function unfinished(target: string, facts: CargoFacts): Promise<string[]> {
  const out: string[] = [];
  const attempted = new Map<string, boolean>();
  try {
    const build = join(target, "debug", "build");
    for (const dir of await readdir(build)) {
      const name = dir.replace(/-[0-9a-f]{16}$/, "");
      const finished = existsSync(join(build, dir, "output"));
      // Each package has a compile directory (never an output) and a run directory.
      const ran = existsSync(join(build, dir, "invoked.timestamp"));
      if (!attempted.has(name)) attempted.set(name, false);
      if (finished) attempted.set(name, true);
      else if (ran && !attempted.get(name)) attempted.set(name, false);
    }
  } catch {
    /* no build directory: nothing ran */
  }
  for (const name of facts.buildScripts)
    if (attempted.get(name) !== true)
      out.push(`build script of ${name} did not finish`);
  let deps: string[] = [];
  try {
    deps = await readdir(join(target, "debug", "deps"));
  } catch {
    /* none built */
  }
  for (const name of facts.procMacroTargets)
    if (
      !deps.some(
        (file) =>
          file.startsWith(`lib${name}-`) ||
          (file.startsWith(`${name}-`) && file.endsWith(".dll")),
      )
    )
      out.push(`proc macro ${name} was not built`);
  return out;
}

export interface AnalyzerRun {
  scip: Uint8Array;
  /** Why the index is partial; empty when it is complete. */
  partial: string[];
  facts: CargoFacts;
  /** Read from the rebuildable folder, not run (inputs unchanged). */
  cached: boolean;
  key: string;
  /** An observation only. */
  elapsedMs: number;
}

/** Test hooks: a controlled clock and run limit (the timeout path). */
export interface RunControls {
  clock?: ProcessClock;
  limitMs?: number;
}

/**
 * The route's key for this snapshot: the route and tool versions, the
 * configuration, every captured manifest, lockfile and Cargo configuration,
 * every captured Rust file's path and content hash, every other project
 * file's path, size and time, and which lockfile packages are in the crate
 * cache.
 */
export async function routeKey(
  root: string,
  install: RustInstallation,
  sources: readonly { path: string; hash: string }[],
  contexts: readonly { path: string; text?: string | undefined }[],
  signal?: AbortSignal,
): Promise<string> {
  const captured = new Set([
    ...sources.map((file) => file.path),
    ...contexts.map((file) => file.path),
  ]);
  const lock = contexts.find((file) => file.path === "Cargo.lock")?.text;
  return sha(
    ROUTE_VERSION,
    install.analyzer,
    install.analyzerVersion,
    install.rustcVersion,
    install.sysroot,
    install.configuration,
    JSON.stringify(ANALYZER_CONFIG),
    install.cargoHome,
    ...[...contexts]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((file) => `${file.path}\u0000${file.text === undefined ? "\u0000absent" : sha(file.text)}`),
    ...[...sources]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((file) => `${file.path}\u0000${file.hash}`),
    await treeListing(root, captured, signal),
    await crateCacheState(install.cargoHome, lock),
  );
}

/** rust-analyzer's SCIP index of this snapshot, from the cache or a fresh run. */
export async function runAnalyzer(
  root: string,
  install: RustInstallation,
  sources: readonly { path: string; text: string; hash: string }[],
  contexts: readonly { path: string; text?: string | undefined }[],
  workDir: string,
  signal?: AbortSignal,
  controls: RunControls = {},
): Promise<AnalyzerRun | Unavailable> {
  await mkdir(workDir, { recursive: true });
  const key = await routeKey(root, install, sources, contexts, signal);
  const stem = join(workDir, `scip-${key.slice(0, 32)}`);
  if (existsSync(`${stem}.json`) && existsSync(`${stem}.scip`)) {
    const record = JSON.parse(await readFile(`${stem}.json`, "utf8")) as {
      partial: string[];
      facts: CargoFacts;
    };
    return {
      scip: await readFile(`${stem}.scip`),
      partial: record.partial,
      facts: record.facts,
      cached: true,
      key,
      elapsedMs: 0,
    };
  }
  const run = join(workDir, `run-${randomUUID()}`);
  const project = join(run, "project");
  const target = join(run, "target");
  const env = {
    ...install.base,
    CARGO_HOME: join(run, "cargo-home"),
    CARGO_TARGET_DIR: target,
    CARGO_NET_OFFLINE: "true",
  };
  try {
    signal?.throwIfAborted();
    await mkdir(run, { recursive: true });
    await cp(root, project, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const rel = source === root ? "" : source.slice(root.length + 1);
        if (!rel) return true;
        let isDir = false;
        try {
          isDir = statSync(source).isDirectory();
        } catch {
          return true;
        }
        return !isDir || !skipped(source, basename(source), !rel.includes("/"));
      },
    });
    // The snapshot's Rust files, as the index read them.
    for (const file of sources) {
      const path = join(project, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.text);
    }
    await crateCacheOverlay(install.cargoHome, env.CARGO_HOME);
    await mkdir(target, { recursive: true });
    signal?.throwIfAborted();
    const partial: string[] = [];
    // cargo metadata as rust-analyzer will ask it; when it fails offline,
    // rust-analyzer silently falls back to the workspace alone.
    const meta = await runProcess(
      install.cargo,
      [
        "metadata",
        "--format-version",
        "1",
        "--offline",
        "--filter-platform",
        install.host,
      ],
      {
        cwd: project,
        timeoutMs: 10 * 60_000,
        maxBytes: OUTPUT_LIMIT,
        env,
        ...(signal ? { signal } : {}),
        ...(controls.clock ? { clock: controls.clock } : {}),
      },
    );
    cancelled(meta);
    let facts: CargoFacts = {
      procMacroPackages: [],
      buildScripts: [],
      procMacroTargets: [],
      libraryRoots: [],
    };
    if (meta.kind === "exited" && meta.code === 0)
      try {
        facts = cargoFacts(JSON.parse(meta.stdout) as Metadata, project);
      } catch {
        partial.push("cargo metadata gave unreadable output");
      }
    else
      partial.push(
        `cargo metadata failed offline (dependencies not in the crate cache?): ${firstLine(meta)}`,
      );
    await writeFile(join(run, "analyzer.json"), JSON.stringify(ANALYZER_CONFIG));
    const output = join(run, "index.scip");
    const started = performance.now();
    const result = await runProcess(
      install.analyzer,
      ["scip", ".", "--output", output, "--config-path", join(run, "analyzer.json")],
      {
        cwd: project,
        timeoutMs: controls.limitMs ?? RUN_LIMIT_MS,
        maxBytes: OUTPUT_LIMIT,
        env,
        ...(signal ? { signal } : {}),
        ...(controls.clock ? { clock: controls.clock } : {}),
      },
    );
    const elapsedMs = performance.now() - started;
    cancelled(result);
    if (result.kind !== "exited" || result.code !== 0)
      return {
        unavailable: `rust-analyzer ${result.kind === "exited" ? `exited ${result.code}` : result.kind}: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`,
      };
    let size = 0;
    try {
      size = (await stat(output)).size;
    } catch {
      return { unavailable: "rust-analyzer wrote no index" };
    }
    if (size > SCIP_LIMIT)
      return { unavailable: `the index is larger than ${SCIP_LIMIT} bytes` };
    const scip = await readFile(output);
    partial.push(...(await unfinished(target, facts)));
    // Keep it: a later index with the same inputs reads it.
    const id = randomUUID();
    await writeFile(`${stem}.${id}.partial`, scip);
    await rename(`${stem}.${id}.partial`, `${stem}.scip`);
    await writeFile(
      `${stem}.json.${id}.partial`,
      JSON.stringify({ partial, facts }),
    );
    await rename(`${stem}.json.${id}.partial`, `${stem}.json`);
    await prune(workDir, stem);
    return { scip, partial, facts, cached: false, key, elapsedMs };
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}

/** Keeps the newest KEEP cached indexes. */
async function prune(workDir: string, keep: string): Promise<void> {
  const entries: { stem: string; time: number }[] = [];
  for (const name of await readdir(workDir)) {
    if (!/^scip-[0-9a-f]{32}\.json$/.test(name)) continue;
    const stem = join(workDir, name.slice(0, -5));
    try {
      entries.push({ stem, time: (await stat(join(workDir, name))).mtimeMs });
    } catch {
      /* gone */
    }
  }
  entries.sort((a, b) => b.time - a.time);
  for (const entry of entries.slice(KEEP)) {
    if (entry.stem === keep) continue;
    await rm(`${entry.stem}.json`, { force: true });
    await rm(`${entry.stem}.scip`, { force: true });
  }
}
