// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import { posix } from "node:path";

export const modules = ["go", "rust", "typescript"];
export const scopes = ["source", "bundle", "broken-fixture", "template"];
export const outcomes = ["resolved", "ambiguous", "unresolved"];
export const dispositions = ["eligible", "outside", "inside", "unclassified"];
export const columns = ["module", "kind", "outcome", "reason", "uncertainty", "scope", "disposition", "count", "blocked",
  "externalLevel", "externalEvidence", "externalGap"];
export const sampleSeed = 0x7c8a59bd2e41;
export const sampleSize = (stratum) => ["go:empty", "rust:empty", "rust:receiver", "typescript:no-symbol"].includes(stratum) ? 96 : 32;
const standardGo = new Set(`archive bufio bytes cmp compress container context crypto database debug embed encoding errors expvar flag fmt go hash html image index io iter log maps math mime net os path plugin reflect regexp runtime slices sort strconv strings sync syscall testing text time unicode unique unsafe weak`.split(" "));
const standardGoResults = new Map(Object.entries({
  "context.WithCancel": "1:CancelFunc", "context.WithTimeout": "1:CancelFunc", "context.WithDeadline": "1:CancelFunc",
  "context.WithCancelCause": "1:CancelCauseFunc", "context.WithTimeoutCause": "1:CancelFunc", "context.WithDeadlineCause": "1:CancelFunc",
  "os/signal.NotifyContext": "1:CancelFunc",
}));
const standardRust = new Set(["std", "core", "alloc", "proc_macro", "test"]);
export const rustPreludeMacros = new Set(`assert assert_eq assert_ne cfg column compile_error concat dbg debug_assert debug_assert_eq debug_assert_ne eprint eprintln env file format format_args include include_bytes include_str line matches module_path option_env panic print println stringify todo unimplemented unreachable vec write writeln`.split(" "));
export const rustPreludeTypes = new Set(`bool char str f32 f64 i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize Box Clone Copy Default DoubleEndedIterator Drop Eq ExactSizeIterator Fn FnMut FnOnce From FromIterator Into IntoIterator Iterator Option Ord PartialEq PartialOrd Result Send Sized String Sync ToOwned ToString TryFrom TryInto Unpin Vec`.split(" "));
const standardJs = new Set(`Array ArrayBuffer BigInt Boolean DataView Date Error EvalError FinalizationRegistry Function Infinity Intl JSON Map Math NaN Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set SharedArrayBuffer String Symbol SyntaxError TypeError URIError WeakMap WeakRef WeakSet clearInterval clearTimeout console decodeURI decodeURIComponent encodeURI encodeURIComponent isFinite isNaN parseFloat parseInt queueMicrotask setInterval setTimeout structuredClone undefined Awaited ConstructorParameters Exclude Extract InstanceType NonNullable Omit Parameters Partial Pick PromiseLike Readonly ReadonlyArray Record Required ReturnType ThisParameterType ThisType`.split(" "));
const assertionPackages = new Set(["chai", "vitest", "@vitest/expect", "@jest/expect", "expect"]);

export const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
export const packageName = (value) => /^(@[^/]+\/[^/]+|[^/@][^/]*)/.exec(value)?.[1];
export const workspaceEntryMissing = (reason) =>
  reason === "workspace-entry-unavailable" || reason === "workspace-build-output-missing";
