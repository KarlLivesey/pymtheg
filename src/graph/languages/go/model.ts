/**
 * Plain JSON facts shared by the Go extraction and resolution phases. Every value
 * here survives persistence; no Tree-sitter object is ever stored.
 */

/** A named type as written: `T`, `*T`, `pkg.T`, `G[int]` all reduce to `{q?, n}`. */
export interface TypeRef {
  /** Package qualifier exactly as written in the source file, if any. */
  q?: string;
  n: string;
}

/**
 * A syntactic description of an expression, recorded at parse time and evaluated
 * only during resolution (which knows every package). Locals are bound at parse.
 */
export type Desc =
  /** An identifier not bound by any enclosing local scope (package, import, dot-import or universe). */
  | { k: "name"; n: string }
  /** `x.n` */
  | { k: "sel"; x: Desc; n: string }
  /** A value whose named type is syntactically evident (declared type, literal, new, assertion). */
  | { k: "val"; t: TypeRef }
  /** Result `i` of calling `f` (function, method or conversion). */
  | { k: "call"; f: Desc; i: number }
  /** A local without a syntactically evident type. */
  | { k: "local" }
  /** A local type declared inside a function body. */
  | { k: "localtype" }
  | { k: "unknown" };

export interface ImportFact {
  path: string;
  /** Explicit name, `.` for dot-import, `_` for blank import. */
  alias?: string;
}

export interface FileFact {
  /** Package clause name, absent when the clause could not be parsed. */
  package?: string;
  packageRange?: { start: number; end: number };
  imports: ImportFact[];
  /** `_test.go` file. */
  test: boolean;
  /** Text of a `//go:build` constraint line before the package clause, if any. */
  build?: string;
  /** GOOS/GOARCH implied by a `_os`, `_arch` or `_os_arch` filename suffix. */
  goos?: string;
  goarch?: string;
}

export const PREDECLARED_TYPES = new Set([
  "any",
  "bool",
  "byte",
  "comparable",
  "complex64",
  "complex128",
  "error",
  "float32",
  "float64",
  "int",
  "int8",
  "int16",
  "int32",
  "int64",
  "rune",
  "string",
  "uint",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "uintptr",
]);
export const PREDECLARED_VALUES = new Set(["nil", "true", "false", "iota"]);
export const BUILTIN_FUNCTIONS = new Set([
  "append",
  "cap",
  "clear",
  "close",
  "complex",
  "copy",
  "delete",
  "imag",
  "len",
  "make",
  "max",
  "min",
  "new",
  "panic",
  "print",
  "println",
  "real",
  "recover",
]);

export const KNOWN_GOOS = new Set([
  "aix",
  "android",
  "darwin",
  "dragonfly",
  "freebsd",
  "hurd",
  "illumos",
  "ios",
  "js",
  "linux",
  "nacl",
  "netbsd",
  "openbsd",
  "plan9",
  "solaris",
  "wasip1",
  "windows",
  "zos",
]);
export const KNOWN_GOARCH = new Set([
  "386",
  "amd64",
  "arm",
  "arm64",
  "loong64",
  "mips",
  "mipsle",
  "mips64",
  "mips64le",
  "ppc64",
  "ppc64le",
  "riscv64",
  "s390x",
  "sparc64",
  "wasm",
]);

export const TYPE_KINDS = new Set(["struct", "interface", "type", "alias"]);
