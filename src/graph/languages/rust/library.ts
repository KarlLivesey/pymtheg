// SPDX-License-Identifier: MIT
import type { LibraryTarget } from "../../types.js";
import type { Crate, Edition } from "./cargo.js";
import {
  auditedMacro,
  compatibleRelease,
  compatibleRequirement,
} from "./macro-catalog.js";

export type LibraryUnit = Omit<LibraryTarget, "evidence" | "symbol">;
type RegistryRelease = { version?: string; requirement?: string; features?: readonly string[] };
export type LibraryPath = {
  unit: LibraryUnit;
  parts: string[];
  registry?: readonly RegistryRelease[];
  imported?: boolean;
  namedImport?: boolean;
};

export const sysroot = new Set(["std", "core", "alloc", "proc_macro", "test"]);

export function dependencyUnit(
  crate: Crate,
  name: string,
  conditions: string[],
  possible: (conditions: string[]) => boolean,
  implies: (conditions: string[], condition: string) => boolean,
  probe = false,
): Omit<LibraryPath, "parts"> | undefined {
  if ((!crate.libraryDependencyGraphKnown && !probe) || sysroot.has(name))
    return;
  const edges = (crate.dependencies ?? []).filter(
    (edge) =>
      edge.name === name && possible([...conditions, ...edge.conditions]),
  );
  const unit = edges[0]?.packageName;
  if (
    !unit ||
    edges.some(
      (edge) => (edge.manifest && !probe) || edge.packageName !== unit,
    ) ||
    !edges.some(
      (edge) =>
        !edge.manifest &&
        (probe || edge.conditions.every((c) => implies(conditions, c))),
    )
  )
    return;
  const { libraryVersion: version, libraryVersionSource: versionSource } =
    edges[0]!;
  return {
    unit: {
      ecosystem: "cargo",
      unit,
      ...(version &&
      versionSource &&
      edges.every(
        (edge) =>
          edge.libraryVersion === version &&
          edge.libraryVersionSource === versionSource,
      )
        ? { version, versionSource }
        : {}),
    },
    registry: edges.map((edge) => ({
      ...(edge.registryVersion !== undefined
        ? { version: edge.registryVersion }
        : edge.registryRequirement !== undefined
          ? { requirement: edge.registryRequirement }
          : {}),
      ...(edge.features ? { features: edge.features } : {}),
    })),
  };
}

// The standard prelude reexports these paths. Keep `std` on an implicit std
// path, even when its implementation is in core or alloc.
// https://doc.rust-lang.org/reference/names/preludes.html#standard-library-prelude
const preludeTypes = new Map<string, string>();
for (const [module, members] of Object.entries({
  borrow: "ToOwned",
  boxed: "Box",
  clone: "Clone",
  cmp: "Eq Ord PartialEq PartialOrd",
  convert: "AsMut AsRef From Into",
  default: "Default",
  iter: "DoubleEndedIterator ExactSizeIterator Extend IntoIterator Iterator",
  marker: "Copy Send Sized Sync Unpin",
  ops: "Drop Fn FnMut FnOnce",
  option: "Option",
  result: "Result",
  string: "String ToString",
  vec: "Vec",
})) {
  for (const name of members.split(" "))
    preludeTypes.set(name, module + "::" + name);
}
const prelude2021 = new Map([
  ["FromIterator", "iter::FromIterator"],
  ["TryFrom", "convert::TryFrom"],
  ["TryInto", "convert::TryInto"],
]);
const prelude2024 = new Map([
  ["Future", "future::Future"],
  ["IntoFuture", "future::IntoFuture"],
]);
const preludeValues = new Map([
  ["drop", "mem::drop"],
  ["Some", "option::Option::Some"],
  ["None", "option::Option::None"],
  ["Ok", "result::Result::Ok"],
  ["Err", "result::Result::Err"],
]);
const preludeMacros = new Set(
  "assert assert_eq assert_ne cfg column compile_error concat dbg debug_assert debug_assert_eq debug_assert_ne eprint eprintln env file format format_args include include_bytes include_str line matches module_path option_env panic print println stringify todo unimplemented unreachable vec write writeln".split(
    " ",
  ),
);
const standardBangExports = new Map([
  ["std", preludeMacros],
  [
    "core",
    new Set(
      "assert assert_eq assert_ne cfg column compile_error concat debug_assert debug_assert_eq debug_assert_ne env file format_args include include_bytes include_str line matches module_path option_env panic stringify todo try unimplemented unreachable write writeln".split(
        " ",
      ),
    ),
  ],
  ["alloc", new Set(["format", "vec"])],
]);
const preludeDerives = new Map([
  ["Clone", "clone"],
  ["Copy", "marker"],
  ["Debug", "fmt"],
  ["Default", "default"],
  ["Eq", "cmp"],
  ["Hash", "hash"],
  ["Ord", "cmp"],
  ["PartialEq", "cmp"],
  ["PartialOrd", "cmp"],
]);

