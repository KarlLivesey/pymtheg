// SPDX-License-Identifier: MIT
/**
 * The Go standard library's exported API (C-17): a table generated from one
 * pinned Go release by scripts/go-stdlib/generate.go and shipped with the
 * package (`stdlib/table.txt.gz`). Read on first use only, so a project
 * without Go never loads it. It holds API facts (names, declaring owners,
 * embedding depths, field and result types, first release), no source text.
 * The format is described in the generator.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const STDLIB_TABLE = fileURLToPath(
  new URL(
    "../../../../src/graph/languages/go/stdlib/table.txt.gz",
    import.meta.url,
  ),
);

/** A type as the table records it. */
export type StdType =
  | { k: "named"; pkg: string; name: string }
  | { k: "ptr"; e: StdType }
  | { k: "slice"; e: StdType }
  | { k: "map"; key: StdType; e: StdType }
  | { k: "chan"; e: StdType }
  | { k: "unknown" };

/** A field or method selectable on a named type, with its declaring owner. */
export interface StdMember {
  kind: "field" | "method";
  name: string;
  /** The declaring named type: its package (`builtin` for `error`) and name. */
  ownerPkg: string;
  ownerType: string;
  /** Embedding depth (0: declared on the type; interfaces: always 0). */
  depth: number;
  /** First Go release with this member on this type ("1.N"). */
  since: string;
  /** A field's type. */
  type?: StdType;
  /** A method's result types. */
  results?: StdType[];
}
/** A member that is not the same on every platform, or ambiguous at its depth. */
export interface StdUncertain {
  kind: "uncertain";
  name: string;
  depth: number;
}
export interface StdNamed {
  pkg: string;
  name: string;
  /** s: struct, i: interface, n: any other defined type. */
  shape: "s" | "i" | "n";
  since: string;
  members: Map<string, StdMember | StdUncertain>;
}
export type StdObject =
  | { k: "func"; since: string; results: StdType[] }
  | { k: "value"; since: string; type: StdType }
  | { k: "type"; type: StdNamed };

export interface StdTable {
  /** The Go release the table was generated from (`go1.N.P`). */
  version: string;
  hasPackage(path: string): boolean;
  /** A named type of a package, through a type alias. */
  named(pkg: string, name: string): StdNamed | undefined;
  /** An exported package-level object. */
  object(pkg: string, name: string): StdObject | undefined;
}

const UNKNOWN: StdType = { k: "unknown" };

/** Parses one encoded type at `at`; returns it and the next position. */
function parseType(text: string, at: number): [StdType, number] {
  const char = text[at];
  switch (char) {
    case "?":
      return [UNKNOWN, at + 1];
    case "*":
    case "[":
    case "C": {
      const [e, next] = parseType(text, at + 1);
      return [
        char === "*"
          ? { k: "ptr", e }
          : char === "["
            ? { k: "slice", e }
            : { k: "chan", e },
        next,
      ];
    }
    case "M": {
      const [key, middle] = parseType(text, at + 1);
      const [e, next] = parseType(text, middle);
      return [{ k: "map", key, e }, next];
    }
    default: {
      const end = text.indexOf(";", at);
      if (end < 0) return [UNKNOWN, text.length];
      const full = text.slice(at, end);
      const dot = full.lastIndexOf(".");
      return [
        dot > 0
          ? { k: "named", pkg: full.slice(0, dot), name: full.slice(dot + 1) }
          : UNKNOWN,
        end + 1,
      ];
    }
  }
}
const decode = (text: string): StdType => parseType(text, 0)[0];

