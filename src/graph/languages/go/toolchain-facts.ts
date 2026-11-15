/**
 * The helper's records (toolchain/golinks.go) joined to the Go module's own
 * link drafts (W3-L). Joins, as in the W2-L comparison
 * (evidence/w2-l/scripts/compare-module.py): a `calls` link's range end equals
 * the call's callee end (or, for `F[T](x)`, the end of F); a `references`,
 * `embeds` or `receiver` link's range end equals the used identifier's end.
 * Helper offsets are bytes; graph ranges are UTF-16 code units.
 */
import type { Json, LinkDraft } from "../../types.js";
import type { ToolchainFact, ToolchainPair } from "./resolve.js";

/** Byte offset → UTF-16 offset, for one file's text. */
function converter(text: string): (byte: number) => number {
  // Identity for ASCII text (the common case).
  if (!/[^\u0000-\u007f]/.test(text)) return (byte) => byte;
  const bytes = Buffer.from(text, "utf8");
  const table = new Uint32Array(bytes.length + 1);
  let unit = 0;
  for (let index = 0; index < bytes.length; index++) {
    table[index] = unit;
    const byte = bytes[index]!;
    // A code point's first byte: 1 UTF-16 unit, or 2 for 4-byte sequences.
    if (byte < 0x80 || byte >= 0xc0) unit += byte >= 0xf0 ? 2 : 1;
  }
  table[bytes.length] = unit;
  return (byte) => (byte >= 0 && byte <= bytes.length ? table[byte]! : -1);
}

export interface ToolchainFacts {
  goVersion: string;
  configuration: string;
  /** Main-module files in the configuration: package import path and whether its whole closure is clean. */
  files: Map<string, { pkg: string; clean: boolean }>;
  /** Main-module files the configuration leaves out, with go list's reason. */
  excluded: Map<string, string>;
  /** Per file: call facts by callee end (UTF-16). */
  calls: Map<string, Map<number, ToolchainFact>>;
  /** Per file: identifier facts by identifier end (UTF-16). */
  uses: Map<string, Map<number, ToolchainFact>>;
  /** Per type file: implements pairs (UTF-16 offsets). */
  implements: Map<string, ToolchainPair[]>;
  /** No loaded package has an error: implementer sets and pairs are definite. */
  universe: boolean;
  errors: string[];
  packages: { total: number; clean: number };
  listFailed: boolean;
}

/**
 * Parses the helper's records. `texts` holds the snapshot text of every
 * captured file (helper paths are relative to the project root, where the
 * module is).
 */
