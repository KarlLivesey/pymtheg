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
const CACHE_SIZE = 24 * 1024 * 1024;
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
          if (destination && !isAbsolute(destination))
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

export function changedDependencyInputs(
  root: string,
  inputs: readonly { path: string; dependency?: DependencyStamp }[],
): string[] {
  const watched = inputs.filter((entry) => entry.dependency);
  if (!watched.length) return [];
  const paths = new Paths(root);
  return watched.flatMap(({ path, dependency }) => {
    const location = installed(path) ? paths.location(path) : undefined;
    const actual = location ? stamp(location.path, location.stat) : "";
    return actual === dependency!.stamp ? [] : [path];
  });
}

export class DependencyInputs {
  private readonly paths: Paths;
  private readonly entries = new Map<string, ContextFile>();

  constructor(
    root: string,
    private readonly module: string,
  ) {
    this.paths = new Paths(root);
  }

  refreshed = false;

  records(): ContextFile[] {
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
    const absolute = join(this.paths.root, location.path);
    const mark = stamp(location.path, location.stat);
    let captured = textCache.get(absolute);
    if (captured?.stamp !== mark) {
      // The read is checked against its own handle, not against the first
      // lstat of the run: a link added by another install sharing the
      // package store changes the inode's ctime, not its bytes, and must not
      // make a present declaration absent (C-22). The stamp recorded is the
      // one of the bytes read, so a later run still sees any change.
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
            // Written while it was read: try once more, then treat it as absent.
            if (stamp(location.path, before) !== after) continue;
            captured = {
              stamp: after,
              text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              hash: contentHash(bytes),
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
    const record = this.entries.get(path)!;
    record.hash = captured.hash;
    record.dependency = { module: this.module, stamp: captured.stamp };
    if (path.endsWith("/package.json")) record.text = captured.text;
    return captured.text;
  }
}
