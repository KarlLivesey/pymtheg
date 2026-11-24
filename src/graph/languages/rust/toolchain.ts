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
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { readScip, type ScipDocument } from "./scip.js";
import {
  runProcess,
  type ProcessClock,
  type ProcessResult,
} from "../../../backends/process.js";

/** Bumped whenever the route's run or its records change: old caches are not read. */
export const ROUTE_VERSION = "c43-3";
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

const find = (name: string, dirs: readonly string[]): string | undefined => {
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
  // rustup: pin every process to this toolchain, so a toolchain file in the
  // project cannot choose another. A toolchain rustup installed is named by
  // its folder under `toolchains/`; any other (`rustup toolchain link`, a
  // standalone install) is pinned by its sysroot path, which rustup accepts
  // as a toolchain and which a direct install ignores.
  const rustupToolchain =
    basename(dirname(sysroot)) === "toolchains" ? basename(sysroot) : undefined;
  base.RUSTUP_TOOLCHAIN = rustupToolchain ?? sysroot;
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
    return {
      unavailable: "no crate cache location (CARGO_HOME or HOME unset)",
    };
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
 * there). The downloaded archives and git databases are symbolic links to
 * the user's own folders, not read-only copies: offline, cargo only reads
 * them, but nothing stops a build script that writes there. Crates are
 * extracted into the overlay.
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
  /** Proc-macro target names (crate names) of every listed package. */
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
    version?: string;
    targets: MetadataTarget[];
  }[];
  workspace_members: string[];
  resolve?: {
    nodes: {
      id: string;
      deps: {
        pkg: string;
        dep_kinds?: { kind: string | null }[];
      }[];
    }[];
  } | null;
}

/** The build scripts and proc macros the run must produce, counted per name. */
export interface ExpectedUnits {
  /** Package name → packages of that name with a build script. */
  buildScripts: Record<string, number>;
  /** Proc-macro crate name → packages of that name with a proc-macro library. */
  procMacros: Record<string, number>;
}

/**
 * C-43 review: every build script and proc macro the configuration needs.
 * The packages are those `cargo tree` lists for the workspace and target
 * with normal, build and dev edges (`built`, as `name version`): cargo's own
 * feature resolution, as the check rust-analyzer runs, with dev-dependencies
 * only for the members. `cargo metadata`'s resolve is wider: it lists
 * optional dependencies that no enabled feature turns on (jiff's `defmt` on
 * actix-web), and used alone it called that pin partial. Without `built`,
 * the resolve is walked from the members (normal and build edges, and the
 * members' dev edges), which errs towards `partial`. Each unit must have
 * finished, so a unit cargo never attempted (its dependency failed) is
 * missed no more than a unit that failed.
 */
export function expectedUnits(
  metadata: Metadata,
  built?: ReadonlySet<string>,
): ExpectedUnits | undefined {
  if (built) {
    const units: ExpectedUnits = { buildScripts: {}, procMacros: {} };
    for (const pkg of metadata.packages)
      if (built.has(`${pkg.name} ${pkg.version}`)) countUnits(pkg, units);
    return units;
  }
  if (!metadata.resolve) return undefined;
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const members = new Set(metadata.workspace_members);
  const needed = new Set<string>();
  const stack = [...members];
  while (stack.length) {
    const id = stack.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const kinds = dep.dep_kinds?.length
        ? dep.dep_kinds.map((k) => k.kind)
        : [null];
      if (
        kinds.some(
          (kind) =>
            kind === null ||
            kind === "build" ||
            (kind === "dev" && members.has(id)),
        )
      )
        stack.push(dep.pkg);
    }
  }
  const units: ExpectedUnits = { buildScripts: {}, procMacros: {} };
  for (const pkg of metadata.packages)
    if (needed.has(pkg.id)) countUnits(pkg, units);
  return units;
}

function countUnits(pkg: Metadata["packages"][number], units: ExpectedUnits) {
  for (const target of pkg.targets) {
    if (target.kind.includes("custom-build"))
      units.buildScripts[pkg.name] = (units.buildScripts[pkg.name] ?? 0) + 1;
    if (target.kind.includes("proc-macro")) {
      const name = target.name.replace(/-/g, "_");
      units.procMacros[name] = (units.procMacros[name] ?? 0) + 1;
    }
  }
}

