// SPDX-License-Identifier: MIT
/**
 * The opt-in Go toolchain route (W3-L): locate the user's `go`, build the
 * standard-library helper (toolchain/golinks.go) into the rebuildable folder,
 * run it on the project and keep its output keyed by every input that
 * determines it. Only for a project that opted in (`graph.toolchain.go`):
 * running the toolchain is as trusted as building the project.
 *
 * Policy (decisions D16, D17; docs/changes/W2-L.md): offline (GOPROXY=off,
 * GOSUMDB=off, never a download), GOTOOLCHAIN=local, -mod=readonly (or
 * vendor), cgo off, one build configuration (the go installation's host
 * GOOS/GOARCH, GOAMD64=v1, no extra tags), a closed environment built from
 * nothing for every `go` process, a fresh build cache per run removed
 * afterwards, the project never written. No sandbox.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runProcess,
  type ProcessClock,
  type ProcessResult,
} from "../../../backends/process.js";

/** The helper's source, found from this file in dist/ and in the package. */
export const HELPER_SOURCE = fileURLToPath(
  new URL(
    "../../../../src/graph/languages/go/toolchain/golinks.go",
    import.meta.url,
  ),
);
/** go/types features the helper relies on (Config.GoVersion, generics). */
const MINIMUM = [1, 22];
/** A bound on one helper run; a project needing more is reported, not hung on. */
const RUN_LIMIT_MS = 30 * 60 * 1000;
const OUTPUT_LIMIT = 1024 * 1024 * 1024;

export interface GoInstallation {
  go: string;
  version: string;
  goroot: string;
  configuration: string;
  goos: string;
  goarch: string;
  gopath: string;
  modcache: string;
}
export type Unavailable = { unavailable: string };

const closedEnv = (
  go: string,
  extra: Record<string, string>,
): Record<string, string> => ({
  PATH: dirname(go),
  GOENV: "off",
  GOTOOLCHAIN: "local",
  GOFLAGS: "",
  GO111MODULE: "on",
  GOPROXY: "off",
  GOSUMDB: "off",
  GOTELEMETRY: "off",
  GOVCS: "*:off",
  GOAUTH: "off",
  CGO_ENABLED: "0",
  ...extra,
});