export function preludePath(
  name: string,
  edition: Edition | null | undefined,
  namespace: "type" | "value" | "macro" | "derive",
): string[] | undefined {
  if (!edition) return;
  if (namespace === "macro")
    return preludeMacros.has(name) ? [name] : undefined;
  if (namespace === "derive") {
    const module = preludeDerives.get(name);
    return module ? [module, name] : undefined;
  }
  const path =
    namespace === "value"
      ? preludeValues.get(name)
      : (preludeTypes.get(name) ??
        (edition >= "2021" ? prelude2021.get(name) : undefined) ??
        (edition === "2024" ? prelude2024.get(name) : undefined));
  return path?.split("::");
}

// Known modules, whose final path segment selects an export directly rather
// than dispatching through an owning type. An unknown prefix could be a type
// alias or a reexport of a type, regardless of its capitalization.
const coreModules =
  "any arch array ascii borrow cell char clone cmp convert default error f32 f64 ffi fmt future hash hint iter marker mem net num ops option panic pin prelude primitive ptr result slice str sync sync::atomic task time".split(
    " ",
  );
const allocModules =
  "alloc borrow boxed collections collections::binary_heap collections::btree_map collections::btree_set collections::linked_list collections::vec_deque rc string sync vec".split(
    " ",
  );
const standardModules = new Map([
  ["core", new Set(coreModules)],
  ["alloc", new Set(allocModules)],
  [
    "std",
    new Set([
      ...coreModules,
      ...allocModules,
      ..."backtrace collections::hash_map collections::hash_set env fs io os os::fd os::unix os::unix::ffi os::unix::fs os::unix::io os::unix::net os::windows os::windows::ffi os::windows::fs os::windows::io path process sync::mpsc thread".split(
        " ",
      ),
    ]),
  ],
]);

type ExportNamespace =
  | "type"
  | "value"
  | "type-value"
  | "bang"
  | "derive"
  | "attribute"
  | "multiple";

/** Names whose namespace the macro expansion lookup can check in Cargo. */
export function scopeMacroExport(path: LibraryPath): ExportNamespace | undefined {
  const { unit, parts } = path;
  if (unit.ecosystem === "cargo" && parts.length === 1) {
    const name = parts[0]!;
    const feature = (name: string) => path.registry?.every((release) => release.features?.includes(name));
    switch (unit.unit) {
      case "bitflags":
        if (name === "bitflags" && registryFamily(path, "2.0.0")) return "bang";
        break;
      case "rstest":
        if (["rstest", "fixture"].includes(name) && registryFamily(path, "0.28.0")) return "attribute";
        break;
      case "serde":
        if (["Serialize", "Deserialize"].includes(name) && registryFamily(path, "1.0.0") && feature("derive")) return "multiple";
        break;
      case "clap":
        if (["Parser", "Args", "Subcommand", "ValueEnum"].includes(name) && registryFamily(path, "4.0.0") && feature("derive")) return "multiple";
        break;
      case "tokio":
        if (["test", "main"].includes(name) && !feature("macros") && !feature("full")) return undefined;
        break;
    }
  }
  return exportNamespace(path);
}