/** Builds a table from its text (the generator's format). */
export function parseTable(text: string): StdTable {
  let version = "";
  const packages = new Map<
    string,
    {
      types: Map<string, StdNamed>;
      aliases: Map<string, string>;
      objects: Map<string, StdObject>;
    }
  >();
  let pkg: ReturnType<typeof packages.get>;
  let pkgPath = "";
  let named: StdNamed | undefined;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    switch (f[0]) {
      case "#":
        version = f[2] ?? "";
        break;
      case "P":
        pkgPath = f[1]!;
        pkg = { types: new Map(), aliases: new Map(), objects: new Map() };
        packages.set(pkgPath, pkg);
        named = undefined;
        break;
      case "T":
        named = {
          pkg: pkgPath,
          name: f[1]!,
          shape: f[2] as StdNamed["shape"],
          since: f[3]!,
          members: new Map(),
        };
        pkg!.types.set(named.name, named);
        pkg!.objects.set(named.name, { k: "type", type: named });
        break;
      case "A":
        pkg!.aliases.set(f[1]!, f[2]!);
        named = undefined;
        break;
      case "m":
      case "f": {
        if (!named) break;
        const owner = f[2]!;
        const dot = owner.lastIndexOf(".");
        const member: StdMember = {
          kind: f[0] === "m" ? "method" : "field",
          name: f[1]!,
          ownerPkg: dot > 0 ? owner.slice(0, dot) : pkgPath,
          ownerType: dot > 0 ? owner.slice(dot + 1) : owner,
          depth: Number(f[3]),
          since: f[4]!,
          ...(f[0] === "m"
            ? { results: f.slice(5).map(decode) }
            : { type: decode(f[5] ?? "?") }),
        };
        named.members.set(member.name, member);
        break;
      }
      case "?":
        if (named)
          named.members.set(f[1]!, {
            kind: "uncertain",
            name: f[1]!,
            depth: Number(f[2]),
          });
        break;
      case "F":
        pkg!.objects.set(f[1]!, {
          k: "func",
          since: f[2]!,
          results: f.slice(3).map(decode),
        });
        named = undefined;
        break;
      case "V":
        pkg!.objects.set(f[1]!, {
          k: "value",
          since: f[2]!,
          type: decode(f[3] ?? "?"),
        });
        named = undefined;
        break;
    }
  }
  const resolveNamed = (
    path: string,
    name: string,
    hops = 0,
  ): StdNamed | undefined => {
    const entry = packages.get(path);
    if (!entry || hops > 8) return undefined;
    const direct = entry.types.get(name);
    if (direct) return direct;
    const target = entry.aliases.get(name);
    if (!target) return undefined;
    const dot = target.lastIndexOf(".");
    return resolveNamed(target.slice(0, dot), target.slice(dot + 1), hops + 1);
  };
  return {
    version,
    hasPackage: (path) => packages.has(path),
    named: (path, name) => resolveNamed(path, name),
    object: (path, name) => {
      const entry = packages.get(path);
      if (!entry) return undefined;
      const found = entry.objects.get(name);
      if (found) return found;
      const type = entry.aliases.has(name)
        ? resolveNamed(path, name)
        : undefined;
      return type ? { k: "type", type } : undefined;
    },
  };
}

let loaded: StdTable | undefined;
/** The shipped table, read and parsed once, on first use. */
export function stdTable(): StdTable {
  loaded ??= parseTable(gunzipSync(readFileSync(STDLIB_TABLE)).toString());
  return loaded;
}

/**
 * `graph uses` (C-17): the declaring owner of member `Type.Member` of a
 * standard-library type when that owner is an unexported type
 * (`testing T.Fatal` is declared by `common`), so it can be found by the
 * exported type it is selected through. Undefined otherwise; the table is
 * read only for a `Type.Member` of a package it has.
 */
export function stdDeclaredBy(
  unit: string,
  symbol: string,
): { unit: string; symbol: string } | undefined {
  const match = /^([A-Z]\w*)\.(\w+)$/.exec(symbol);
  if (!match || unit.includes(".") || unit === "builtin") return undefined;
  const table = stdTable();
  if (!table.hasPackage(unit)) return undefined;
  const member = table.named(unit, match[1]!)?.members.get(match[2]!);
  if (!member || member.kind === "uncertain") return undefined;
  if (/^[A-Z]/.test(member.ownerType)) return undefined;
  return {
    unit: member.ownerPkg,
    symbol: `${member.ownerType}.${member.name}`,
  };
}

/** "1.N" or "1.N.P" or "go1.N": [major, minor]; undefined when unreadable. */
function release(version: string): [number, number] | undefined {
  const match = /^(?:go)?(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/**
 * Whether every Go release a project may be built with has a member first
 * released in `since`: the `go` directive is the oldest toolchain that
 * builds the module (Go 1.21 and later enforce it). No directive: false
 * unless the member is in Go 1.0.
 */
export function releasedBy(since: string, directive: string | undefined) {
  const member = release(since);
  if (!member) return false;
  if (member[0] === 1 && member[1] === 0) return true;
  const project = directive === undefined ? undefined : release(directive);
  if (!project) return false;
  return (
    project[0] > member[0] ||
    (project[0] === member[0] && project[1] >= member[1])
  );
}
