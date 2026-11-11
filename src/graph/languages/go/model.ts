/**
 * Plain JSON facts shared by the Go extraction and resolution phases. Every value
 * here survives persistence; no Tree-sitter object is ever stored.
 */

/** A named type as written: `T`, `*T`, `pkg.T`, `G[int]` all reduce to `{q?, n}`. */
export interface TypeRef {
  /** Package qualifier exactly as written in the source file, if any. */
  q?: string;
  n: string;
  /** A function-local type: the identity of its symbol in the same file. */
  l?: string;
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
  /**
   * Result `i` of calling `f` (function, method, conversion or func value). `b`: the
   * result if `f` turns out to be the builtin itself (`new`, `make`, `append`).
   */
  | { k: "call"; f: Desc; i: number; b?: Desc }
  /** The callee `x[…]` of a call: a generic instantiation when x is a function, else an element. */
  | { k: "inst"; x: Desc }
  /** An element (`elem`) or key (`key`) of a slice/map/channel/array value: range, index, receive. */
  | { k: "elem"; x: Desc }
  | { k: "key"; x: Desc }
  /** A value of an unnamed container type: slice, array, map (`key`), channel (`ch`); `e` is the element. */
  | { k: "cont"; e: Desc; key?: Desc; ch?: boolean }
  /** A value of a function type whose result types are `r`. */
  | { k: "func"; r: Desc[] }
  /** A value whose type is a type parameter; `c` is its constraint when that is one named type. */
  | { k: "tval"; c?: TypeRef }
  /**
   * A local variable that is written after its declaration. `d` gives its static
   * type; `alts` lists every value it may hold, absent when a write is not knowable
   * (address taken, op-assignment, range/receive assignment).
   */
  | { k: "var"; d: Desc; alts?: Desc[] }
  /** A local without a syntactically evident type. */
  | { k: "local" }
  /** A value whose type is known to defeat member resolution (local named type). */
  | { k: "opaque" }
  /** A local type or type parameter declared inside a function or generic declaration. */
  | { k: "localtype"; tp?: boolean; c?: TypeRef; sym?: string }
  /** Parse-time only: a live local binding, replaced before facts are returned. */
  | { k: "ref"; b: object }
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
  /**
   * Uses of predeclared identifiers (`nil`, `true`, `int`, `error`, `len`, …) that
   * no local binds. They become links only when a package-level declaration in
   * scope shadows the name; that is decided by `analyze` on every index.
   */
  predeclared?: PredeclaredUse[];
  /** An import declaration had a syntax error: unmatched qualifiers are unknown. */
  importsBroken?: boolean;
  /**
   * Declaration-lossy (layer 1, see W2-B.md): a top-level ERROR, or a declaration
   * whose error could have swallowed following declarations. Decided from the
   * tree alone.
   */
  lossy?: boolean;
}
export interface PredeclaredUse {
  n: string;
  /** "value": an expression identifier; "type": a type position; "call": a conversion call. */
  k: "value" | "type" | "call";
  s: number;
  e: number;
  /** Key of the enclosing symbol (link source). */
  src: string;
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
