// Independent witness of what code is in the browser bundle: build it with
// source maps into a temporary directory and read, from the maps alone, which
// source file every piece of emitted JavaScript comes from. Code that maps to
// no source was written by the build tool itself (helpers, wrappers).
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Computed here, not imported from inventory.mjs, which imports this module.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decode(segment) {
  const out = [];
  let value = 0,
    shift = 0;
  for (const ch of segment) {
    let digit = B64.indexOf(ch);
    const more = digit & 32;
    digit &= 31;
    value += digit << shift;
    if (more) shift += 5;
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}
/**
 * Original 0-based source lines that emitted code maps to, per source index:
 * a line whose code was tree-shaken away has no segment pointing at it.
 */
export function mappedOriginalLines(mappings) {
  const lines = new Map();
  let source = 0,
    line = 0;
  for (const generated of mappings.split(";"))
    for (const s of generated.split(",").filter(Boolean)) {
      const f = decode(s);
      if (f.length < 4) continue;
      source += f[1];
      line += f[2];
      if (!lines.has(source)) lines.set(source, new Set());
      lines.get(source).add(line);
    }
  return lines;
}
/** For each generated line: [[startColumn, sourceIndex | -1], ...]. */
function segments(mappings) {
  let source = 0;
  return mappings.split(";").map((line) => {
    let column = 0;
    return line
      .split(",")
      .filter(Boolean)
      .map((s) => {
        const f = decode(s);
        column += f[0];
        if (f.length >= 4) {
          source += f[1];
          return [column, source];
        }
        return [column, -1];
      });
  });
}
/**
 * Shapes of the code build tools write that has no source in the maps,
 * matched structurally (minified names vary). Each names the project the code
 * comes from; `test/licences.test.mjs` requires that project in the inventory.
 */
const id = "[\\w$]+";
export const injectedSignatures = [
  {
    origin: "rollup",
    what: "chunk import/export statements",
    pattern: new RegExp(
      `import\\{[^}]*\\}from"\\./[^"]+";|import"\\./[^"]+";|export\\{[^}]*\\};?`,
      "g",
    ),
  },
  {
    origin: "vite",
    what: "module preload polyfill",
    pattern: new RegExp(
      `\\(function\\(\\)\\{const ${id}=document\\.createElement\\("link"\\)\\.relList;[\\s\\S]*?fetch\\(${id}\\.href,${id}\\)\\}\\}\\)\\(\\);`,
      "g",
    ),
  },
  {
    origin: "@rollup/plugin-commonjs",
    what: "getDefaultExportFromCjs helper",
    pattern: new RegExp(
      `function ${id}\\(${id}\\)\\{return ${id}&&${id}\\.__esModule&&Object\\.prototype\\.hasOwnProperty\\.call\\(${id},"default"\\)\\?${id}\\.default:${id}\\}`,
      "g",
    ),
  },
  {
    origin: "@rollup/plugin-commonjs",
    what: "CommonJS module wrapper",
    pattern: new RegExp(
      `var ${id}=\\{exports:\\{\\}\\}(,${id}=\\{\\})?;|var ${id}(?:,${id})*;function ${id}\\(\\)\\{if\\(${id}\\)return ${id};${id}=1;`,
      "g",
    ),
  },
];
/** Origins found in an unmapped piece, and whatever no signature explains. */
export function explainUnmapped(text) {
  const origins = new Set();
  let rest = text;
  for (const s of injectedSignatures)
    rest = rest.replace(s.pattern, () => {
      origins.add(s.origin);
      return " ";
    });
  return {
    origins,
    unexplained: /[A-Za-z_$]{2,}/.test(rest) ? rest.trim() : null,
  };
}
/** "ours", "node_modules/<pkg>" or the raw source string. */
export function originOf(source) {
  const s = source.replaceAll("\\", "/");
  const at = s.lastIndexOf("node_modules/");
  if (at >= 0) {
    const rest = s.slice(at + "node_modules/".length).split("/");
    return (
      "package:" +
      (rest[0].startsWith("@") ? rest.slice(0, 2).join("/") : rest[0])
    );
  }
  if (/(^|\/)(web|src)\//.test(s) && !s.includes("\0")) return "ours";
  return "other:" + s;
}
/**
 * Builds web/ with source maps and returns every origin with mapped code, and
 * every stretch of emitted code (ignoring whitespace and punctuation-only
 * runs) that maps to no source.
 */
export async function bundleOrigins() {
  const { build } = await import("vite");
  const outDir = await mkdtemp(join(tmpdir(), "pymtheg-bundle-origins-"));
  try {
    await build({
      configFile: join(root, "web/vite.config.ts"),
      configLoader: "runner",
      logLevel: "silent",
      build: { outDir, emptyOutDir: true, sourcemap: true },
    });
    const origins = new Map();
    const unmapped = [];
    const assets = join(outDir, "assets");
    for (const file of (await readdir(assets)).filter((f) =>
      f.endsWith(".js"),
    )) {
      const code = await readFile(join(assets, file), "utf8");
      const map = JSON.parse(
        await readFile(join(assets, file + ".map"), "utf8"),
      );
      const lines = code.split("\n");
      segments(map.mappings).forEach((segs, lineIndex) => {
        const text = lines[lineIndex] ?? "";
        const bounds = [...segs, [text.length, null]];
        // Code before the first segment of a line is unmapped too.
        if (!segs.length || segs[0][0] > 0) bounds.unshift([0, -1]);
        for (let i = 0; i < bounds.length - 1; i++) {
          const [start, source] = bounds[i];
          const piece = text.slice(start, bounds[i + 1][0]);
          if (source >= 0) {
            const origin = originOf(map.sources[source]);
            origins.set(origin, (origins.get(origin) ?? 0) + piece.length);
          } else if (/[A-Za-z_$]{2,}/.test(piece))
            unmapped.push({
              file,
              line: lineIndex + 1,
              column: start,
              text: piece,
            });
        }
      });
    }
    return { origins, unmapped };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(root, "scripts/licences/bundle-origins.mjs")
) {
  const { origins, unmapped } = await bundleOrigins();
  for (const [o, n] of [...origins].sort())
    if (!o.startsWith("package:")) console.log(o, n);
  console.log(
    "packages",
    [...origins.keys()].filter((o) => o.startsWith("package:")).length,
  );
  const joined = new Map();
  for (const u of unmapped)
    joined.set(
      u.text.slice(0, 160),
      (joined.get(u.text.slice(0, 160)) ?? 0) + 1,
    );
  console.log("unmapped pieces:", unmapped.length, "distinct:", joined.size);
  for (const [t, n] of [...joined]
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, 60))
    console.log(n, JSON.stringify(t));
}
