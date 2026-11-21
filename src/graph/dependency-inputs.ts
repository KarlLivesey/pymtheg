// SPDX-License-Identifier: MIT
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { contentHash } from "./identity.js";
import type { ContextFile } from "./types.js";

export interface DependencyStamp {
  module: string;
  stamp: string;
}

const installed = (path: string) => path.split("/").includes("node_modules");
const safe = (path: string) =>
  !!path &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  path.split("/").every((part) => part && part !== "." && part !== "..");
const stamp = (path: string, stat: BigIntStats) =>
  [
    path,
    stat.dev,
    stat.ino,
    stat.mode,
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
  ].join("\0");
const MAX_FILE = 4 * 1024 * 1024;
/**
 * The content hash of the regular file at `absolute` now, or undefined.
 * Used only where a stamp moved: metadata alone (a hard link added by
 * another install sharing the package store changes ctime and nlink) never
 * decides whether bytes changed (C-22).
 */
function hashNow(absolute: string): string | undefined {
  try {
    const fd = openSync(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile() || stat.size > MAX_FILE) return undefined;
      return contentHash(readFileSync(fd));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}
const CACHE_SIZE = 24 * 1024 * 1024;
/**
 * Recorded for a file whose bytes on disk no longer match the bytes this run
 * used: no lstat stamp equals it, so the next run sees the input as changed.
 */
const STALE = "\0stale";
// Retain text, not compiler nodes. An unchanged file can be shared by several
// programs or by the next index in the same process.
const textCache = new Map<
  string,
  { stamp: string; text: string; hash: string; size: number }
>();
let cachedBytes = 0;

class Paths {
  readonly root: string;
  private readonly locations = new Map<
    string,
    { path: string; stat: BigIntStats } | null
  >();
  constructor(root: string) {
    this.root = realpathSync(root);
  }

  location(
    path: string,
    hops = 0,
  ): { path: string; stat: BigIntStats } | undefined {
    if (!safe(path) || hops > 40) return undefined;
    const cached = this.locations.get(path);
    if (cached !== undefined) return cached ?? undefined;
    const parent = posix.dirname(path);
    const directory = parent === "." ? "" : this.location(parent, hops)?.path;
    let location: { path: string; stat: BigIntStats } | undefined;
    if (directory !== undefined) {
      const name = posix.join(directory, posix.basename(path));
      try {
        const stat = lstatSync(join(this.root, name), { bigint: true });
        if (stat.isSymbolicLink()) {
          const destination = relative(
            this.root,
            resolve(this.root, directory, readlinkSync(join(this.root, name))),
          )
            .split(sep)
            .join("/");
          // Check the destination before probing any of its components. pnpm's
          // normal .pnpm links end inside the project. Its CAS hard links need
          // no access to the shared store path.
          if (destination === "")
            location = {
              path: "",
              stat: lstatSync(this.root, { bigint: true }),
            };
          else if (!isAbsolute(destination))
            location = this.location(destination, hops + 1);
        } else location = { path: name, stat };
      } catch {
        // Missing and inaccessible inputs are absent from this snapshot.
      }
    }
    this.locations.set(path, location ?? null);
    return location;
  }
}

/**
 * The recorded inputs that changed since they were recorded, and the records
 * as they now are. The stamp is the cheap first check; when it moved, a file
 * whose bytes were read is changed only if its content hash now differs from
 * the one recorded. Metadata that another install moved is no change: such a
 * record is returned with the stamp it has now, which a cold index would
 * record too.
 */
export function checkDependencyInputs<
  T extends { path: string; hash?: string; dependency?: DependencyStamp },
>(
  root: string,
  inputs: readonly T[],
): { changed: string[]; current: T[]; restamped: boolean } {
  const changed: string[] = [];
  let restamped = false;
  if (!inputs.some((entry) => entry.dependency))
    return { changed, current: [...inputs], restamped };
  const paths = new Paths(root);
  const current = inputs.map((entry) => {
    const { path, hash, dependency } = entry;
    if (!dependency) return entry;
    const location = installed(path) ? paths.location(path) : undefined;
    const actual = location ? stamp(location.path, location.stat) : "";
    if (actual === dependency.stamp) return entry;
    if (
      hash &&
      actual &&
      location!.stat.isFile() &&
      hashNow(join(paths.root, location!.path)) === hash
    ) {
      restamped = true;
      return { ...entry, dependency: { ...dependency, stamp: actual } };
    }
    changed.push(path);
    return entry;
  });
  return { changed, current, restamped };
}

/** The recorded inputs that changed since they were recorded (see above). */
export function changedDependencyInputs(
  root: string,
  inputs: readonly {
    path: string;
    hash?: string;
    dependency?: DependencyStamp;
  }[],
): string[] {
  return checkDependencyInputs(root, inputs).changed;
}

export class DependencyInputs {
  private readonly paths: Paths;
  private readonly entries = new Map<string, ContextFile>();
  /**
   * The bytes this run used, by installed location: the first read wins for
   * the whole run, so every program sees the same text (C-22).
   */
  private readonly used = new Map<
    string,
    { text: string; hash: string; stamp: string; paths: Set<string> }
  >();

  constructor(
    root: string,
    private readonly module: string,
  ) {
    this.paths = new Paths(root);
  }

  refreshed = false;

  /**
   * Every probed input with the identity of what this run used. For a file
   * read this run whose stamp on disk moved, the content decides: the same
   * bytes are recorded with the stamp they have now; different bytes (or
   * none) are recorded as stale, so the next run analyses again.
   */
  records(): ContextFile[] {
    for (const [location, used] of this.used) {
      const absolute = join(this.paths.root, location);
      let now = "";
      try {
        now = stamp(location, lstatSync(absolute, { bigint: true }));
      } catch {
        // Gone: no longer what was used.
      }
      if (now === used.stamp) continue;
      const same = now !== "" && hashNow(absolute) === used.hash;
      for (const path of used.paths)
        this.entries.get(path)!.dependency = {
          module: this.module,
          stamp: same ? now : STALE,
        };
    }
    return [...this.entries.values()];
  }

  private probe(path: string): ReturnType<Paths["location"]> {
    if (!installed(path) || !safe(path)) return undefined;
    const location = this.paths.location(path);
    const parent = posix.dirname(path);
    if (!location && installed(parent) && !this.paths.location(parent))
      return this.probe(parent);
    if (!this.entries.has(path))
      this.entries.set(path, {
        path,
        text: "",
        hash: "",
        status: "clean",
        diagnostics: [],
        dependency: {
          module: this.module,
          stamp: location ? stamp(location.path, location.stat) : "",
        },
      });
    return location;
  }

  realpath(path: string): string | undefined {
    return this.probe(path)?.path;
  }

  directoryExists(path: string): boolean {
    return this.probe(path)?.stat.isDirectory() ?? false;
  }

  fileExists(path: string): boolean {
    const location = this.probe(path);
    return (
      !!location?.stat.isFile() &&
      installed(location.path) &&
      location.stat.size <= MAX_FILE
    );
  }

  directories(path: string): string[] {
    const location = this.probe(path);
    // TypeScript enumerates direct @types entries for implicit type roots.
    // Do not enumerate other installed directories or descend through them.
    if (
      !/(?:^|\/)node_modules\/@types$/.test(path) ||
      !location?.stat.isDirectory() ||
      !installed(location.path)
    )
      return [];
    try {
      return readdirSync(join(this.paths.root, location.path), {
        withFileTypes: true,
      })
        .filter((item) => item.isDirectory() || item.isSymbolicLink())
        .map(({ name }) => name)
        .sort();
    } catch {
      return [];
    }
  }

  read(path: string): string | undefined {
    const location = this.probe(path);
    if (
      !location?.stat.isFile() ||
      !installed(location.path) ||
      location.stat.size > MAX_FILE
    )
      return undefined;
    const record = this.entries.get(path)!;
    const used = this.used.get(location.path);
    if (used) {
      used.paths.add(path);
      record.hash = used.hash;
      record.dependency = { module: this.module, stamp: used.stamp };
      if (path.endsWith("/package.json")) record.text = used.text;
      return used.text;
    }
    const absolute = join(this.paths.root, location.path);
    const mark = stamp(location.path, location.stat);
    let captured = textCache.get(absolute);
    if (captured?.stamp !== mark) {
      // Checked against its own handle, and decided by content: a link added
      // by another install sharing the package store moves the inode's
      // ctime and nlink, not its bytes, and must not make a present
      // declaration absent (C-22). When the handle's stamp moved during the
      // read, the file is read again: the same bytes are used as they are;
      // different bytes mean it is being written, so it is tried once more
      // and then treated as absent. The stamp recorded is the handle's
      // after the read.
      captured = undefined;
      for (let attempt = 0; attempt < 2 && !captured; attempt++)
        try {
          const fd = openSync(
            absolute,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            const before = fstatSync(fd, { bigint: true });
            if (!before.isFile() || before.size > MAX_FILE) return undefined;
            const bytes = readFileSync(fd);
            const after = stamp(location.path, fstatSync(fd, { bigint: true }));
            const hash = contentHash(bytes);
            if (
              stamp(location.path, before) !== after &&
              hashNow(absolute) !== hash
            )
              continue;
            captured = {
              stamp: after,
              text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              hash,
              size: bytes.length,
            };
          } finally {
            closeSync(fd);
          }
        } catch {
          return undefined;
        }
      if (!captured) return undefined;
      const obsolete = textCache.get(absolute);
      if (obsolete) cachedBytes -= obsolete.size;
      textCache.delete(absolute);
      textCache.set(absolute, captured);
      cachedBytes += captured.size;
      while (cachedBytes > CACHE_SIZE) {
        const oldest = textCache.keys().next().value!;
        cachedBytes -= textCache.get(oldest)!.size;
        textCache.delete(oldest);
      }
    }
    record.hash = captured.hash;
    record.dependency = { module: this.module, stamp: captured.stamp };
    if (path.endsWith("/package.json")) record.text = captured.text;
    this.used.set(location.path, {
      text: captured.text,
      hash: captured.hash,
      stamp: captured.stamp,
      paths: new Set([path]),
    });
    return captured.text;
  }
}
