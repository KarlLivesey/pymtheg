// synth.mjs DIR [FILLERS] [TRIPS] : writes a git checkout of loose script
// files with no config: FILLERS ordinary files (about 4 kB each) and TRIPS
// files that each trip the compiler's merged-enum assertion while warmed,
// so a session rebuilds once per trip file.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [dir, fillers = "2000", trips = "20"] = process.argv.slice(2);
mkdirSync(`${dir}/src`, { recursive: true });
writeFileSync(`${dir}/a.ts`, 'enum E { A = E["B"] }\n');
writeFileSync(`${dir}/b.ts`, "enum E { B = 1 }\n");
for (let i = 0; i < Number(trips); i++)
  writeFileSync(`${dir}/trip${String(i).padStart(3, "0")}.ts`, `const trip${i} = { x: E.A };\n`);
for (let i = 0; i < Number(fillers); i++) {
  const lines = [`export interface Shape${i} { id: number; name: string }`];
  for (let j = 0; j < 40; j++)
    lines.push(`export function f${i}_${j}(shape: Shape${i}): string { const value = shape.name + ${j}; return value.toUpperCase(); }`);
  writeFileSync(`${dir}/src/m${i}.ts`, lines.join("\n") + "\n");
}
execFileSync("git", ["-C", dir, "init", "-q"]);
execFileSync("git", ["-C", dir, "add", "."]);
