// locate.mjs BUILD ROOT [PREFIX...] : like analyze.mjs, but first wraps the
// pinned compiler's checker so that a non-stack exception from
// getTypeAtLocation / getSignatureFromDeclaration / getReturnTypeOfSignature
// prints the file and position of the node being asked about.
import { createRequire } from "node:module";
const [build] = process.argv.slice(2);
const ts = createRequire(`${build}/package.json`)("typescript");
const create = ts.createProgram;
ts.createProgram = function (...args) {
  const program = create.apply(this, args);
  const getChecker = program.getTypeChecker;
  program.getTypeChecker = function () {
    const checker = getChecker.call(this);
    for (const name of ["getTypeAtLocation", "getSignatureFromDeclaration"]) {
      const inner = checker[name];
      if (inner.__located) continue;
      checker[name] = function (node, ...rest) {
        try {
          return inner.call(this, node, ...rest);
        } catch (error) {
          if (!(error instanceof RangeError)) {
            const source = node.getSourceFile();
            const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
            console.log("LOCATED", name, source.fileName, `${line + 1}:${character + 1}`, JSON.stringify(node.getText(source).slice(0, 80)), error.message);
          }
          throw error;
        }
      };
      checker[name].__located = true;
    }
    return checker;
  };
  return program;
};
await import("./analyze.mjs");
