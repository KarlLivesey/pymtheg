// SPDX-License-Identifier: MIT
// C-28 diagnosis summary. For each mode: per pin, TypeScript links, Level 2,
// no-symbol links on main, and the diagnosis build's classes of those links.
// Usage: node summary.mjs SCRATCH OUT.json [DIAGNOSIS_PREFIX]
//   SCRATCH holds main-{bare,inst}.json, DIAG-{bare,inst}.json, their
//   classified rows DIAG-{bare,inst}-ns.jsonl and the sweep scratch sw/.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, out, diagnosis = "diag3"] = process.argv.slice(2);
const read = (p) => JSON.parse(readFileSync(join(scratch, p), "utf8"));

/** The reported class of one classified row (see the change note). */
export function reported(r) {
  const d = r.diag;
  if (!d) return ["merged-variants", "-"];
  if (d.form === "computed" || d.form === "computed-element") {
    const sig = d.signature ?? "none";
    if (d.iife) return ["anonymous-callee", "immediately-invoked-function"];
    if (d.calleeKind === "CallExpression" || d.calleeKind === "NewExpression")
      return ["anonymous-callee", "returned-callable"];
    if (d.calleeKind === "ElementAccessExpression")
      return [
        "anonymous-callee",
        /^(MethodDeclaration|FunctionDeclaration)@checkout$/.test(sig)
          ? "computed-key:named-checkout-signature"
          : "computed-key:other",
      ];
    return ["anonymous-callee", d.calleeKind === "FirstNode" ? "qualified-name" : `other:${d.calleeKind}`];
  }
  if (d.form === "name")
    return [
      "undeclared-name",
      d.testGlobal ? "test-global" : d.global ? "runtime-global" : "other",
    ];
  if (d.form === "member") {
    if (d.receiver === "error") {
      const o = d.origin ?? "none";
      if (o.startsWith("module:")) return ["error-receiver", o];
      if (o.startsWith("undeclared")) return ["error-receiver", "undeclared-root"];
      return ["error-receiver", "untraced"];
    }
    if (d.receiver === "any" || d.receiver === "unknown" || d.receiver === "never")
      return ["other-receiver", d.receiver];
    if (d.property && d.property !== "none")
      return ["property-on-type", d.property.where];
    if (d.indexInfos) return ["undeclared-member", "index-signature-arm"];
    return ["undeclared-member", d.js ? "javascript" : d.receiver];
  }
  return ["other", d.node];
}

const bundleFile = (file, d) =>
  /(^|\/)(dist|public\/libs|static|vendor)\//.test(file) ||
  /\.min\.js$/.test(file) ||
  /[-.](?=[A-Za-z0-9_]*\d)(?=[A-Za-z0-9_]*[A-Z])[A-Za-z0-9_]{8}\.js$/.test(file) ||
  !!d?.longLine;

function pinCounts(results, receipt) {
  const counts = new Map();
  for (const repo of read(receipt).repos) {
    if (repo.outcome !== "finished") {
      counts.set(repo.id, { outcome: repo.outcome });
      continue;
    }
    const db = new DatabaseSync(
      join(results, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
      { readOnly: true },
    );
    const one = (sql) => db.prepare(sql).get().n;
    counts.set(repo.id, {
      outcome: "finished",
      links: one("SELECT count(*) AS n FROM graph_links WHERE module='typescript'"),
      level2: one(`SELECT count(*) AS n FROM graph_links AS l WHERE module='typescript' AND (resolution='resolved' OR (resolution='library' AND EXISTS (SELECT 1 FROM graph_library_targets AS t WHERE t.link=l.id AND t.symbol IS NOT NULL)))`),
      noSymbol: one("SELECT count(*) AS n FROM graph_links WHERE module='typescript' AND json_extract(body,'$.data.reason')='no-symbol'"),
      outcomes: db
        .prepare("SELECT resolution, coalesce(json_extract(body,'$.data.reason'),'') AS reason, count(*) AS n FROM graph_links WHERE module='typescript' GROUP BY 1,2")
        .all()
        .map((r) => `${r.resolution}|${r.reason}|${r.n}`)
        .sort()
        .join(";"),
    });
    db.close();
  }
  return counts;
}

const summary = { modes: {} };
for (const [mode, tag] of [["bare", "bare"], ["installed", "inst"]]) {
  const sw = join(scratch, "sw");
  const main = pinCounts(sw, `main-${tag}.json`);
  const diag = pinCounts(sw, `${diagnosis}-${tag}.json`);
  const pins = {};
  for (const [pin, m] of main) {
    const d = diag.get(pin);
    pins[pin] = {
      ...m,
      outcomes: undefined,
      diagnosisSameOutcomes: m.outcome === "finished" ? m.outcomes === d?.outcomes : undefined,
      classes: {},
      bundle: 0,
    };
  }
  for (const line of readFileSync(join(scratch, `${diagnosis}-${tag}-ns.jsonl`), "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    const [cls, sub] = reported(r);
    const key = `${cls}\t${sub}`;
    const p = pins[r.pin];
    p.classes[key] = (p.classes[key] ?? 0) + 1;
    if (bundleFile(r.file, r.diag)) {
      p.bundle++;
      p.classes[`bundle\t${cls}`] = (p.classes[`bundle\t${cls}`] ?? 0) + 1;
    }
  }
  summary.modes[mode] = pins;
}
writeFileSync(out, JSON.stringify(summary, null, 1) + "\n");
for (const [mode, pins] of Object.entries(summary.modes))
  for (const [pin, p] of Object.entries(pins))
    console.log(mode, pin, p.outcome, p.links, p.level2, p.noSymbol, "same:", p.diagnosisSameOutcomes, "bundle:", p.bundle);