export function parseFacts(
  output: string,
  texts: ReadonlyMap<string, string>,
): ToolchainFacts {
  const convert = new Map<string, (byte: number) => number>();
  const u16 = (file: string, byte: number): number | undefined => {
    const text = texts.get(file);
    if (text === undefined || byte < 0) return undefined;
    let fn = convert.get(file);
    if (!fn) convert.set(file, (fn = converter(text)));
    const offset = fn(byte);
    return offset < 0 ? undefined : offset;
  };
  const facts: ToolchainFacts = {
    goVersion: "",
    configuration: "",
    files: new Map(),
    excluded: new Map(),
    calls: new Map(),
    uses: new Map(),
    implements: new Map(),
    universe: false,
    errors: [],
    packages: { total: 0, clean: 0 },
    listFailed: false,
  };
  const at = (
    cls: string,
    file: string,
    byte: string,
    pkg: string,
    name: string,
  ): Partial<ToolchainFact> => {
    if (cls === "builtin") return { b: true };
    if (cls === "std" || cls === "dep")
      return pkg !== "-" && name !== "-" ? { ext: `${pkg}.${name}` } : {};
    if (cls !== "module") return {};
    const offset = u16(file, Number(byte));
    return offset === undefined ? {} : { at: [file, offset, name] };
  };
  const set = (
    map: Map<string, Map<number, ToolchainFact>>,
    file: string,
    end: number | undefined,
    fact: ToolchainFact,
  ) => {
    if (end === undefined) return;
    let byEnd = map.get(file);
    if (!byEnd) map.set(file, (byEnd = new Map()));
    // The first record for an end wins (helper order is deterministic).
    if (!byEnd.has(end)) byEnd.set(end, fact);
  };
  const dispatch = new Map<string, [string, number, string][] | null>();
  const external = new Map<string, number>();
  const pending: { file: string; end: number; fact: ToolchainFact }[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    switch (f[0]) {
      case "V":
        facts.goVersion = f[1] ?? "";
        facts.configuration = f[2] ?? "";
        break;
      case "P":
        facts.packages.total++;
        if (f[3] === "true") facts.packages.clean++;
        break;
      case "F":
        facts.files.set(f[1]!, { pkg: f[2]!, clean: f[3] === "true" });
        break;
      case "X":
        if (!facts.excluded.has(f[1]!)) facts.excluded.set(f[1]!, f[3]!);
        break;
      case "E":
        facts.errors.push(f.slice(1).join(" "));
        break;
      case "S":
        if (f[1] === "universe-clean") facts.universe = f[2] === "true";
        if (f[1] === "list-failed") facts.listFailed = true;
        break;
      case "C": {
        // C file funEnd nameEnd cat class defFile defOff pkg name
        const [, file, funEnd, nameEnd, cat, cls, defFile, defOff, pkg, name] =
          f as [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ];
        const fact: ToolchainFact = {
          c: cat,
          ...at(cls, defFile, defOff, pkg, name),
        };
        const end = u16(file, Number(funEnd));
        if (end === undefined) break;
        pending.push({ file, end, fact });
        set(facts.calls, file, end, fact);
        const nameAt = u16(file, Number(nameEnd));
        if (nameAt !== end) set(facts.calls, file, nameAt, fact);
        break;
      }
      case "U": {
        // U file identEnd kind class defFile defOff pkg name
        const [, file, end, kind, cls, defFile, defOff, pkg, name] = f as [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        set(facts.uses, file, u16(file, Number(end)), {
          c: kind,
          ...at(cls, defFile, defOff, pkg, name),
        });
        break;
      }
      case "D": {
        // D file funEnd ext methods(file:off,...)
        const [, file, funEnd, ext, list] = f as [
          string,
          string,
          string,
          string,
          string,
        ];
        const methods: [string, number, string][] = [];
        let complete = true;
        if (list === "?") complete = false;
        for (const item of (list ?? "")
          .split(",")
          .filter((x) => x && x !== "?")) {
          const split = item.lastIndexOf(":");
          const mfile = item.slice(0, split);
          const offset = u16(mfile, Number(item.slice(split + 1)));
          if (offset === undefined) complete = false;
          else methods.push([mfile, offset, ""]);
        }
        const key = `${file}\u0000${u16(file, Number(funEnd))}`;
        dispatch.set(key, complete ? methods : null);
        external.set(key, Number(ext));
        break;
      }
      case "I": {
        // I typeFile typeOff ifaceFile ifaceOff how
        const [, tfile, toff, ifile, ioff, how] = f as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const typeOffset = u16(tfile, Number(toff));
        const ifaceOffset = u16(ifile, Number(ioff));
        if (typeOffset === undefined || ifaceOffset === undefined) break;
        let list = facts.implements.get(tfile);
        if (!list) facts.implements.set(tfile, (list = []));
        list.push([
          typeOffset,
          ifile,
          ifaceOffset,
          how === "pointer" ? "pointer" : "value",
        ]);
        break;
      }
    }
  }
  // Interface calls: attach the verified implementer set (methods named as
  // the interface method is, so the resolver matches them by name).
  for (const { file, end, fact } of pending) {
    if (fact.c !== "iface" && fact.c !== "typeparam") continue;
    const key = `${file}\u0000${end}`;
    if (!dispatch.has(key)) continue;
    const methods = dispatch.get(key);
    if (methods && fact.at) {
      fact.d = methods.map(([mfile, offset]) => [mfile, offset, fact.at![2]]);
      fact.x = external.get(key) ?? 0;
    }
  }
  return facts;
}

const JOINED_BY_USE = new Set(["references", "embeds", "receiver"]);

/** The fact for one link draft of a file in the configuration, if any. */
export function factFor(
  facts: ToolchainFacts,
  file: string,
  link: LinkDraft,
): ToolchainFact | undefined {
  if (link.kind === "calls") return facts.calls.get(file)?.get(link.range.end);
  if (JOINED_BY_USE.has(link.kind))
    return facts.uses.get(file)?.get(link.range.end);
  return undefined;
}

const EXCLUDED: Record<string, string> = {
  ignored:
    "excluded by build constraints in this configuration (GOOS/GOARCH, tags, or cgo off)",
  invalid: "rejected by go list",
  cgo: "needs cgo (off)",
};

/** The file-level toolchain record (W3-L): where a file's links came from. */
export function fileStatus(
  facts: ToolchainFacts,
  file: string,
): { [key: string]: Json } {
  const base = { go: facts.goVersion, configuration: facts.configuration };
  const entry = facts.files.get(file);
  if (!entry)
    return {
      ...base,
      status: "outside-configuration",
      reason:
        EXCLUDED[facts.excluded.get(file) ?? ""] ??
        "not loaded by go list (another module, testdata, or no package)",
    };
  return {
    ...base,
    status: entry.clean ? "in-configuration" : "package-has-errors",
    universe: facts.universe,
    ...(facts.implements.has(file)
      ? { implements: facts.implements.get(file)! as unknown as Json }
      : {}),
  };
}