export function workspaceNames(manifests, pnpmFiles) {
  const roots = [];
  for (const [path, doc] of manifests) {
    const patterns = Array.isArray(doc?.workspaces) ? doc.workspaces : doc?.workspaces?.packages;
    if (Array.isArray(patterns)) roots.push([posix.dirname(path), patterns.filter((pattern) => typeof pattern === "string")]);
  }
  for (const [path, text] of pnpmFiles) {
    const section = /^packages:\s*\n((?:[ \t]+[^\n]*\n?)*)/m.exec(text)?.[1] ?? "";
    const patterns = [...section.matchAll(/^[ \t]*-[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|([^#\n]+))/gm)]
      .map((match) => (match[1] ?? match[2] ?? match[3]).trim());
    roots.push([posix.dirname(path), patterns]);
  }
  const names = new Set();
  for (const [path, doc] of manifests) for (const [root, patterns] of roots) {
    if (typeof doc?.name !== "string") continue;
    const relative = posix.relative(root, posix.dirname(path));
    if (!relative || relative === ".." || relative.startsWith("../")) continue;
    const matches = (pattern) => posix.matchesGlob(relative, pattern.replace(/^\.\//, "").replace(/\/$/, ""));
    if (patterns.some((pattern) => !pattern.startsWith("!") && matches(pattern)) &&
        !patterns.some((pattern) => pattern.startsWith("!") && matches(pattern.slice(1)))) names.add(doc.name);
  }
  return names;
}
const canonicalCrate = (value) => value?.replaceAll("-", "_");
const knownInvalidGo = new Set([
  "cmd/fiximports/testdata/src/old.com/bad/bad.go", "go/analysis/passes/copylock/testdata/src/a/newexpr_go126.go",
  "go/analysis/passes/modernize/testdata/src/newexpr/newexpr_go128.go", "go/loader/testdata/badpkgdecl.go",
  "go/ssa/interp/testdata/complit_go128.go", "gopls/internal/analysis/fillswitch/testdata/src/a/a.go",
  "gopls/internal/analysis/ptrtoerror/testdata/src/f/f.go",
  ...["extra/geez/help.go", "extra/v2/geez/help.go", "extra/v2/me.go", "extra/yo.go", "tempmod/main.go",
    "what@v1.0.0/main.go", "what@v1.1.0/main.go"].map((file) => `internal/packagestest/testdata/groups/two/modules/example.com/${file}`),
]);
export const rustTaint = (reason, uncertainty) => [reason, uncertainty].some((value) =>
  value?.split(/;\s*/).includes("failed-file-unseen-declarations"));

export function sourceScope(repo, file, text) {
  if (repo === "golang/tools" && knownInvalidGo.has(file)) return "broken-fixture";
  if (/\.(?:m?js|cjs)$/.test(file) && (/\.min\./.test(file) ||
      /(?:^|\/)(?:dist|public\/libs|static)\//.test(file) && /[^\n]{900}/.test(text) ||
      repo === "pocketbase/pocketbase" && file.startsWith("ui/dist/"))) {
    return "bundle";
  }
  if ((repo === "tauri-apps/tauri" && file.includes("/templates/") && /\{\{/.test(text)) ||
      (repo === "rust-lang/mdBook" && /(?:^|\/)example\.rs$/.test(file) && /^#(?: |$)/m.test(text))) return "template";
  if (/(?:^|\/)(?:tests?|__tests__|fixtures|testdata|assets|playground)\//.test(file) &&
      /(?:syntax[-_ ]?error|unparsable|list-parse-error|badpkgdecl|\/bad\/bad\.go|tsconfig-json-load-error\/has-error)/i.test(file)) {
    return "broken-fixture";
  }
  return "source";
}

export function failedFamily(scope, reason, module, source = "") {
  if (scope === "broken-fixture" || scope === "template") return scope;
  if (/Unreadable package manifest/.test(reason) && reason.includes("\ufeff")) return "manifest-bom";
  if (/TypeScript config .* (extends|is unreadable)|^Unreadable TypeScript config/.test(reason)) return "tsconfig";
  if (module === "rust" && /^(?:line \d|Syntax error)/.test(reason)) {
    if (reason.includes("unexpected `!`") && /\bstr!\s*\[\s*\[/.test(source)) return "rust-snapshot-macro";
    if (reason.includes("unexpected `#[rustfmt::skip]`") || reason.includes("unexpected `|`") && /\|\s*#\[/.test(source)) return "rust-parameter-attribute";
    return "rust-grammar";
  }
  if (module === "go" && /syntax error|unexpected/.test(reason)) return "go-grammar";
  return "other-failed-file";
}

function goImport(path, project, file) {
  if (!path || path === "C" || path === ".") return "unclassified";
  if (path.startsWith(".")) return "inside";
  const destinations = project.goDestinations(file, path);
  if (project.vendoredGo.has(path) || destinations.directories.length && !destinations.outside) return "inside";
  if (destinations.directories.length || project.goModules.some((root) => path === root || path.startsWith(`${root}/`))) return "unclassified";
  const first = path.split("/")[0];
  if (standardGo.has(first) || project.goExternal(file, path)) return "outside";
  return "unclassified";
}

function goPath(link, imports) {
  if (link.kind === "imports") return link.data?.path ?? link.targetName;
  const expr = link.data?.expr;
  const base = expr?.k === "inst" ? expr.x : expr;
  const alias = base?.k === "sel" && base.x?.k === "name" ? base.x.n : undefined;
  return alias ? imports.get(alias) : undefined;
}

function goValueOrigin(desc, evidence, link, project) {
  if (desc?.k === "val" && desc.t?.q) {
    const path = evidence.goImports.get(desc.t.q);
    return path && goImport(path, project, link.file) === "outside" ? { path, type: desc.t.n } : null;
  }
  if (desc?.k !== "call") return null;
  const f = desc.f;
  if (f?.k === "sel" && f.x?.k === "name") {
    const path = evidence.goImports.get(f.x.n);
    const [slot, type] = standardGoResults.get(`${path}.${f.n}`)?.split(":") ?? [];
    if (type && desc.i === Number(slot) && goImport(path, project, link.file) === "outside") {
      return { path: path === "os/signal" ? "context" : path, type };
    }
  }
  return evidence.goReturned?.(desc) ?? null;
}

export function goImports(links) {
  const aliases = new Map();
  for (const link of links) {
    const path = link.data?.path ?? link.targetName;
    const alias = link.data?.alias ?? path.split("/").at(-1);
    if (!/^\w+$/.test(alias) || alias === "_" || /^v\d+$/.test(alias) && !link.data?.alias) continue;
    aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== path ? null : path);
  }
  return aliases;
}

export function tsBindings(ts, file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const names = new Map();
  const imports = new Map();
  const importMembers = new Map();
  const specifiers = [];
  const propertyRoots = new Map();
  const literalProperties = new Set();
  let unsafe = false;
  const rememberSpecifier = (node, value) => {
    if (value) specifiers.push({ start: node.getStart(source), end: node.end, value });
  };
  const bind = (name, specifier, member, declaration = name) => {
    if (!name) return;
    if (ts.isIdentifier(name)) {
      names.set(name.text, (names.get(name.text) ?? 0) + 1);
      if (specifier) {
        imports.set(name.text, specifier);
        if (member !== undefined) importMembers.set(name.text, { specifier, member, start: declaration.getStart(source) });
      }
    } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const item of name.elements) if (ts.isBindingElement(item)) bind(item.name, specifier);
    }
  };
  const visit = (node) => {
    if (ts.isWithStatement(node) || ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") unsafe = true;
    if (ts.isPropertyAccessExpression(node)) {
      const offset = node.name.getStart(source);
      let receiver = node.expression;
      while (ts.isParenthesizedExpression(receiver)) receiver = receiver.expression;
      if (ts.isArrayLiteralExpression(receiver) || ts.isStringLiteralLike(receiver) || ts.isRegularExpressionLiteral(receiver) || ts.isNumericLiteral(receiver)) literalProperties.add(offset);
      while (ts.isPropertyAccessExpression(receiver) || ts.isCallExpression(receiver) || ts.isParenthesizedExpression(receiver)) receiver = receiver.expression;
      if (ts.isIdentifier(receiver)) propertyRoots.set(offset, receiver.text);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const { importClause: clause, moduleSpecifier } = node;
      const specifier = node.parent === source ? moduleSpecifier.text : undefined;
      rememberSpecifier(node, specifier);
      bind(clause?.name, specifier, "default");
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) bind(bindings.name, specifier, "*", bindings);
      else for (const element of bindings?.elements ?? []) {
        bind(element.name, specifier, (element.propertyName ?? element.name).text, element);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      const specifier = node.parent === source && ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteralLike(ref.expression) ? ref.expression.text : undefined;
      rememberSpecifier(node, specifier);
      bind(node.name, specifier, "*", node.name);
    } else if (ts.isExportDeclaration(node) && node.parent === source && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      rememberSpecifier(node, node.moduleSpecifier.text);
    } else if (ts.isVariableDeclaration(node)) {
      const call = node.initializer;
      const literal = node.parent?.parent?.parent === source && (node.parent.flags & ts.NodeFlags.Const) &&
        call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) &&
        call.expression.text === "require" && call.arguments.length === 1 && ts.isStringLiteralLike(call.arguments[0]) ? call.arguments[0] : undefined;
      // Require bindings enter through an actual graph import, checked by caller.
      bind(node.name, literal?.text, "*", literal);
    } else if (ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isEnumDeclaration(node) ||
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isTypeParameterDeclaration(node) ||
        ts.isModuleDeclaration(node)) bind(node.name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { source, unsafe, names, specifiers, propertyRoots, literalProperties,
    importMembers: unsafe ? new Map() : new Map([...importMembers].filter(([name]) => names.get(name) === 1)),
    imports: unsafe ? new Map() : new Map([...imports].filter(([name]) => names.get(name) === 1)) };
}

const tsHead = (target) => /^(?:new\s+)?([\w$]+)(?:\??\.[\w$]+)?$/.exec(target)?.[1];
const tsGlobalHead = (target) => /^(?:new\s+)?([\w$]+)(?:\??\.[\w$]+)*$/.exec(target)?.[1];

function tsSpecifier(link, evidence) {
  if (typeof link.data?.specifier === "string") return link.data.specifier;
  if (link.kind === "imports" || link.kind === "exports") {
    const declared = evidence.tsSpecifierAt?.(link.range?.start);
    if (declared) return declared;
  }
  // A direct import or member has a lexical base. After a call, the named assertion
  // APIs below supply enough origin evidence for their fluent result.
  const name = tsHead(link.targetName);
  if (name) return evidence.tsImports().get(name);
  const root = evidence.tsPropertyRoot?.(link.range?.start);
  const specifier = root && evidence.tsImports().get(root);
  if (specifier && assertionPackages.has(packageName(specifier))) return specifier;
  return undefined;
}

function tsPath(path, project, file) {
  if (!path || /^\s|\s$/.test(path)) return "unclassified";
  if (path.startsWith("node:") && isBuiltin(path)) return "outside";
  if (/^\.\.?(?:\/|$)/.test(path) && /^\.\.(?:\/|$)/.test(posix.normalize(posix.join(posix.dirname(file), path)))) return "outside";
  if (/^\.{1,2}(?:\/|$)|^[#/]/.test(path)) return "inside";
  const pkg = packageName(path);
  if (!pkg) return "unclassified";
  const location = project.tsLocation?.(file, pkg);
  if (location === "inside") return "inside";
  if (project.tsPackages.has(pkg)) return location ? "unclassified" : "inside";
  if (project.tsAliases.some((match) => match.test(path))) return "unclassified";
  if (location) return location;
  if (isBuiltin(path) || !project.tsArchiveUnknown && project.tsExternal.has(pkg)) return "outside";
  return "unclassified";
}

function rustPath(link, evidence) {
  if (link.kind === "imports" || link.data?.externCrate) {
    if (link.data?.externCrate || /^(?:::|(?:crate|self|super)::)/.test(link.targetName)) return link.targetName;
    if (link.data?.scope) return undefined;
    const root = /^\w+/.exec(link.targetName)?.[0];
    return evidence.rustImports.has(root) ? evidence.rustImports.get(root) ?? undefined : link.targetName;
  }
  if (link.kind === "calls" && link.data?.method) return undefined;
  if (!["calls", "types", "values", "macros"].includes(link.kind)) return undefined;
  const target = link.data?.pathSyntax ?? link.targetName;
  const prefix = /^(?:::)?([\w]+)(?=::|$)/.exec(target)?.[1];
  if (!prefix) return undefined;
  if (link.data?.blocked || link.data?.stdFallbackBlocked || link.data?.stdFallbackConditional) return undefined;
  if (evidence.rustImports.has(prefix)) return evidence.rustImports.get(prefix) ?? undefined;
  return target.includes("::") ? target : undefined;
}

export function rustImports(links) {
  const aliases = new Map();
  for (const link of links) {
    if (link.data?.scope || link.data?.conditions?.length || link.data?.glob) continue;
    const alias = link.data?.alias;
    if (alias) aliases.set(alias, aliases.has(alias) ? null : link.targetName);
  }
  return aliases;
}

function rustDisposition(path, project, file) {
  const name = /^(?:::)?([\w]+)(?=::|$)/.exec(path ?? "")?.[1];
  if (!name) return "unclassified";
  if (["self", "Self", "super", "crate"].includes(name)) return "inside";
  const bindings = project.rustBindings(file, name);
  if (bindings === "inside" || bindings === "unclassified") return bindings;
  if (project.rustLocal.has(canonicalCrate(name))) return "unclassified";
  if (standardRust.has(name) || bindings === "outside") return "outside";
  return "unclassified";
}

export function classify(link, evidence, project) {
  if (link.resolution !== "unresolved") return "eligible";
  const { module } = link;
  const data = link.data ?? {};
  if (data.cause) return "inside";
  if (module === "go") {
    if (data.builtin === true) return "outside";
    const path = goPath(link, evidence.goImports);
    if (path) return goImport(path, project, link.file);
    const expr = data.expr?.k === "inst" ? data.expr.x : data.expr;
    const origin = goValueOrigin(expr, evidence, link, project);
    if (origin?.path === "context" && ["CancelFunc", "CancelCauseFunc"].includes(origin.type)) return "outside";
  }
  if (module === "typescript") {
    if (workspaceEntryMissing(data.reason)) return "inside";
    if (data.reason === "workspace-member-runtime-unverified") return "unclassified";
    const path = tsSpecifier(link, evidence);
    if (path && (link.data?.specifier || evidence.tsSpecifiers.has(path))) return tsPath(path, project, link.file);
    if (data.reference === "lib") return "outside";
    if (data.reference === "types" && tsPath(`@types/${link.targetName}`, project, link.file) === "outside") return "outside";
    const head = tsGlobalHead(link.targetName);
    if (standardJs.has(head) && evidence.tsGlobal?.(head) || evidence.tsLiteral?.(link.range?.start)) return "outside";
  }
  if (module === "rust") {
    if (link.kind === "modules") return "inside";
    const path = rustPath(link, evidence);
    if (path) return rustDisposition(path, project, link.file);
    const names = link.kind === "macros" ? rustPreludeMacros : link.kind === "types" ? rustPreludeTypes : null;
    if (names?.has(link.targetName) && !data.blocked && !data.stdFallbackBlocked && !data.stdFallbackConditional &&
        !evidence.rustImports.has(link.targetName) && project.rustPrelude?.(link.targetName, link.kind)) return "outside";
  }
  if (["local", "invalid-code", "unresolved-alias", "target-unavailable"].includes(data.reason) ||
      data.uncertainty?.split("; ").includes("invalid-code")) return "inside";
  return "unclassified";
}

export const externalEvidenceKinds = ["path", "import-binding", "explicit-trait", "reference-directive"];
export const externalGapKinds = ["whole-unit", "intrinsic", "dependency", "unknown",
  "go-external-result", "rust-std-path", "rust-std-receiver", "ts-runtime"];
const identifier = /^[\w$]+$/;
const rustNamePath = /^(?:::)?\w+(?:::\w+)*$/;

function identified(unit, symbol, evidence) {
  return symbol
    ? { level: 2, unit, symbol, evidence, gap: null }
    : { level: 1, unit, evidence, gap: "whole-unit" };
}

function goExternalIdentity(link, evidence, project) {
  const { data = {}, file, kind, targetName } = link;
  const external = (path) => goImport(path, project, file) === "outside";
  if (kind === "imports") {
    const path = data.path ?? targetName;
    return external(path) ? identified(path, null, "path") : null;
  }
  const packageOf = (alias) => {
    const path = evidence.goImports.get(alias);
    // The path basename does not establish a third-party package's declared
    // name. The stored explicit alias or the standard package spelling does.
    return path && external(path) && (evidence.goExplicitAliases?.has(alias) ||
      standardGo.has(path.split("/")[0])) ? path : null;
  };
  if (data.t?.q && identifier.test(data.t.n ?? "")) {
    const path = packageOf(data.t.q);
    if (path) return identified(path, data.t.n, "import-binding");
  }
  const expr = data.expr?.k === "inst" ? data.expr.x : data.expr;
  if (expr?.k !== "sel" || !identifier.test(expr.n ?? "")) return null;
  const receiver = expr.x;
  if (receiver?.k === "name") {
    const path = packageOf(receiver.n);
    if (path) return identified(path, expr.n, "import-binding");
  }
  // Go selectors can promote a member of an embedded type. A receiver's
  // written type supplies neither the declaring type nor its package.
  return null;
}

function rustExternalIdentity(link, evidence, project) {
  const { data = {}, file, kind, targetName } = link;
  const externalPath = (path, via, method) => {
    const glob = path?.endsWith("::*");
    const literal = glob ? path.slice(0, -3) : path;
    if (!rustNamePath.test(literal ?? "") || rustDisposition(literal, project, file) !== "outside") return null;
    const [unit, ...parts] = literal.replace(/^::/, "").split("::");
    if (method) parts.push(method);
    return identified(glob ? literal : unit, glob ? null : parts.join("::"), via);
  };
  if (kind === "imports" || data.externCrate) return externalPath(targetName, "path");
  if (data.blocked || data.stdFallbackBlocked || data.stdFallbackConditional || data.stdFallbackReceiverUnknown) return null;
  // A dot call supplies a receiver, which may use an alias, deref to a
  // different type, or select a trait from a different crate.
  if (kind === "calls" && data.method) return null;
  if (!["calls", "types", "values", "macros", "patterns", "implements"].includes(kind)) return null;
  const path = data.pathSyntax ?? targetName;
  const traitCall = kind === "calls" && /^<.+\bas\s+((?:::)?\w+(?:::\w+)*)\s*>\s*::\s*(\w+)$/s.exec(path);
  if (traitCall) {
    const [, trait, method] = traitCall;
    const [head, ...parts] = trait.split("::");
    const alias = evidence.rustImports.get(head);
    if (alias) return externalPath([alias, ...parts].join("::"), "explicit-trait", method);
    return evidence.rustImports.has(head) ? null : externalPath(trait, "explicit-trait", method);
  }
  if (!rustNamePath.test(path)) return null;
  const [head, ...parts] = path.replace(/^::/, "").split("::");
  const alias = !path.startsWith("::") && evidence.rustImports.get(head);
  if (alias) return externalPath([alias, ...parts].join("::"), "import-binding");
  if (parts.length && !evidence.rustImports.has(head)) return externalPath(path, "path");
  return null;
}

function tsExternalIdentity(link, evidence, project, disposition) {
  const { data = {}, file, kind, targetName, range } = link;
  const external = (specifier) => tsPath(specifier, project, file) === "outside";
  if (data.specifier && external(data.specifier)) return identified(data.specifier, null, "path");
  if (disposition === "outside" && ["lib", "types"].includes(data.reference)) {
    return identified(data.reference === "lib" ? "typescript/lib/" + targetName : "@types/" + targetName,
      null, "reference-directive");
  }
  if (["imports", "exports"].includes(kind)) {
    const path = evidence.tsSpecifierAt?.(range?.start);
    if (evidence.tsSpecifiers.has(path) && external(path)) {
      return identified(path, identifier.test(targetName) ? targetName : null, "import-binding");
    }
    // An import binding's stored span must select the enclosing declaration.
    // Falling back to a same-named binding could pick the preceding import.
    return null;
  }
  const name = tsGlobalHead(targetName);
  const binding = name && evidence.tsImportMember?.(name);
  if (!binding || !external(binding.specifier)) return null;
  const suffix = targetName.replace(/^new\s+/, "").replaceAll("?.", ".").split(".").slice(1);
  const path = [binding.member === "*" ? null : binding.member, ...suffix].filter(Boolean);
  return identified(binding.specifier, path.join("."), "import-binding");
}

/** Identity already expressible using the released link and its stored facts. */
export function externalIdentity(link, evidence, project, disposition) {
  if (link.resolution !== "unresolved") return null;
  const data = link.data ?? {};
  if (data.cause || link.module === "typescript" &&
    (workspaceEntryMissing(data.reason) || data.reason === "workspace-member-runtime-unverified")) return null;
  const observed = link.module === "go" ? goExternalIdentity(link, evidence, project)
    : link.module === "rust" ? rustExternalIdentity(link, evidence, project)
      : tsExternalIdentity(link, evidence, project, disposition);
  if (observed || disposition !== "outside") return observed;
  let gap = "unknown";
  if (link.module === "go") {
    if (data.builtin) gap = "intrinsic";
    else if (goPath(link, evidence.goImports)) gap = "dependency";
    else if (data.expr) gap = "go-external-result";
  }
  if (link.module === "rust" && !data.blocked && !data.stdFallbackReceiverUnknown) {
    if (["types", "macros"].includes(link.kind)) gap = "rust-std-path";
  }
  if (link.module === "typescript") {
    gap = tsSpecifier(link, evidence) ? "dependency" : "ts-runtime";
  }
  return { level: 0, evidence: null, gap };
}

export function sampleStratum(link, disposition) {
  if (disposition === "outside" || link.resolution === "resolved") return null;
  if (link.resolution === "ambiguous") return `${link.module}:ambiguous`;
  if (link.module === "rust" && rustTaint(link.data?.reason, link.data?.uncertainty)) return "rust:failed-file-taint";
  const reason = link.data?.reason ?? link.data?.uncertainty ?? "";
  if (link.module === "rust" && /receiver-type-unverified/.test(reason)) return "rust:receiver";
  if (link.module === "rust" && /opaque-item-may-shadow-name/.test(reason)) return "rust:opaque-declaration";
  if (link.module === "rust" && /path-type-unverified|namespace-binding-unverified/.test(reason)) return "rust:path-or-namespace";
  if (link.module === "typescript" && workspaceEntryMissing(reason)) return "typescript:external-package";
  if (link.module === "typescript" && ["no-symbol", "local", "external-package", "incomplete-config", "external", "missing-module"].includes(reason)) {
    return `typescript:${reason}`;
  }
  if (link.module === "go" && reason === "invalid-code") return "go:invalid-code";
  return `${link.module}:${reason ? "other" : "empty"}`;
}

export function reviewBucket(stratum, scope, disposition) {
  return `${stratum}:${scope}:${disposition}`;
}

export function reviewPopulation(repos) {
  const population = new Map();
  for (const repo of repos) {
    if (repo.outcome !== "finished") continue;
    for (const [module, , resolution, reason, uncertainty, scope, disposition, count, , level] of repo.breakdown) {
      if (level != null) continue;
      const stratum = sampleStratum({ module, resolution, data: { reason, uncertainty } }, disposition);
      if (!stratum) continue;
      const key = reviewBucket(stratum, scope, disposition);
      population.set(key, (population.get(key) ?? 0) + count);
    }
  }
  return population;
}

export function reviewQuotas(repos) {
  const population = reviewPopulation(repos);
  return new Map(modules.flatMap((module) => {
    const rows = [...population].filter(([key]) => key.startsWith(`${module}:`));
    const total = rows.reduce((sum, [, count]) => sum + count, 0);
    return rows.map(([key, count]) => [key, Math.min(count, Math.max(count < 100 ? 1 : 6, Math.round(420 * count / total)))]);
  }));
}

export function sampleKey(repo, link) {
  // Project IDs in the store can change between checkouts. Rank source sites
  // using their pinned file and span, independent of that ID and worker order.
  return createHash("sha256").update(JSON.stringify([
    sampleSeed, repo.id, repo.commit, link.module, link.kind, link.file,
    link.range?.start, link.range?.end, link.targetName, link.origin,
  ])).digest("hex");
}

export function repositoryScore(rows, filter = () => true) {
  const counts = { resolved: 0, ambiguous: 0, inside: 0, outside: 0, unclassified: 0 };
  for (const [module, kind, outcome, reason, uncertainty, scope, disposition, count] of rows) {
    if (filter(module, scope, kind)) counts[outcome === "unresolved" ? disposition : outcome] += count;
  }
  const eligible = counts.resolved + counts.ambiguous + counts.inside + counts.unclassified;
  const total = eligible + counts.outside;
  return { ...counts, eligible, total, adjusted: eligible ? counts.resolved / eligible : null, raw: total ? counts.resolved / total : null };
}

export function libraryScore(rows, filter = () => true) {
  const score = repositoryScore(rows, filter);
  const levels = [0, 0, 0];
  const gaps = new Map();
  for (const [module, kind, , , , scope, , count, , level, , gap] of rows) {
    if (level == null || !filter(module, scope, kind)) continue;
    levels[level] += count;
    if (gap) gaps.set(gap, (gaps.get(gap) ?? 0) + count);
  }
  const [neither, unitOnly, symbol] = levels;
  const identifiedUnit = unitOnly + symbol;
  const provenOutside = neither + identifiedUnit;
  const strictDenominator = score.total - provenOutside;
  return {
    ...score, neither, unitOnly, symbol, identifiedUnit, provenOutside, gaps,
    adjusted: strictDenominator ? score.resolved / strictDenominator : null,
    level1: score.total ? (score.resolved + identifiedUnit) / score.total : null,
    level2: score.total ? (score.resolved + symbol) / score.total : null,
  };
}
