// SPDX-License-Identifier: MIT
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { posix } from "node:path";

export function checkoutLocation(directory, path, tracked, symlinks) {
  if (typeof path !== "string" || !path || path.trim() !== path || /[:\\\0]/.test(path) || posix.isAbsolute(path)) return "unclassified";
  const parts = directory === "." ? [] : directory.split("/");
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
    if (symlinks?.has(parts.join("/"))) return "unclassified";
  }
  if (parts[0] === "..") return "outside";
  const target = parts.join("/") || ".";
  return tracked.has(target) ? "inside" : "unclassified";
}

export function npmPathLocation(directory, specifier, tracked, symlinks) {
  if (typeof specifier !== "string") return undefined;
  const relative = /^(?:file|link|portal):(.*)$/.exec(specifier)?.[1];
  if (relative === undefined) return undefined;
  try { return checkoutLocation(directory, decodeURIComponent(relative), tracked, symlinks); }
  catch { return "unclassified"; }
}

export function cargoPathLocations(manifests, tracked, symlinks) {
  const destinations = new Map();
  for (const [manifest, doc] of manifests) {
    const directory = posix.dirname(manifest);
    const tables = [doc, doc.workspace, ...Object.values(doc.target ?? {})];
    const lists = tables.flatMap((owner) => [
      owner?.dependencies, owner?.["dev-dependencies"], owner?.["build-dependencies"],
    ]);
    lists.push(doc.replace, ...Object.values(doc.patch ?? {}));
    for (const entry of lists.flatMap((list) => Object.values(list ?? {}))) {
      if (typeof entry?.path !== "string" || !entry.path) continue;
      const key = posix.join(directory, entry.path, "Cargo.toml");
      const location = checkoutLocation(directory, entry.path + "/Cargo.toml", tracked, symlinks);
      const previous = destinations.get(key);
      destinations.set(key, previous && previous !== location ? "unclassified" : location);
    }
  }
  return destinations;
}

function archiveDirectory(read, size) {
  const endStart = Math.max(0, size - 65_557);
  const end = read(endStart, size - endStart);
  for (let cursor = end.length - 22; cursor >= 0; cursor--) {
    if (end.readUInt32LE(cursor) !== 0x06054b50 || cursor + 22 + end.readUInt16LE(cursor + 20) !== end.length) continue;
    const length = end.readUInt32LE(cursor + 12), offset = end.readUInt32LE(cursor + 16);
    if (end.readUInt32LE(cursor + 4) || offset + length > endStart + cursor || length > 16 * 1024 * 1024) break;
    return { data: read(offset, length), entries: end.readUInt16LE(cursor + 10) };
  }
  return null;
}

export function yarnArchivePackages(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const read = (position, length) => {
      const bytes = Buffer.alloc(length);
      if (readSync(fd, bytes, 0, length, position) !== length) throw Error("Truncated archive");
      return bytes;
    };
    const directory = archiveDirectory(read, fstatSync(fd).size);
    if (!directory) return null;
    const { data, entries } = directory;
    const names = new Set();
    let cursor = 0;
    for (let i = 0; i < entries; i++) {
      if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) return null;
      const nameEnd = cursor + 46 + data.readUInt16LE(cursor + 28);
      const next = nameEnd + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32);
      if (next > data.length) return null;
      const name = /^(?:\.\/)?node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\/package\.json$/.exec(data.toString("utf8", cursor + 46, nameEnd))?.[1];
      if (name) names.add(name);
      cursor = next;
    }
    return names.size ? names : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