/** The packages in `cargo tree`'s output (`--prefix none --format {p}`), as `name version`. */
export function treePackages(output: string): Set<string> {
  const out = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^(\S+) v(\S+)/.exec(line.trim());
    if (match) out.add(`${match[1]} ${match[2]}`);
  }
  return out;
}

/** What `cargo metadata` says about the packages, for the gates and partial detection. */
function cargoFacts(metadata: Metadata, project: string): CargoFacts {
  const members = new Set(metadata.workspace_members);
  const procMacroPackages = new Set<string>();
  const procMacroTargets = new Set<string>();
  const libraryRoots = new Set<string>();
  for (const pkg of metadata.packages) {
    for (const target of pkg.targets) {
      if (target.kind.includes("proc-macro")) {
        procMacroPackages.add(pkg.name);
        procMacroTargets.add(target.name.replace(/-/g, "_"));
      }
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
    procMacroTargets: sorted(procMacroTargets),
    libraryRoots: sorted(libraryRoots),
  };
}

/** The run's profile directories: `target/debug`, and `target/<triple>/debug` when a target is set. */
async function profileDirs(target: string): Promise<string[]> {
  const dirs = [join(target, "debug")];
  try {
    for (const entry of await readdir(target, { withFileTypes: true }))
      if (
        entry.isDirectory() &&
        entry.name !== "debug" &&
        existsSync(join(target, entry.name, "debug"))
      )
        dirs.push(join(target, entry.name, "debug"));
  } catch {
    /* no target directory */
  }
  return dirs;
}

/**
 * Expected build scripts that did not finish and expected proc macros that
 * were not built, read from the run's target directory (rust-analyzer exits
 * 0 and says nothing when either fails). A build script has finished when
 * one of its run directories holds `output`; a proc macro when its library
 * exists. Counted per name, so two versions of one package need two.
 */
export async function unfinished(
  target: string,
  units: ExpectedUnits,
): Promise<string[]> {
  const finished = new Map<string, number>();
  const libraries: string[] = [];
  for (const profile of await profileDirs(target)) {
    try {
      const build = join(profile, "build");
      for (const dir of await readdir(build)) {
        if (!existsSync(join(build, dir, "output"))) continue;
        const name = dir.replace(/-[0-9a-f]{16}$/, "");
        finished.set(name, (finished.get(name) ?? 0) + 1);
      }
    } catch {
      /* no build directory */
    }
    try {
      libraries.push(...(await readdir(join(profile, "deps"))));
    } catch {
      /* nothing built */
    }
  }
  const out: string[] = [];
  for (const [name, count] of Object.entries(units.buildScripts).sort())
    if ((finished.get(name) ?? 0) < count)
      out.push(`build script of ${name} did not finish`);
  for (const [name, count] of Object.entries(units.procMacros).sort()) {
    const built = libraries.filter(
      (file) =>
        (file.startsWith(`lib${name}-`) && /\.(so|dylib)$/.test(file)) ||
        (file.startsWith(`${name}-`) && file.endsWith(".dll")),
    ).length;
    if (built < count) out.push(`proc macro ${name} was not built`);
  }
  return out;
}

/**
 * C-43 review: the files where a proc macro failed to expand (it panicked,
 * was not built or could not be loaded), from `rust-analyzer diagnostics`.
 * The SCIP index does not carry diagnostics, and rust-analyzer exits 0 and
 * logs nothing when a proc macro panics. A link in such a file may name the
 * wrong item, so its answers are withheld.
 */
export function procMacroFailures(
  output: string,
  project: string,
): { files: Map<string, string>; complete: boolean } {
  const files = new Map<string, string>();
  const line =
    /file (.+?): Error Ra\("macro-error", Error\) from LineCol \{ line: (\d+)[^}]*\} to LineCol \{[^}]*\}: (.*)$/;
  for (const text of output.split(/\r?\n|\r/)) {
    const match = line.exec(text);
    if (!match) continue;
    const [, path, row, message] = match;
    if (!/proc[- ]macro/i.test(message!)) continue;
    const rel = path!.startsWith(project + sep)
      ? path!.slice(project.length + 1)
      : path!;
    if (!files.has(rel))
      files.set(rel, `${message!.trim()} (line ${Number(row) + 1})`);
  }
  return { files, complete: /diagnostic scan complete/.test(output) };
}

