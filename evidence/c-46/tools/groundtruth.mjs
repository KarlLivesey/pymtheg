// SPDX-License-Identifier: MIT
// C-46 groundtruth.mjs AFTER.sqlite BUILT.sqlite MANIFEST OUT.json : for each
// TypeScript link in the unbuilt checkout's graph (AFTER) that follows a
// C-46 convention into the package whose manifest is MANIFEST, the link at
// the same site (file, kind, range, target name) in the graph of the same
// checkout after the package was really built (BUILT): does the built
// checkout give the same declaration? The built target is a declaration in
// the build output; it agrees when its identity (the declaration's name
// path) equals the convention target's.
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [afterPath, builtPath, manifest, out] = process.argv.slice(2);
const read = (path) => {
  const db = new DatabaseSync(path, { readOnly: true });
  const symbols = new Map();
  for (const { id, file, body } of db.prepare("SELECT id, file, body FROM graph_symbols").iterate())
    symbols.set(id, { file, identity: JSON.parse(body).identity });
  const links = new Map();
  for (const { resolution, target, body } of db
    .prepare("SELECT resolution, target, body FROM graph_links WHERE module='typescript'")
    .iterate()) {
    const l = JSON.parse(body);
    links.set([l.file, l.kind, l.range.start, l.range.end, l.targetName].join("|"), {
      resolution,
      target: target ? symbols.get(target) : undefined,
      data: l.data ?? {},
    });
  }
  db.close();
  return links;
};
const after = read(afterPath);
const built = read(builtPath);
const totals = {};
const examples = {};
for (const [site, link] of after) {
  const assumes = link.data.assumes ?? [];
  const convention = assumes.find((name) => name.startsWith("ts-unbuilt-entry-is-") && name !== "ts-unbuilt-entry-is-compiler-emit");
  if (!convention || link.data.unbuiltEntry?.build !== manifest || link.resolution !== "resolved") continue;
  const other = built.get(site);
  // Identities of a module itself are its path; compare those by the stem.
  const stem = (identity, file) => (identity === file ? "(module)" : identity);
  let verdict;
  if (!other) verdict = "no such site in the built graph";
  else if (other.resolution !== "resolved" || !other.target)
    verdict = `built: ${other.resolution}${other.data.reason ? ":" + other.data.reason : ""}`;
  else if (stem(other.target.identity, other.target.file) === stem(link.target.identity, link.target.file))
    verdict = "same declaration";
  else verdict = "a different declaration";
  const key = `${convention} | ${verdict}`;
  totals[key] = (totals[key] ?? 0) + 1;
  const list = (examples[key] ??= []);
  if (list.length < 5)
    list.push({
      site,
      unbuilt: `${link.target.file}#${link.target.identity}`,
      built: other?.target ? `${other.target.file}#${other.target.identity}` : null,
    });
}
writeFileSync(out, JSON.stringify({ manifest, totals, examples }, null, 1) + "\n");
console.log(manifest, JSON.stringify(totals));