// Public declaration paths whose import namespace is known. A capital letter
// does not distinguish a type, a tuple constructor and a derive macro.
const standardTypes = new Set([
  ...preludeTypes.values(),
  ...prelude2021.values(),
  ...prelude2024.values(),
  ..."collections::HashMap collections::HashSet collections::BTreeMap collections::BTreeSet collections::VecDeque collections::hash_map::HashMap collections::hash_set::HashSet fmt::Formatter fmt::Result fmt::Display io::Read io::Write io::Error io::ErrorKind mem::MaybeUninit mem::ManuallyDrop marker::PhantomData ops::Bound ops::RangeBounds path::Path path::PathBuf sync::Arc sync::Mutex sync::MutexGuard sync::RwLock time::Duration time::Instant".split(
    " ",
  ),
  ..."AtomicBool AtomicPtr AtomicI8 AtomicI16 AtomicI32 AtomicI64 AtomicIsize AtomicU8 AtomicU16 AtomicU32 AtomicU64 AtomicUsize Ordering"
    .split(" ")
    .map((name) => `sync::atomic::${name}`),
]);
const standardValues = new Set(
  "env::var fs::read fs::write mem::drop mem::replace mem::size_of mem::swap mem::take thread::sleep thread::spawn ops::Bound::Unbounded".split(
    " ",
  ),
);

function registryFamily(
  path: LibraryPath,
  audited: string,
  minimum = audited,
): boolean {
  return (
    !!path.registry?.length &&
    path.registry.every(({ version, requirement }) =>
      version === undefined
        ? compatibleRequirement(audited, requirement, minimum)
        : compatibleRelease(audited, version, minimum),
    )
  );
}

export function exportNamespace(
  path: LibraryPath,
): ExportNamespace | undefined {
  const {
    unit: { ecosystem, unit },
    parts,
  } = path;
  const name = parts.join("::");
  if (ecosystem === "cargo") {
    if (
      path.registry?.length &&
      path.registry.every(({ version, requirement }) =>
        auditedMacro(unit, version, name, requirement),
      )
    )
      return "bang";
    if (
      unit === "thiserror" &&
      name === "Error" &&
      (registryFamily(path, "1.0.0") || registryFamily(path, "2.0.0"))
    )
      return "derive";
    if (
      unit === "syn" &&
      name === "parse_macro_input" &&
      (registryFamily(path, "1.0.0") ||
        registryFamily(path, "2.0.0") ||
        registryFamily(path, "3.0.0"))
    )
      return "bang";
    if (
      unit === "tokio" &&
      ["main", "test"].includes(name) &&
      registryFamily(path, "1.0.0")
    )
      return "attribute";
    if (
      unit === "regex-automata" &&
      name === "meta::Regex" &&
      registryFamily(path, "0.4.0")
    )
      return "type";
    if (
      unit === "serde" &&
      registryFamily(path, "1.0.0") &&
      /^(?:(?:de|ser)(?:::(?:Error|Visitor|SeqAccess|MapAccess|EnumAccess|VariantAccess|DeserializeSeed|SerializeSeq|SerializeMap|SerializeStruct|SerializeTuple|SerializeTupleStruct|SerializeTupleVariant|SerializeStructVariant|Impossible|Unexpected))?|Serializer|Deserializer)$/.test(
        name,
      )
    )
      return "type";
    if (
      unit === "serde_test" &&
      name === "Token" &&
      registryFamily(path, "1.0.0")
    )
      return "type";
    if (
      unit === "proc-macro2" &&
      /^(?:TokenStream|TokenTree|Span|Group|Ident|Punct|Literal|Delimiter|Spacing)$/.test(
        name,
      ) &&
      registryFamily(path, "1.0.0")
    )
      return "type";
    if (
      unit === "syn" &&
      (registryFamily(path, "1.0.0") || registryFamily(path, "2.0.0"))
    ) {
      if (name === "parse") return "multiple";
      if (
        /^(?:punctuated|spanned|Ident|Type|Path|Expr|Item|DeriveInput|Attribute|Field|Fields|Generics|Visibility|Result|Error)$/.test(
          name,
        )
      )
        return "type";
    }
    return;
  }
  if (
    unit === "proc_macro" &&
    [
      "TokenStream",
      "TokenTree",
      "Span",
      "Group",
      "Ident",
      "Punct",
      "Literal",
    ].includes(name)
  )
    return "type";
  if (!["std", "core", "alloc"].includes(unit)) return;
  if (
    parts.at(-1) &&
    preludeDerives.get(parts.at(-1)!) === parts[0] &&
    parts.length === 2
  )
    return "multiple";
  if (parts.length === 1 && standardBangExports.get(unit)?.has(name))
    return standardModules.get(unit)?.has(name) ? "multiple" : "bang";
  if (
    ["std", "core"].includes(unit) &&
    ["arch::asm", "arch::global_asm", "arch::naked_asm"].includes(name)
  )
    return "bang";
  if (name === "num::Wrapping") return "type-value";
  if (standardTypes.has(name) || standardModules.get(unit)?.has(name))
    return "type";
  if (standardValues.has(name) || variants.has(name)) return "value";
}