export interface AnalyzerRun {
  scip: Uint8Array;
  /** The index, decoded (sixth review D: only a readable index is cached). */
  documents: ScipDocument[];
  /** Why the index is partial; empty when it is complete. */
  partial: string[];
  /** Files whose answers are withheld (a proc macro failed there), with why. */
  withheld: Record<string, string>;
  /** The build target the run used: the host, or `[build] target`. */
  target: string;
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
  /** The output limit (tests: the over-limit path without 256 MiB). */
  outputLimit?: number;
}

/** What a run is prepared from, before anything runs (cheap checks only). */
export interface PreparedRun {
  /** The build target: `[build] target`, or the host. */
  target: string;
  /**
   * A hash of the Cargo configuration outside the project that the run
   * reads: the user's (copied into the run's crate cache) and any
   * `.cargo/config(.toml)` in a folder above the run. Only the hash is kept.
   */
  outside: string;
}

/**
 * The checks a run makes before it starts, shared with the warm query's key
 * (fifth review): a rust-project.json, and the build target the Cargo
 * configuration names. Both give the same `unavailable` reason in either
 * place, so an unchanged checkout keys the same way.
 */
export function prepareRun(
  root: string,
  install: Pick<RustInstallation, "cargoHome" | "host">,
  contexts: readonly { path: string; text?: string | undefined }[],
  workDir: string,
): PreparedRun | Unavailable {
  if (existsSync(join(root, "rust-project.json")))
    return {
      unavailable:
        "the project has a rust-project.json, which rust-analyzer reads instead of Cargo.toml; the route supports Cargo projects only",
    };
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  };
  // Cargo reads `.cargo/config(.toml)` in every folder above the run's copy
  // of the project, nearest first, then its CARGO_HOME (the user's, copied).
  const above: (string | undefined)[] = [];
  for (let dir = resolve(workDir); ; dir = dirname(dir)) {
    for (const name of ["config.toml", "config"])
      above.push(read(join(dir, ".cargo", name)));
    if (dirname(dir) === dir) break;
  }
  const user = ["config.toml", "config"].map((name) =>
    read(join(install.cargoHome, name)),
  );
  const configText = (path: string) =>
    contexts.find((file) => file.path === path)?.text;
  const target = buildTarget(
    [
      configText(".cargo/config.toml"),
      configText(".cargo/config"),
      ...above,
      ...user,
    ],
    install.host,
  );
  if (typeof target !== "string") return target;
  // Sixth review E: what the run depends on outside the checkout. Every
  // `path = "…"` and every `[workspace] members` entry the captured
  // manifests name that resolves outside the root: whether it exists, and
  // its Cargo.toml (hashed with the rest; never stored or printed).
  const outsideDependencies: string[] = [];
  const string = String.raw`"(?:[^"\\\n]|\\.)*"|'[^'\n]*'`;
  for (const manifest of contexts) {
    if (!/(^|\/)Cargo\.toml$/.test(manifest.path) || !manifest.text) continue;
    const base = resolve(root, dirname(manifest.path));
    const named = [
      ...[
        ...manifest.text.matchAll(
          new RegExp(String.raw`\bpath\s*=\s*(${string})`, "g"),
        ),
      ].map((m) => tomlString(m[1]!)),
      ...[...manifest.text.matchAll(/\bmembers\s*=\s*\[([^\]]*)\]/g)].flatMap(
        (m) =>
          [...m[1]!.matchAll(new RegExp(string, "g"))].map((s) =>
            tomlString(s[0]),
          ),
      ),
    ];
    for (const value of named) {
      if (!value) continue;
      // A glob member stands for its folder.
      const at = resolve(base, value.replace(/[*?[].*$/, ""));
      const inside = relative(root, at);
      if (inside && !inside.startsWith("..") && !isAbsolute(inside)) continue;
      const cargo = statSync(at, { throwIfNoEntry: false })?.isDirectory()
        ? read(join(at, "Cargo.toml"))
        : read(at);
      outsideDependencies.push(
        `${at}\u0000${existsSync(at)}\u0000${cargo === undefined ? "\u0000absent" : sha(cargo)}`,
      );
    }
  }
  return {
    target,
    outside: sha(
      ...[...above, ...user].map((text) => text ?? "\u0000absent"),
      ...outsideDependencies.sort(),
    ),
  };
}

/**
 * The route's key for this snapshot: the route and tool versions, the
 * configuration and build target, the Cargo configuration outside the
 * project (hashed), every captured manifest, lockfile and Cargo
 * configuration, every captured Rust file's path and content hash, every
 * other project file's path, size and time, and which lockfile packages are
 * in the crate cache.
 */
