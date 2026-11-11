// Compiler-backed W1-C fixture copied without changing the shared review tests.
import assert from "node:assert/strict";
import ts from "typescript";
export function compilerModule(observations) {
  return {
    id: "compiler-fixture",
    version: "1",
    extensions: [".ts"],
    contextFiles: ["tsconfig*.json"],
    analyze(context) {
      observations.push({
        files: context.files.map((file) => file.path),
        changed: context.changedFiles,
        contexts: context.changedContextFiles,
      });
      const config = JSON.parse(
        context.contextFiles.find((file) => file.path === "tsconfig.json").text,
      );
      const sources = new Map(
        context.files.map((file) => [
          "/" + file.path,
          ts.createSourceFile(
            "/" + file.path,
            file.text,
            ts.ScriptTarget.Latest,
            true,
          ),
        ]),
      );
      const host = {
        getSourceFile: (path) => sources.get(path),
        getDefaultLibFileName: () => "/__none.d.ts",
        writeFile() {
          throw Error("no writes");
        },
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (path) => path,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (path) => sources.has(path),
        readFile: (path) => sources.get(path)?.text,
        directoryExists: () => true,
        getDirectories: () => [],
      };
      const program = ts.createProgram(
        [...sources.keys()],
        {
          noLib: true,
          types: [],
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          baseUrl: "/",
          paths: config.compilerOptions.paths,
        },
        host,
      );
      assert.deepEqual(program.getSyntacticDiagnostics(), []);
      const checker = program.getTypeChecker();
      return context.files.map((file) => {
        const source = sources.get("/" + file.path);
        const result = {
          status: "clean",
          diagnostics: [],
          symbols: [],
          links: [],
        };
        const visit = (node, owner = null) => {
          if (ts.isFunctionDeclaration(node) && node.name) {
            owner = node.name.text;
            result.symbols.push({
              key: owner,
              name: owner,
              identity: owner,
              kind: "function",
              range: { start: node.getStart(source), end: node.end },
            });
          }
          if (ts.isCallExpression(node)) {
            let symbol = checker.getSymbolAtLocation(node.expression);
            if (symbol?.flags & ts.SymbolFlags.Alias)
              symbol = checker.getAliasedSymbol(symbol);
            const declaration = symbol?.declarations?.[0];
            result.links.push({
              sourceKey: owner,
              kind: "calls",
              targetName: node.expression.getText(source),
              range: { start: node.getStart(source), end: node.end },
              data: declaration
                ? {
                    file: declaration.getSourceFile().fileName.slice(1),
                    key: symbol.name,
                  }
                : null,
            });
          }
          ts.forEachChild(node, (child) => visit(child, owner));
        };
        visit(source);
        return { path: file.path, result };
      });
    },
    resolve({ symbols, links }) {
      return links.flatMap((link) => {
        const target = symbols.find(
          (symbol) =>
            symbol.file === link.data?.file && symbol.key === link.data?.key,
        );
        return target ? [{ linkId: link.id, targetId: target.id }] : [];
      });
    },
  };
}