/** The trusted `go`: the setting's absolute path, or `go` on the user's PATH. */
async function locate(
  setting: unknown,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | Unavailable> {
  let candidate: string | undefined;
  if (typeof setting === "string") {
    if (!isAbsolute(setting))
      return { unavailable: `graph.toolchain.go is not absolute: ${setting}` };
    candidate = setting;
  } else
    for (const directory of (env.PATH ?? "").split(delimiter)) {
      if (!directory || !isAbsolute(directory)) continue;
      const path = join(directory, "go");
      if (existsSync(path)) {
        candidate = path;
        break;
      }
    }
  if (!candidate) return { unavailable: "go was not found on PATH" };
  try {
    const real = await realpath(candidate);
    if (!(await stat(real)).isFile())
      return { unavailable: `${candidate} is not a file` };
    return real;
  } catch {
    return { unavailable: `${candidate} does not exist` };
  }
}

const versionOf = (text: string): number[] | undefined => {
  const match = /^go(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
};

/** The installation, asked of itself in a closed environment. */
export async function installation(
  setting: unknown,
  env: Readonly<Record<string, string | undefined>>,
  workDir: string,
  signal?: AbortSignal,
): Promise<GoInstallation | Unavailable> {
  const go = await locate(setting, env);
  if (typeof go !== "string") return go;
  const scratch = join(workDir, "env");
  await mkdir(scratch, { recursive: true });
  const result = await runProcess(
    go,
    ["env", "-json", "GOVERSION", "GOROOT", "GOHOSTOS", "GOHOSTARCH"],
    {
      cwd: scratch,
      timeoutMs: 60_000,
      ...(signal ? { signal } : {}),
      env: closedEnv(go, {
        GOPATH: join(scratch, "gopath"),
        GOCACHE: join(scratch, "cache"),
      }),
    },
  );
  if (result.kind === "cancelled") throw Error("Indexing was cancelled");
  if (result.kind !== "exited" || result.code !== 0)
    return {
      unavailable: `${go} did not answer go env (${result.kind}${result.code === null ? "" : ` ${result.code}`}): ${result.stderr.trim().split("\n")[0] ?? ""}`,
    };
  let info: Record<string, string>;
  try {
    info = JSON.parse(result.stdout) as Record<string, string>;
  } catch {
    return { unavailable: `${go} gave unreadable go env output` };
  }
  const version = versionOf(info.GOVERSION ?? "");
  if (
    !version ||
    version[0]! < MINIMUM[0]! ||
    (version[0] === MINIMUM[0] && version[1]! < MINIMUM[1]!)
  )
    return {
      unavailable: `${info.GOVERSION ?? "an unknown Go version"} is too old: go${MINIMUM.join(".")} or newer is needed`,
    };
  let gorootGo = "";
  try {
    gorootGo = await realpath(join(info.GOROOT ?? "", "bin", "go"));
  } catch {
    /* compared below */
  }
  if (gorootGo !== go)
    return {
      unavailable: `${go} is not <GOROOT>/bin/go (GOROOT ${info.GOROOT})`,
    };
  // Locations only: the user's module cache (read, never written but for
  // go's lock files).
  const home = env.HOME ?? "";
  const gopath =
    (env.GOPATH ?? "").split(delimiter).find((p) => isAbsolute(p)) ??
    (isAbsolute(home) ? join(home, "go") : "");
  const modcache = isAbsolute(env.GOMODCACHE ?? "")
    ? env.GOMODCACHE!
    : gopath
      ? join(gopath, "pkg", "mod")
      : "";
  if (!gopath || !modcache)
    return { unavailable: "no module cache location (GOPATH or HOME unset)" };
  return {
    go,
    version: info.GOVERSION!,
    goroot: info.GOROOT!,
    goos: info.GOHOSTOS!,
    goarch: info.GOHOSTARCH!,
    configuration: `${info.GOHOSTOS}/${info.GOHOSTARCH}, cgo off, GOAMD64=v1, no tags`,
    gopath,
    modcache,
  };
}

const sha = (...parts: (string | Buffer)[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\u0000");
  return hash.digest("hex");
};

/** Builds the helper for this installation, once (its own build cache). */
async function helper(
  install: GoInstallation,
  workDir: string,
  signal?: AbortSignal,
): Promise<string | Unavailable> {
  const source = await readFile(HELPER_SOURCE);
  const binary = join(
    workDir,
    `golinks-${sha(source, install.go, install.version).slice(0, 16)}`,
  );
  if (existsSync(binary)) return binary;
  // Its own throwaway module (a go.mod of its own, GOWORK=off): the work
  // directory may lie inside the project, whose go.mod or go.work must not
  // break or redirect this build. The build cache goes with it.
  const scratch = join(workDir, `build-${randomUUID()}`);
  try {
    await mkdir(scratch, { recursive: true });
    const partial = `${binary}.${randomUUID()}.partial`;
    await writeFile(join(scratch, "golinks.go"), source);
    await writeFile(join(scratch, "go.mod"), "module golinks\n\ngo 1.22\n");
    const result = await runProcess(
      install.go,
      ["build", "-trimpath", "-o", partial, "golinks.go"],
      {
        cwd: scratch,
        timeoutMs: 10 * 60_000,
        ...(signal ? { signal } : {}),
        env: closedEnv(install.go, {
          GOPATH: join(scratch, "gopath"),
          GOCACHE: join(scratch, "cache"),
          GOWORK: "off",
        }),
      },
    );
    if (result.kind === "cancelled") throw Error("Indexing was cancelled");
    if (result.kind !== "exited" || result.code !== 0)
      return {
        unavailable: `the helper did not build with ${install.version}: ${result.stderr.trim().split("\n").slice(0, 3).join(" ")}`,
      };
    await rename(partial, binary);
    return binary;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Module-cache presence of every go.sum module zip, so a later download changes the key. */
async function cacheState(root: string, modcache: string): Promise<string> {
  let sum = "";
  try {
    sum = await readFile(join(root, "go.sum"), "utf8");
  } catch {
    return "no go.sum";
  }
  const escape = (path: string) =>
    path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
  const lines: string[] = [];
  for (const line of sum.split("\n")) {
    const [path, version] = line.trim().split(/\s+/);
    if (!path || !version || version.endsWith("/go.mod")) continue;
    const zip = join(
      modcache,
      "cache",
      "download",
      escape(path),
      "@v",
      `${escape(version)}.zip`,
    );
    lines.push(`${path} ${version} ${existsSync(zip) ? 1 : 0}`);
  }
  return lines.sort().join("\n");
}

const readOptional = async (path: string) => {
  try {
    return await readFile(path);
  } catch {
    return Buffer.from("\u0000absent");
  }
};

export interface HelperRun {
  /** The helper's records (TSV). */
  output: string;
  /** Read from the rebuildable folder, not run (inputs unchanged). */
  cached: boolean;
  key: string;
  elapsedMs: number;
}

/** Test hooks: a controlled clock and run limit (the timeout path). */
export interface RunControls {
  clock?: ProcessClock;
  limitMs?: number;
}

/**
 * The helper's records for this snapshot. Keyed by the helper's source, the
 * installation and configuration, go.mod, go.sum, go.work(.sum), the vendor
 * state, which go.sum modules are in the module cache, every captured Go
 * file's path and content hash, and the helper's fingerprint: go list's own
 * report and the content of every file of every package outside GOROOT and
 * the module cache, including local `replace` targets inside or outside the
 * project, vendored packages and Go files the index did not capture. The
 * fingerprint costs one `go list` on every index; a warm index never reuses
 * facts whose inputs changed. Any change re-runs the whole helper: whether a
 * package's links are definite depends on its whole import closure, and
 * implementer sets on every loaded package, so no smaller re-run is sound.
 */
export async function runHelper(
  root: string,
  install: GoInstallation,
  sources: readonly { path: string; text: string; hash: string }[],
  workDir: string,
  signal?: AbortSignal,
  controls: RunControls = {},
): Promise<HelperRun | Unavailable> {
  await mkdir(workDir, { recursive: true });
  const binary = await helper(install, workDir, signal);
  if (typeof binary !== "string") return binary;
  // One run's private directory: the fresh build cache and the overlay of
  // the snapshot's Go files, removed afterwards whatever happens.
  const run = join(workDir, `run-${randomUUID()}`);
  const cache = join(run, "cache");
  const overlay = join(run, "overlay");
  const exec = async (extra: string[]) => {
    await rm(cache, { recursive: true, force: true });
    await mkdir(cache, { recursive: true });
    return await runProcess(
      binary,
      [
        "-go",
        install.go,
        "-goos",
        install.goos,
        "-goarch",
        install.goarch,
        "-gopath",
        install.gopath,
        "-gomodcache",
        install.modcache,
        "-gocache",
        cache,
        "-overlay",
        join(run, "overlay.json"),
        ...extra,
        root,
      ],
      {
        cwd: run,
        timeoutMs: controls.limitMs ?? RUN_LIMIT_MS,
        maxBytes: OUTPUT_LIMIT,
        // The helper itself starts with an empty environment: a malformed
        // GODEBUG or GOMEMLIMIT would abort any Go program before main.
        env: {},
        ...(signal ? { signal } : {}),
        ...(controls.clock ? { clock: controls.clock } : {}),
      },
    );
  };
  const failure = (result: ProcessResult): Unavailable => ({
    unavailable: `the helper ${result.kind === "exited" ? `exited ${result.code}` : result.kind}: ${result.stderr.trim().split("\n").slice(0, 3).join(" ")}`,
  });
  try {
    await mkdir(overlay, { recursive: true });
    const replace: Record<string, string> = {};
    let index = 0;
    for (const file of sources) {
      const copy = join(overlay, `${index++}.go`);
      await writeFile(copy, file.text);
      replace[join(root, file.path)] = copy;
    }
    await writeFile(
      join(run, "overlay.json"),
      JSON.stringify({ Replace: replace }),
    );
    const printed = await exec(["-fingerprint"]);
    if (printed.kind === "cancelled") throw Error("Indexing was cancelled");
    const fingerprint = /^FP\t([0-9a-f]{64})$/m.exec(printed.stdout)?.[1];
    if (printed.kind !== "exited" || printed.code !== 0 || !fingerprint)
      return failure(printed);
    const key = sha(
      await readFile(HELPER_SOURCE),
      install.go,
      install.version,
      install.configuration,
      install.modcache,
      await readOptional(join(root, "go.mod")),
      await readOptional(join(root, "go.sum")),
      await readOptional(join(root, "go.work")),
      await readOptional(join(root, "go.work.sum")),
      await readOptional(join(root, "vendor", "modules.txt")),
      await cacheState(root, install.modcache),
      fingerprint,
      ...sources.map((file) => `${file.path}\u0000${file.hash}`),
    );
    const facts = join(workDir, `facts-${key.slice(0, 32)}.tsv`);
    if (existsSync(facts))
      return {
        output: await readFile(facts, "utf8"),
        cached: true,
        key,
        elapsedMs: 0,
      };
    const started = performance.now();
    const result = await exec([]);
    const elapsedMs = performance.now() - started;
    if (result.kind === "cancelled") throw Error("Indexing was cancelled");
    if (result.kind !== "exited" || result.code !== 0) return failure(result);
    // Kept only when complete: a later run with the same inputs reads it.
    const partial = `${facts}.${randomUUID()}.partial`;
    await writeFile(partial, result.stdout);
    await rename(partial, facts);
    return { output: result.stdout, cached: false, key, elapsedMs };
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}