export async function routeKey(
  root: string,
  install: RustInstallation,
  sources: readonly { path: string; hash: string }[],
  contexts: readonly { path: string; text?: string | undefined }[],
  prepared: PreparedRun,
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
    prepared.target,
    prepared.outside,
    ...[...contexts]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map(
        (file) =>
          `${file.path}\u0000${file.text === undefined ? "\u0000absent" : sha(file.text)}`,
      ),
    ...[...sources]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((file) => `${file.path}\u0000${file.hash}`),
    await treeListing(root, captured, signal),
    await crateCacheState(install.cargoHome, lock),
  );
}

/**
 * A TOML string value written on one line (sixth review C): a basic string
 * (`"…"`, with escapes), a literal string (`'…'`), or either triple-quoted
 * form closed on the same line; a trailing comment is allowed. Undefined for
 * anything else (an array, a bare word, a string left open).
 */
export function tomlString(text: string): string | undefined {
  const comment = String.raw`\s*(?:#.*)?$`;
  const literal =
    new RegExp(String.raw`^'''([\s\S]*?)'''${comment}`).exec(text)?.[1] ??
    new RegExp(String.raw`^'([^'\n]*)'${comment}`).exec(text)?.[1];
  if (literal !== undefined) return literal;
  const basic =
    new RegExp(String.raw`^"""([\s\S]*?)"""${comment}`).exec(text)?.[1] ??
    new RegExp(String.raw`^"((?:[^"\\\n]|\\.)*)"${comment}`).exec(text)?.[1];
  if (basic === undefined) return undefined;
  try {
    return JSON.parse(`"${basic.replace(/\n/g, "\\n")}"`) as string;
  } catch {
    return undefined;
  }
}

/**
 * The build target the configuration names: `[build] target` in the
 * project's `.cargo/config.toml` (or `.cargo/config`), else the user's
 * cargo configuration, else the host. A list of targets or a target file is
 * not one configuration.
 */