export function permitsNamespace(
  kind: ExportNamespace | undefined,
  namespace: string,
): boolean {
  if (!kind || kind === "multiple" || namespace === "any") return true;
  if (namespace === "type" || namespace === "importType")
    return kind === "type" || kind === "type-value";
  if (namespace === "value") return kind === "value" || kind === "type-value";
  if (namespace === "macro")
    return kind === "bang" || kind === "derive" || kind === "attribute";
  return true;
}

export function librarySymbol(path: LibraryPath, flavor?: string): string {
  const name = path.parts.join("::");
  if (flavor === "bang") return `${name}!`;
  if (flavor === "derive") return `#[derive(${name})]`;
  if (flavor === "attribute") return `#[${name}]`;
  return name;
}

// This small list contains inherent constructors and language-library enum
// variants whose ownership the module can establish without dependency source.
const constructors = new Set([
  "boxed::Box::new",
  "collections::BTreeMap::new",
  "collections::BTreeSet::new",
  "collections::HashMap::new",
  "collections::HashSet::new",
  "collections::VecDeque::new",
  "collections::hash_map::HashMap::new",
  "collections::hash_set::HashSet::new",
  "path::Path::new",
  "path::PathBuf::new",
  "string::String::new",
  "vec::Vec::new",
]);
const variants = new Set([
  "option::Option::Some",
  "option::Option::None",
  "result::Result::Ok",
  "result::Result::Err",
]);
const traitMembers = new Set([
  "iter::Iterator::next",
  "convert::Into::into",
  "convert::From::from",
  "clone::Clone::clone",
  "default::Default::default",
]);

export function valuePathKind(
  path: LibraryPath,
): "export" | "variant" | "owner" | undefined {
  // Stable imports can name ordinary exports and enum variants. They cannot
  // import an inherent or trait method as a free value.
  if (path.parts.length === 1 || path.namedImport) return "export";
  const prefix = path.parts.slice(0, -1).join("::");
  const key = path.parts.join("::");
  if (path.unit.ecosystem === "cargo") return;
  if (standardModules.get(path.unit.unit)?.has(prefix)) return "export";
  if (variants.has(key)) return "variant";
  if (constructors.has(key) || traitMembers.has(key)) return "owner";
}

export function sameLibraryPath(a: LibraryPath, b: LibraryPath): boolean {
  return (
    a.unit.ecosystem === b.unit.ecosystem &&
    a.unit.unit === b.unit.unit &&
    a.unit.version === b.unit.version &&
    a.unit.versionSource === b.unit.versionSource &&
    a.parts.join("::") === b.parts.join("::") &&
    a.imported === b.imported &&
    a.namedImport === b.namedImport &&
    JSON.stringify(a.registry) === JSON.stringify(b.registry)
  );
}
