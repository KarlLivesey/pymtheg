// SPDX-License-Identifier: MIT
import { isBuiltin } from "node:module";
import { posix } from "node:path";
import ts from "typescript";
import type { GraphFile, LibraryTarget } from "../../types.js";
import { fromVirtual, LIB_ROOT } from "./project.js";
import {
  dependencyFromCatalog,
  registryRange,
  type Manifest,
  type WorkspaceCatalogs,
} from "./workspace.js";

interface Unit {
  ecosystem: string;
  unit: string;
  subpath?: string;
  registry?: true;
  pin?: { version: string; versionSource: string };
}

export function packageUnit(specifier: string): Unit | undefined {
  if (isBuiltin(specifier))
    return { ecosystem: "node", unit: specifier.replace(/^node:/, "") };
  return registryUnit(specifier);
}

function registryUnit(specifier: string): Unit | undefined {
  const match =
    /^((?:npm|jsr):)?((?:@[\w.-]+\/)?[\w.-]+)(?:@([\w.^~*+-]+))?(?:\/([\w./-]+))?$/.exec(
      specifier,
    );
  if (
    !match ||
    !storableName(match[2]!) ||
    (match[3] && !match[1]) ||
    (match[4] &&
      !match[4].split("/").every((part) => part && !/^\.{1,2}$/.test(part))) ||
    /^\.{1,2}$/.test(match[2]!)
  )
    return undefined;
  return {
    ecosystem: match[1] === "jsr:" ? "jsr" : "npm",
    unit: match[2]!,
    ...(match[1] && { registry: true }),
    ...(match[4] ? { subpath: match[4] } : {}),
  };
}

export function storableName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 1024 &&
    name.trim() === name &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

export function importedTarget(unit: Unit, symbol?: string): LibraryTarget {
  return {
    ecosystem: unit.ecosystem,
    unit: unit.unit,
    ...(symbol !== undefined
      ? { symbol: unit.subpath ? `${unit.subpath}:${symbol}` : symbol }
      : {}),
    evidence: symbol === undefined ? "import-path" : "import-binding",
    ...unit.pin,
  };
}

/** Compare identities without collapsing distinct importer versions. */
export const libraryKey = (target: LibraryTarget): string =>
  JSON.stringify([
    target.ecosystem,
    target.unit,
    target.symbol,
    target.version,
  ]);

const exactVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const dependencyValues = (manifest: Manifest | undefined, name: string) =>
  dependencyFields.flatMap((field) => {
    const value = manifest?.json[field];
    return value && typeof value === "object" && Object.hasOwn(value, name)
      ? [(value as Record<string, unknown>)[name]]
      : [];
  });
const localDependency = (value: unknown): boolean =>
  typeof value === "string" &&
  /^(?:workspace:|file:|link:|portal:|\.{1,2}\/|\/)/.test(value);

function registryDependency(name: string, value: string) {
  const alias = /^npm:((?:@[\w.-]+\/)?[\w.-]+)(?:@(.+))?$/.exec(value);
  const actual = alias ? alias[1]! : name;
  const range = alias ? (alias[2] ?? "*") : value;
  const unit = registryUnit(actual);
  return unit && registryRange(range)
    ? { unit: unit.unit, range, alias: !!alias }
    : undefined;
}

export function bundledLibraryUnit(filename: string): Unit {
  const name = posix.basename(filename);
  if (/^lib\.(?:dom|webworker|scripthost)(?:\.|$)/.test(name))
    return { ecosystem: "dom", unit: "dom" };
  return { ecosystem: "typescript-lib", unit: "es" };
}

const nameOf = (node: ts.Node): string | undefined => {
  const name = (node as ts.NamedDeclaration).name;
  return name &&
    (ts.isIdentifier(name) ||
      ts.isStringLiteralLike(name) ||
      ts.isNumericLiteral(name))
    ? name.text
    : undefined;
};
const globalObjectInterfaces = new Set(["Math", "JSON", "Atomics", "Reflect"]);

/** Compute the path from the selected declaration, never from the receiver spelling. */
function declaredSymbol(declaration: ts.Declaration, bundled: boolean) {
  const name = nameOf(declaration);
  if (name === undefined) return undefined;
  let symbol = name;
  let member = false;
  for (let owner = declaration.parent; owner; owner = owner.parent) {
    if (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) {
      const prefix = nameOf(owner);
      if (!prefix) return undefined;
      const staticMember =
        (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Static) !==
        0;
      const constructor = bundled && /^(.+)Constructor$/.exec(prefix);
      if (constructor) symbol = `${constructor[1]}.${symbol}`;
      else if (bundled && globalObjectInterfaces.has(prefix))
        symbol = `${prefix}.${symbol}`;
      else symbol = `${prefix}${staticMember ? "" : ".prototype"}.${symbol}`;
      member = true;
    } else if (ts.isEnumDeclaration(owner)) {
      symbol = `${owner.name.text}.${symbol}`;
      member = true;
    } else if (ts.isModuleDeclaration(owner)) {
      if (
        ts.isIdentifier(owner.name) &&
        !(owner.flags & ts.NodeFlags.GlobalAugmentation)
      ) {
        symbol = `${owner.name.text}.${symbol}`;
        member = true;
      }
    } else if (
      ts.isTypeLiteralNode(owner) ||
      ts.isMappedTypeNode(owner) ||
      ts.isFunctionLike(owner) ||
      ts.isObjectLiteralExpression(owner)
    )
      return undefined;
  }
  return { symbol, member };
}

