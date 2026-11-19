// SPDX-License-Identifier: MIT
// C-22 measurement of one pin: cold index, a warm re-index with no edit, then
// each one-file edit (comment, body, export) followed by a re-index, each
// reverted and re-indexed again. After every revert the store must equal the
// cold store row for row (a free equality check of the incremental path).
// Each index runs in a fresh process (index-once.mjs), as the CLI does.
//   node scripts/reindex/measure.mjs <dist> <scratch> <repo id> <out dir> [--profile edit,...]
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { compareRows, storeRows } from "./dump.mjs";

const args = process.argv.slice(2);
const profileAt = args.indexOf("--profile");
const profile = profileAt >= 0 ? args.splice(profileAt, 2)[1].split(",") : [];
const [distArg, scratch, id, outArg] = args;
if (!distArg || !scratch || !id || !outArg)
  throw Error("usage: measure.mjs <dist> <scratch> <repo id> <out dir>");
const dist = resolve(distArg);
const out = resolve(outArg);
const here = new URL(".", import.meta.url).pathname;
const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const pin = cases.pins.find((item) => item.id === id);
if (!pin) throw Error(`no case for ${id}`);
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const label = out.split("/").pop();
const root = join(scratch, "work", label, name);
mkdirSync(out, { recursive: true });
if (existsSync(root)) throw Error(`work copy exists: ${root}`);
mkdirSync(join(scratch, "work", label), { recursive: true });
cpSync(join(scratch, "pins", name), root, { recursive: true });
const cli = (...rest) =>
  execFileSync(process.execPath, [join(dist, "cli/main.js"), ...rest], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
cli("init", ".", "--name", name, "--format", "json");
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
const results = {};
function index(step) {
  const file = join(out, `${name}.${step}.json`);
  const flags = profile.includes(step)
    ? [
        "--cpu-prof",
        "--cpu-prof-dir",
        join(out, "profiles"),
        "--cpu-prof-name",
        `${name}.${step}.cpuprofile`,
      ]
    : [];
  execFileSync(
    process.execPath,
    [...flags, join(here, "index-once.mjs"), dist, root, file],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  results[step] = JSON.parse(readFileSync(file, "utf8"));
  const r = results[step];
  console.log(
    `${id} ${step}: wall ${r.wallMs} ms, cpu ${r.cpuMs} ms, rss ${Math.round(r.maxRssKiB / 1024)} MiB, parsed ${
      Object.entries(r.counts ?? {})
        .filter(([k]) => k.startsWith("parse."))
        .map(([, v]) => v)
        .join("+") || 0
    }, complete ${r.complete}`,
  );
}
index("cold");
const cold = storeRows(graph);
index("warm");
const path = join(root, pin.file);
const original = readFileSync(path, "utf8");
const edits = {
  comment: original + pin.comment,
  body: (() => {
    const at = original.indexOf(pin.anchor);
    if (at < 0 || original.indexOf(pin.anchor, at + 1) >= 0)
      throw Error(`${id}: anchor must occur once`);
    const end = at + pin.anchor.length;
    return original.slice(0, end) + pin.body + original.slice(end);
  })(),
  export: original + pin.export,
};
const equality = {};
for (const [edit, text] of Object.entries(edits)) {
  writeFileSync(path, text);
  index(edit);
  writeFileSync(path, original);
  index(`${edit}-revert`);
  const differences = compareRows(storeRows(graph), cold);
  equality[edit] = differences;
  console.log(
    `${id} ${edit}-revert equals cold: ${differences.length ? "NO " + JSON.stringify(differences).slice(0, 2000) : "yes"}`,
  );
}
writeFileSync(
  join(out, `${name}.summary.json`),
  JSON.stringify({ id, file: pin.file, results, equality }, null, 1),
);
