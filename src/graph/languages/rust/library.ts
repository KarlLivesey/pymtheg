// SPDX-License-Identifier: MIT
import type { LibraryTarget } from "../../types.js";
import type { Crate, Edition } from "./cargo.js";

export type LibraryUnit = Omit<LibraryTarget, "evidence" | "symbol">;
export type LibraryPath = {
  unit: LibraryUnit;
  parts: string[];
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
): LibraryUnit | undefined {
  if (!crate.dependencyGraphKnown || sysroot.has(name)) return;
  const edges = (crate.dependencies ?? []).filter(
    (edge) =>
      edge.name === name && possible([...conditions, ...edge.conditions]),
  );
  const unit = edges[0]?.packageName;
  if (
    !unit ||
    edges.some((edge) => edge.manifest || edge.packageName !== unit) ||
    !edges.some((edge) => edge.conditions.every((c) => implies(conditions, c)))
  )
    return;
  const { libraryVersion: version, libraryVersionSource: versionSource } =
    edges[0]!;
  return {
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
    a.namedImport === b.namedImport
  );
}