/** Declaration ownership and importer version facts, shared across programs. */
export function libraryReader(
  manifests: readonly Manifest[],
  files: readonly GraphFile[],
  workspaceRoots: ReadonlySet<string>,
  workspaceBoundaries: ReadonlySet<string>,
  workspaceCatalogs: WorkspaceCatalogs,
) {
  const directories = new Map(
    manifests.map((item) => [posix.dirname(item.path), item]),
  );
  const packageNames = new Set(manifests.map(({ json }) => json.name));
  const chains = new Map<string, readonly Manifest[]>();
  const scopes = new Map<string, string>();
  const manifestChain = (directory: string): readonly Manifest[] => {
    const previous = chains.get(directory);
    if (previous) return previous;
    const here = directories.get(directory);
    const boundary =
      directory === "." ||
      directory === "/" ||
      workspaceBoundaries.has(directory);
    const parentDirectory = posix.dirname(directory);
    const parent = boundary ? [] : manifestChain(parentDirectory);
    const result = here ? [here, ...parent] : parent;
    chains.set(directory, result);
    scopes.set(directory, boundary ? directory : scopes.get(parentDirectory)!);
    return result;
  };
  const nearest = (path: string) => {
    for (
      let directory = posix.dirname(path);
      ;
      directory = posix.dirname(directory)
    ) {
      const manifest = directories.get(directory);
      if (manifest || directory === "." || directory === "/") return manifest;
    }
  };
  // A captured implementation remains project code. A declaration-only
  // package needs installation, type-package or importer dependency evidence.
  const implemented = new Set<Manifest>();
  for (const { path } of files) {
    if (/\.d\.(?:ts|mts|cts)$/.test(path)) continue;
    const manifest = nearest(path);
    if (manifest) implemented.add(manifest);
  }
  const declarationUnits = new WeakMap<
    ts.SourceFile,
    { unit: Unit; dependency?: Manifest } | null
  >();
  const declarations = new WeakMap<ts.Declaration, LibraryTarget | null>();

  function sourceUnit(source: ts.SourceFile) {
    if (!source.isDeclarationFile) return undefined;
    if (declarationUnits.has(source))
      return declarationUnits.get(source) ?? undefined;
    const path = fromVirtual(source.fileName);
    const manifest = path !== undefined ? nearest(path) : undefined;
    const declared = manifest?.json.name;
    let result: Unit | undefined;
    let dependency: Manifest | undefined;
    if (source.fileName.startsWith(`${LIB_ROOT}/`))
      result = bundledLibraryUnit(source.fileName);
    else if (
      manifest &&
      typeof declared === "string" &&
      manifest.path !== "package.json" &&
      !workspaceRoots.has(posix.dirname(manifest.path)) &&
      manifest.path.split("/").includes("node_modules") &&
      declared.startsWith("@types/")
    ) {
      const name = declared
        .slice("@types/".length)
        .replace(/^([^_]+)__(.+)$/, "@$1/$2");
      result =
        name === "node"
          ? { ecosystem: "node", unit: "globals" }
          : packageUnit(`npm:${name}`);
    } else if (
      manifest &&
      typeof declared === "string" &&
      !declared.startsWith("@types/") &&
      manifest.path !== "package.json" &&
      !implemented.has(manifest) &&
      !workspaceRoots.has(posix.dirname(manifest.path))
    ) {
      const segments = manifest.path.split("/");
      const installed = segments.includes("node_modules");
      result = packageUnit(
        `${installed && segments.includes("jsr.io") ? "jsr" : "npm"}:${declared}`,
      );
      dependency = installed ? undefined : manifest;
    }
    const identity = result
      ? { unit: result, ...(dependency && { dependency }) }
      : undefined;
    declarationUnits.set(source, identity ?? null);
    return identity;
  }

  function targetOf(
    declaration: ts.Declaration,
    unit: Unit,
  ): LibraryTarget | undefined {
    if (declarations.has(declaration))
      return declarations.get(declaration) ?? undefined;
    const bundled =
      unit.ecosystem === "typescript-lib" || unit.ecosystem === "dom";
    const ambient = ts.findAncestor(
      declaration,
      (node) => ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name),
    ) as ts.ModuleDeclaration | undefined;
    const builtin =
      unit.ecosystem === "node" && ambient && packageUnit(ambient.name.text);
    const identity = declaredSymbol(declaration, bundled);
    const target: LibraryTarget | undefined =
      identity && storableName(identity.symbol)
        ? {
            ecosystem: unit.ecosystem,
            unit:
              builtin && builtin.ecosystem === "node"
                ? builtin.unit
                : unit.unit,
            symbol: identity.symbol,
            evidence: identity.member
              ? "declaring-owner"
              : !bundled &&
                  (!!ambient ||
                    ts.isExternalModule(declaration.getSourceFile()))
                ? "import-binding"
                : "declared-builtin",
          }
        : undefined;
    declarations.set(declaration, target ?? null);
    return target;
  }

  return {
    isNodeTypeFile(path: string) {
      return nearest(path)?.json.name === "@types/node";
    },
    forImporter(path: string) {
      const manifest = nearest(path);
      const directory = posix.dirname(path);
      const chain = manifestChain(directory);
      const root = scopes.get(directory)!;
      const catalog = workspaceCatalogs.get(root);
      const capturedDependency = (name: string, value: unknown) =>
        typeof value === "string"
          ? dependencyFromCatalog(catalog, name, value)
          : undefined;
      const dependency = (name: string) => {
        for (const owner of chain) {
          const values = dependencyValues(owner, name);
          if (values.some((value) => typeof value === "string" && value.length))
            return { owner, values };
        }
        return undefined;
      };
      const npmRoute = (
        unit: Unit,
        declared: NonNullable<ReturnType<typeof dependency>>,
      ) => {
        const entries = declared.values.map((raw) => {
          const value = capturedDependency(unit.unit, raw);
          if (!value) return undefined;
          const route = registryDependency(unit.unit, value);
          if (!route) return undefined;
          const source =
            typeof raw === "string" && raw.startsWith("catalog:")
              ? catalog!.source
              : declared.owner.path;
          return { ...route, source };
        });
        const [first, ...rest] = entries;
        if (!first || rest.some((entry) => entry?.unit !== first.unit))
          return undefined;
        const pin =
          first.range.length <= 256 &&
          exactVersion.test(first.range) &&
          rest.every(
            (entry) =>
              entry?.range === first.range && entry.source === first.source,
          )
            ? { version: first.range, versionSource: first.source }
            : undefined;
        return {
          ...unit,
          unit: first.unit,
          ...(first.alias &&
            rest.every((entry) => entry?.alias) && { registry: true as const }),
          ...(pin && { pin }),
        };
      };
      const routes = new Map<string, readonly Unit[]>();
      const declaredDependencies = new Map<Manifest, boolean>();
      function declarationUnit(source: ts.SourceFile): Unit | undefined {
        const identity = sourceUnit(source);
        if (!identity?.dependency) return identity?.unit;
        if (manifest === identity.dependency) return undefined;
        const dependency = identity.dependency;
        let outside = declaredDependencies.get(dependency);
        if (outside === undefined) {
          const values = chain.flatMap((owner) =>
            dependencyValues(owner, identity.unit.unit),
          );
          outside =
            values.length > 0 &&
            values.every((raw) => {
              const value = capturedDependency(identity.unit.unit, raw);
              return (
                !!value &&
                registryDependency(identity.unit.unit, value)?.unit ===
                  identity.unit.unit
              );
            });
          declaredDependencies.set(dependency, outside);
        }
        return outside ? identity.unit : undefined;
      }
      return {
        declarationUnit,
        targetOf,
        expectsNode: () => dependency("@types/node") !== undefined,
        importUnits(specifier: string): readonly Unit[] {
          if (routes.has(specifier)) return routes.get(specifier)!;
          const unit = packageUnit(specifier);
          let result: Unit[] = [];
          if (unit) {
            const explicit = /^(?:node|npm|jsr):/.test(specifier);
            if (explicit) result = [unit];
            else if (unit.ecosystem === "node") {
              const npm = registryUnit(specifier);
              const declared = npm && dependency(npm.unit);
              const outside = npm && declared && npmRoute(npm, declared);
              result = declared ? (outside ? [unit, outside] : []) : [unit];
            } else {
              const declared = dependency(unit.unit);
              const outside = declared && npmRoute(unit, declared);
              if (outside) result = [outside];
            }
          }
          routes.set(specifier, result);
          return result;
        },
        localPackage(unit: Unit) {
          return (
            unit.ecosystem !== "node" &&
            !unit.registry &&
            (packageNames.has(unit.unit) ||
              chain.some((owner) =>
                dependencyValues(owner, unit.unit).some((value) =>
                  localDependency(capturedDependency(unit.unit, value)),
                ),
              ))
          );
        },
      };
    },
  };
}
