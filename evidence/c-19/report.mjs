// SPDX-License-Identifier: MIT
// C-19: aggregate the per-pin joins and run records into results.json and a
// markdown summary. Reads WORK/pins.txt, WORK/out/*.join.json, the
// rust-analyzer run records (WORK/out/*.meta.txt) and the Pymtheg index
// records (WORK/pym/*.time.txt, *.index.json).
// Usage: node report.mjs WORK OUT_DIR
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [work, outDir] = process.argv.slice(2);
const pins = readFileSync(join(work, "pins.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const num = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};
const seconds = (s) => {
  if (!s) return null;
  const parts = s.split(":").map(Number);
  return Math.round(parts.reduce((a, b) => a * 60 + b, 0));
};
function timeRecord(text) {
  return {
    wallSeconds: seconds(text.match(/Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([\d:.]+)/)?.[1]),
    cpuSeconds: Math.round((num(text, /User time \(seconds\): ([\d.]+)/) ?? 0) + (num(text, /System time \(seconds\): ([\d.]+)/) ?? 0)),
    peakMB: Math.round((num(text, /Maximum resident set size \(kbytes\): (\d+)/) ?? 0) / 1024),
  };
}
function raRecord(pin, variant) {
  const meta = read(join(work, "out", `${pin}.${variant}.meta.txt`));
  if (!meta) return null;
  const field = (k) => meta.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1]?.trim() ?? "";
  return {
    exit: Number(field("exit")),
    ...timeRecord(meta),
    indexMB: Math.round(Number(field("scip-bytes")) / 1e5) / 10,
    downloadedCrates: Number(field("crate-archives")),
    downloadMB: Math.round((Number(field("crate-archive-bytes")) + Number(field("registry-index-bytes")) + Number(field("git-deps-bytes") || 0)) / 1e5) / 10,
    buildScriptsRun: Number(field("build-script-runs")),
    procMacroLibraries: Number(field("proc-macro-dylibs")),
    targetDirMB: Math.round(Number(field("target-bytes")) / 1e6),
    lockfileTracked: field("lockfile-tracked") === "1",
    worktreeChanged: Number(field("worktree-changes")) > 0,
  };
}
function pymRecord(pin) {
  const dir = existsSync(join(work, "pym", `${pin}-2.time.txt`)) ? `${pin}-2` : pin;
  let status = "";
  try {
    status = JSON.parse(read(join(work, "pym", `${dir}.index.json`))).status;
  } catch {}
  return { status, ...timeRecord(read(join(work, "pym", `${dir}.time.txt`))) };
}

const STRUCT = /structural:/;
function summarise(r) {
  let agree = 0, hard = 0, identity = 0, noAnswer = 0, collision = 0, notGraph = 0, generated = 0, definite = 0;
  for (const [key, n] of Object.entries(r.agreement)) {
    if (STRUCT.test(key)) continue;
    const verdict = key.split(" | ")[2];
    definite += n;
    if (verdict.startsWith("agree")) agree += n;
    else if (verdict.startsWith("disagree")) hard += n;
    else if (verdict.startsWith("unit-differs")) identity += n;
    else if (verdict === "no-answer") noAnswer += n;
    else if (verdict === "toolchain-symbol-collision") collision += n;
    else if (verdict === "toolchain-target-not-a-graph-symbol") notGraph += n;
    else if (verdict === "toolchain-generated-item") generated += n;
  }
  const classes = {};
  for (const [key, n] of Object.entries(r.toolchainNoAnswer)) {
    const c = key.startsWith("file-not-indexed") ? key : key.split(":")[0];
    classes[c] = (classes[c] ?? 0) + n;
  }
  const crossCount = (label) => Object.entries(r.cross).filter(([k]) => k.endsWith("| " + label)).reduce((a, [, n]) => a + n, 0);
  return {
    links: r.links,
    level2: r.level2.links,
    gainCheckout: r.withToolchain.gainCheckout,
    gainLibrary: r.withToolchain.gainLibrary,
    gainTraitDeclaration: r.withToolchain.gainThatIsTraitDeclaration,
    gainUnderNonTestCfg: r.withToolchain.gainUnderNonTestCfg,
    conservativeLinks: Math.round((r.withToolchain.percentWithoutTraitDeclarationsAndNonTestCfg * r.links) / 100),
    definiteCompared: definite,
    agree,
    hardDisagree: hard,
    reexportIdentity: identity,
    definiteNoAnswer: noAnswer,
    definiteCollision: collision,
    definiteTargetNotGraphSymbol: notGraph,
    definiteGenerated: generated,
    toolchainNoAnswer: classes,
    symbolCollisionLinks: crossCount("collision"),
    generatedItemLinks: crossCount("generated"),
    candidateSets: r.candidateSets,
    libraryIdentityShapes: r.libraryIdentityShapes,
    rangeCheck: { textMatches: r.rangeCheck.textMatches, textDiffers: r.rangeCheck.textDiffers },
  };
}
const pct = (a, b) => (b ? Math.round((10000 * a) / b) / 100 : null);
const rows = [];
for (const pin of pins) {
  const file = join(work, "out", `${pin}.default.join.json`);
  if (!existsSync(file)) {
    rows.push({ pin, missing: true, toolchain: raRecord(pin, "default"), pymtheg: pymRecord(pin) });
    continue;
  }
  const r = JSON.parse(readFileSync(file, "utf8"));
  rows.push({ pin, ...summarise(r), toolchain: raRecord(pin, "default"), pymtheg: pymRecord(pin) });
}
const done = rows.filter((r) => !r.missing);
const sum = (k) => done.reduce((a, r) => a + r[k], 0);
const total = {
  pins: done.length,
  links: sum("links"),
  level2: pct(sum("level2"), sum("links")),
  withToolchain: pct(sum("level2") + sum("gainCheckout") + sum("gainLibrary"), sum("links")),
  checkoutAnswersOnly: pct(sum("level2") + sum("gainCheckout"), sum("links")),
  conservative: pct(sum("conservativeLinks"), sum("links")),
  agreement: pct(sum("agree"), sum("agree") + sum("hardDisagree")),
  agreementCountingReexports: pct(sum("agree"), sum("agree") + sum("hardDisagree") + sum("reexportIdentity")),
  hardDisagree: sum("hardDisagree"),
  reexportIdentity: sum("reexportIdentity"),
};
const variants = {};
for (const [pin, variant] of [["axum", "nobuild"], ["axum", "allfeatures"], ["axum", "examples"], ["ripgrep", "rerun"], ["helix", "rerun"]]) {
  const meta = variant === "rerun" ? read(join(work, "out", `${pin}.rerun.stderr.txt`)) : null;
  variants[`${pin}.${variant}`] = meta !== null ? timeRecord(meta) : raRecord(pin, variant);
}
for (const v of ["allfeatures", "allfeatures-examples"]) {
  const f = join(work, "out", `axum.${v}.join.json`);
  if (existsSync(f)) {
    const r = JSON.parse(readFileSync(f, "utf8"));
    variants[`axum.${v}.coverage`] = { level2: r.level2.percent, withToolchain: r.withToolchain.percent, conservative: r.withToolchain.percentWithoutTraitDeclarationsAndNonTestCfg, disagreements: r.disagreementCount };
  }
}
writeFileSync(join(outDir, "results.json"), JSON.stringify({ total, rows, variants }, null, 1) + "\n");

const md = [
  "| Pin | Rust links | Level 2 now | + toolchain answers | checkout answers only | conservative | agreement (hard) | hard / re-export disagreements | RA wall s | RA CPU s | RA peak MB | index MB | crates downloaded (MB) | build scripts run | proc-macro libs | Pymtheg cold wall s | Pymtheg peak MB |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];
for (const r of rows) {
  const t = r.toolchain ?? {};
  const p = r.pymtheg ?? {};
  if (r.missing) {
    md.push(`| ${r.pin} | — | — | — | — | — | — | — | ${t.wallSeconds ?? "—"} | ${t.cpuSeconds ?? "—"} | ${t.peakMB ?? "—"} | ${t.indexMB ?? "—"} | ${t.downloadedCrates ?? "—"} (${t.downloadMB ?? "—"}) | ${t.buildScriptsRun ?? "—"} | ${t.procMacroLibraries ?? "—"} | ${p.wallSeconds ?? "—"} | ${p.peakMB ?? "—"} |`);
    continue;
  }
  md.push(
    `| ${r.pin} | ${r.links.toLocaleString("en")} | ${pct(r.level2, r.links)}% | ${pct(r.level2 + r.gainCheckout + r.gainLibrary, r.links)}% | ${pct(r.level2 + r.gainCheckout, r.links)}% | ${pct(r.conservativeLinks, r.links)}% | ${pct(r.agree, r.agree + r.hardDisagree)}% | ${r.hardDisagree} / ${r.reexportIdentity} | ${t.wallSeconds} | ${t.cpuSeconds} | ${t.peakMB} | ${t.indexMB} | ${t.downloadedCrates} (${t.downloadMB}) | ${t.buildScriptsRun} | ${t.procMacroLibraries} | ${p.wallSeconds} | ${p.peakMB} |`,
  );
}
md.push(
  `| **${total.pins} pins** | ${total.links.toLocaleString("en")} | **${total.level2}%** | **${total.withToolchain}%** | ${total.checkoutAnswersOnly}% | ${total.conservative}% | ${total.agreement}% | ${total.hardDisagree} / ${total.reexportIdentity} | | | | | | | | | |`,
);
writeFileSync(join(outDir, "table.md"), md.join("\n") + "\n");
console.log(JSON.stringify(total, null, 1));
