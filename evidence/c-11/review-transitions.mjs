// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sampleKey } from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const [beforeName = "review1", afterName = "candidate"] = process.argv.slice(2);
const attempts = (name) =>
  JSON.parse(readFileSync(join(scratch, `${name}-run.json`))).repos;
const after = new Map(attempts(afterName).map((pin) => [pin.id, pin]));
const database = (pin) =>
  new DatabaseSync(
    join(scratch, pin.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );

const totals = new Map();
for (const pin of attempts(beforeName)) {
  const matching = after.get(pin.id);
  if (
    pin.outcome !== "finished" ||
    matching?.outcome !== "finished" ||
    pin.commit !== matching.commit
  )
    throw Error(`Missing comparison pin ${pin.id}`);
  const old = database(pin);
  const revised = database(matching);
  const newLinks = revised.prepare(
    "SELECT id,kind,module,body,resolution FROM graph_links INDEXED BY graph_link_file WHERE file=? AND module='typescript'",
  );
  const newLibraries = revised.prepare(
    "SELECT ecosystem FROM graph_library_targets WHERE link=?",
  );
  const oldLinks = old.prepare(
    "SELECT l.kind,l.module,l.body,t.ecosystem FROM graph_links l INDEXED BY graph_link_file JOIN graph_library_targets t ON t.link=l.id WHERE l.file=? AND l.module='typescript' AND l.resolution='library' AND t.role='target'",
  );
  const source = old.prepare(
    "SELECT json_extract(body,'$.text') AS text FROM graph_files WHERE path=?",
  );
  try {
    for (const { path } of old
      .prepare(
        "SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript'",
      )
      .iterate()) {
      const before = oldLinks.all(path);
      if (!before.length) continue;
      const sites = new Map();
      for (const { body, ...columns } of newLinks.all(path)) {
        const record = { ...JSON.parse(body), ...columns };
        const key = sampleKey(pin, record);
        const next = sites.get(key) ?? [];
        next.push(record);
        sites.set(key, next);
      }
      for (const { body, ...columns } of before) {
        const link = { ...JSON.parse(body), ...columns };
        const choices = sites.get(sampleKey(pin, link)) ?? [];
        const unchanged = choices.findIndex(
          ({ resolution }) => resolution === "library",
        );
        if (unchanged >= 0) {
          choices.splice(unchanged, 1);
          continue;
        }
        const next = choices.shift();
        const outcome = next?.resolution ?? "site-absent";
        const reason = next?.data?.reason;
        const ecosystems = new Set(
          outcome === "ambiguous"
            ? newLibraries.all(next.id).map(({ ecosystem }) => ecosystem)
            : [],
        );
        const cause =
          outcome === "ambiguous" &&
          ecosystems.has("node") &&
          ecosystems.has("npm")
            ? "builtin-polyfill"
            : reason === "missing-global-types" ||
                (outcome === "ambiguous" &&
                  ecosystems.has("node") &&
                  (ecosystems.has("dom") || ecosystems.has("typescript-lib")))
              ? "missing-global-types"
              : outcome === "unresolved" &&
                  link.ecosystem === "npm" &&
                  reason === "external-package"
                ? "package-route-unverified"
                : (reason ??
                  (outcome === "resolved" ? "checkout-declaration" : "other"));
        const key = `${outcome}:${cause}`;
        const count = totals.get(key) ?? { count: 0, examples: [] };
        count.count++;
        if (count.examples.length < 3) {
          const text = source.get(path).text;
          count.examples.push({
            repo: pin.id,
            path,
            line: text.slice(0, link.range.start).split("\n").length,
            name: link.targetName,
          });
        }
        totals.set(key, count);
      }
    }
  } finally {
    old.close();
    revised.close();
  }
}

console.log(JSON.stringify(Object.fromEntries([...totals].sort()), null, 2));