export function buildTarget(
  texts: readonly (string | undefined)[],
  host: string,
): string | Unavailable {
  for (const text of texts) {
    if (!text) continue;
    const section = /^\s*\[build\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(
      text,
    )?.[1];
    const inline = /^\s*build\.target\s*=\s*(.+)$/m.exec(text)?.[1];
    const value =
      inline ?? (section && /^\s*target\s*=\s*(.+)$/m.exec(section)?.[1]);
    if (!value) continue;
    const single = tomlString(value.trim());
    if (!single)
      return {
        unavailable: `the Cargo configuration names more than one build target (${value.trim()}); the route uses one configuration`,
      };
    if (single.endsWith(".json"))
      return {
        unavailable: `the Cargo configuration names a target file (${single}); the route supports named targets only`,
      };
    return single;
  }
  return host;
}

/** A lock the operating system owns, held while a run's folder is in use. */
type RunLock = { close(): void };
function lockRun(path: string): RunLock | undefined {
  try {
    const { DatabaseSync } = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const db = new DatabaseSync(path);
    db.exec("PRAGMA busy_timeout=0");
    db.exec("BEGIN IMMEDIATE");
    return {
      close: () => {
        try {
          if (db.isTransaction) db.exec("ROLLBACK");
          db.close();
        } catch {
          /* closed */
        }
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Removes a run folder: write permission is added to its directories first
 * when a plain removal fails (a read-only checkout's copy, read-only crate
 * sources). Never throws: a folder it cannot remove is left for the next
 * run's sweep, and the run's own outcome stands.
 */
export async function removeRun(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    /* add write permission and retry */
  }
  const open = async (dir: string): Promise<void> => {
    try {
      await chmod(dir, 0o700);
    } catch {
      /* not ours */
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries)
      if (entry.isDirectory()) await open(join(dir, entry.name));
  };
  await open(path);
  try {
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes run folders left by a run that is no longer live: one killed, or
 * one whose cleanup failed. A live run holds a lock the operating system
 * releases when its process ends (`run-<id>.lock`); a folder whose lock can
 * be taken, or that has none, belongs to no live run.
 */
export async function sweepStaleRuns(workDir: string): Promise<number> {
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(workDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!/^run-[0-9a-f-]{36}$/.test(name)) continue;
    const lockPath = join(workDir, `${name}.lock`);
    const lock = existsSync(lockPath) ? lockRun(lockPath) : { close() {} };
    if (!lock) continue; // held: a live run
    try {
      if (await removeRun(join(workDir, name))) removed++;
    } finally {
      lock.close();
    }
    await rm(lockPath, { force: true }).catch(() => {});
  }
  return removed;
}

/**
 * Copies the project for a run (C-43 review): directories and regular files
 * only, owner-writable; a FIFO, socket or device is not copied; a symbolic
 * link is copied only when it resolves inside the project, as a relative
 * link inside the copy; an unreadable file or folder is left out. Returns
 * what was left out. The snapshot's Rust files are written over the copy
 * afterwards, so an unreadable Rust file the index captured is still there.
 */
export async function copyProject(
  root: string,
  to: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const left: string[] = [];
  const inside = (path: string) => path === root || path.startsWith(root + sep);
  const walk = async (dir: string, rel: string, out: string) => {
    signal?.throwIfAborted();
    await mkdir(out, { recursive: true, mode: 0o700 });
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      left.push(`${rel || "."}/ (unreadable)`);
      return;
    }
    for (const entry of entries) {
      const source = join(dir, entry.name);
      const target = join(out, entry.name);
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skipped(source, entry.name, rel === ""))
          await walk(source, path, target);
      } else if (entry.isFile()) {
        try {
          const mode = (await lstat(source)).mode;
          await copyFile(source, target);
          await chmod(target, 0o600 | (mode & 0o111));
        } catch {
          left.push(`${path} (unreadable)`);
        }
      } else if (entry.isSymbolicLink()) {
        const real = await realpath(source).catch(() => null);
        if (real && inside(real)) {
          const there = join(to, relative(root, real));
          await symlink(relative(dirname(target), there) || ".", target);
        } else left.push(`${path} (a link out of the project)`);
      } else left.push(`${path} (not a file or folder)`);
    }
  };
  await walk(root, "", to);
  return left;
}

/** rust-analyzer's SCIP index of this snapshot, from the cache or a fresh run. */
export async function runAnalyzer(
  root: string,
  install: RustInstallation,
  sources: readonly { path: string; text: string; hash: string }[],
  contexts: readonly { path: string; text?: string | undefined }[],
  workDir: string,
  /** From prepareRun, and the key routeKey gave for it. */
  prepared: PreparedRun,
  key: string,
  signal?: AbortSignal,
  controls: RunControls = {},
): Promise<AnalyzerRun | Unavailable> {
  await mkdir(workDir, { recursive: true });
  const buildFor = prepared.target;
  const stem = join(workDir, `scip-${key.slice(0, 32)}`);
  if (existsSync(`${stem}.json`) && existsSync(`${stem}.scip`)) {
    // Sixth review D: a cached pair that cannot be read (a damaged or
    // foreign file) is discarded and the run goes ahead, once.
    try {
      const record = JSON.parse(await readFile(`${stem}.json`, "utf8")) as {
        partial: string[];
        facts: CargoFacts;
        withheld?: Record<string, string>;
        target?: string;
      };
      const scip = await readFile(`${stem}.scip`);
      return {
        scip,
        documents: readScip(scip),
        partial: record.partial,
        withheld: record.withheld ?? {},
        target: record.target ?? buildFor,
        facts: record.facts,
        cached: true,
        key,
        elapsedMs: 0,
      };
    } catch {
      await rm(`${stem}.json`, { force: true });
      await rm(`${stem}.scip`, { force: true });
    }
  }
  const id = randomUUID();
  const run = join(workDir, `run-${id}`);
  // Held for the whole run; the operating system releases it if this
  // process dies, so the next run's sweep can remove the folder.
  const lock = lockRun(`${run}.lock`);
  const project = join(run, "project");
  const target = join(run, "target");
  const env = {
    ...install.base,
    CARGO_HOME: join(run, "cargo-home"),
    CARGO_TARGET_DIR: target,
    CARGO_NET_OFFLINE: "true",
  };
  const options = (timeoutMs: number) => ({
    cwd: project,
    timeoutMs,
    maxBytes: controls.outputLimit ?? OUTPUT_LIMIT,
    env,
    ...(signal ? { signal } : {}),
    ...(controls.clock ? { clock: controls.clock } : {}),
  });
  try {
    signal?.throwIfAborted();
    await mkdir(run, { recursive: true, mode: 0o700 });
    await copyProject(root, project, signal);
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
        buildFor,
      ],
      options(10 * 60_000),
    );
    cancelled(meta);
    let facts: CargoFacts = {
      procMacroPackages: [],
      procMacroTargets: [],
      libraryRoots: [],
    };
    let units: ExpectedUnits | undefined;
    if (meta.kind === "exited" && meta.code === 0)
      try {
        const metadata = JSON.parse(meta.stdout) as Metadata;
        facts = cargoFacts(metadata, project);
        // What cargo builds for this configuration (feature-resolved).
        const tree = await runProcess(
          install.cargo,
          [
            "tree",
            "--workspace",
            "--offline",
            "--target",
            buildFor,
            "-e",
            "normal,build,dev",
            "--prefix",
            "none",
            "--format",
            "{p}",
            "--charset",
            "ascii",
          ],
          options(10 * 60_000),
        );
        cancelled(tree);
        units = expectedUnits(
          metadata,
          tree.kind === "exited" && tree.code === 0
            ? treePackages(tree.stdout)
            : undefined,
        );
        if (!units) partial.push("cargo metadata gave no resolved graph");
      } catch {
        partial.push("cargo metadata gave unreadable output");
      }
    else
      partial.push(
        `cargo metadata failed offline (dependencies not in the crate cache?): ${firstLine(meta)}`,
      );
    await writeFile(
      join(run, "analyzer.json"),
      JSON.stringify(ANALYZER_CONFIG),
    );
    const output = join(run, "index.scip");
    const started = performance.now();
    const result = await runProcess(
      install.analyzer,
      [
        "scip",
        ".",
        "--output",
        output,
        "--config-path",
        join(run, "analyzer.json"),
      ],
      options(controls.limitMs ?? RUN_LIMIT_MS),
    );
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
    if (units) partial.push(...(await unfinished(target, units)));
    // Proc macros that failed to expand, per file. The same target folder,
    // so build scripts and proc macros are not built again.
    const diagnostics = await runProcess(
      install.analyzer,
      ["diagnostics", "."],
      options(controls.limitMs ?? RUN_LIMIT_MS),
    );
    cancelled(diagnostics);
    const failures = procMacroFailures(diagnostics.stdout, project);
    if (diagnostics.kind !== "exited" || !failures.complete)
      partial.push(
        `rust-analyzer diagnostics did not finish (${diagnostics.kind === "exited" ? `exited ${diagnostics.code}` : diagnostics.kind}), so proc-macro failures are unknown`,
      );
    const withheld = Object.fromEntries([...failures.files].sort());
    // An item a failed macro would have generated can be called from any
    // file, and rust-analyzer may then name another item of that name: no
    // answer is applied anywhere (the files are listed in the report).
    if (failures.files.size)
      partial.push(
        `a proc macro failed to expand in ${failures.files.size} file${failures.files.size === 1 ? "" : "s"}: ${Object.entries(
          withheld,
        )
          .slice(0, 3)
          .map(([file, why]) => `${file}: ${why}`)
          .join("; ")}`,
      );
    const elapsedMs = performance.now() - started;
    // Sixth review D: decoded before anything is cached; an index that
    // cannot be read is reported and never kept.
    let documents: ScipDocument[];
    try {
      documents = readScip(scip);
    } catch (error) {
      return {
        unavailable: `rust-analyzer's index cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    // Kept only when complete: a partial index or a failed proc macro may
    // come from the environment (a missing system library), which the key
    // does not see, so it is run again next time.
    if (!partial.length && !failures.files.size) {
      const tmp = randomUUID();
      await writeFile(`${stem}.${tmp}.partial`, scip);
      await rename(`${stem}.${tmp}.partial`, `${stem}.scip`);
      await writeFile(
        `${stem}.json.${tmp}.partial`,
        JSON.stringify({ partial, facts, withheld, target: buildFor }),
      );
      await rename(`${stem}.json.${tmp}.partial`, `${stem}.json`);
      await prune(workDir, stem);
    }
    return {
      scip,
      documents,
      partial,
      withheld,
      target: buildFor,
      facts,
      cached: false,
      key,
      elapsedMs,
    };
  } finally {
    // Never masks the run's own outcome: a folder that cannot be removed is
    // left for the next sweep.
    await removeRun(run);
    lock?.close();
    await rm(`${run}.lock`, { force: true }).catch(() => {});
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
