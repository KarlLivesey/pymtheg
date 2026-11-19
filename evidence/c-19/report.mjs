// SPDX-License-Identifier: MIT
// C-19: aggregate the per-pin joins and run records into results.json and a
// markdown table. Reads WORK/pins.txt, WORK/out/*.join.json, the
// rust-analyzer run records (WORK/out/*.meta.txt) and the Pymtheg index
// records (WORK/pym/*.time.txt, *.index.json).
//
// Agreement, over non-structural links Pymtheg calls definite where the
// strict join gives an answer to compare:
//   strict     same declaration verified on both sides (checkout: the same
//              graph symbol; library: both paths resolved to the same
//              definition, with or without the version compared) over the
//              comparisons where both sides name a declaration (same, or
//              verified / seen different); the unverified share (family and
//              name only, or unverified) is reported next to it
//   heuristic  same declaration or same crate family and final name, over
//              every comparison with an answer
// Usage: node report.mjs WORK OUT_DIR
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [work, outDir] = process.argv.slice(2);
const PYMDIR = process.env.PYMDIR ?? "pym"; // the folder under WORK holding the Pymtheg graphs
const pins = readFileSync(join(work, "pins.txt"), "utf8").trim().split("\n").map((l) => l.split(" ")[0]);
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const num = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};
const seconds = (s) => (s ? Math.round(s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0)) : null);
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
    exit: Number(meta.match(/^exit (\d+)/m)?.[1]),
    ...timeRecord(meta),
    indexMB: Math.round(Number(field("scip-bytes")) / 1e5) / 10,
    downloadedCrates: Number(field("crate-archives")),
    downloadMB: Math.round((Number(field("crate-archive-bytes")) + Number(field("registry-index-bytes")) + Number(field("git-deps-bytes") || 0)) / 1e5) / 10,
    buildScriptsRun: Number(field("build-script-runs")),
    procMacroLibraries: Number(field("proc-macro-dylibs")),
    targetDirMB: Math.round(Number(field("target-bytes")) / 1e6),
    duplicateSymbolMessages: Number(field("duplicate-symbol-messages")),
    duplicateSymbolFiles: Number(field("duplicate-symbol-files")),
    notInScipDocumentMessages: Number(field("not-in-scip-document-messages")),
    lockfileTracked: field("lockfile-tracked") === "1",
    worktreeChanged: Number(field("worktree-changes")) > 0,
  };
}
function pymRecord(pin) {
  if (existsSync(join(work, PYMDIR, `${pin}-2.index.json`))) pin = `${pin}-2`; // an earlier attempt failed
  let status = "";
  try {
    status = JSON.parse(read(join(work, PYMDIR, `${pin}.index.json`))).status;
  } catch {}
  return { status, ...timeRecord(read(join(work, PYMDIR, `${pin}.time.txt`))) };
}

function agreementOf(r) {
  const a = { same: 0, sameNoVersion: 0, heuristic: 0, differ: 0, unverified: 0, noAnswer: 0, filtered: 0, other: 0, byVerdict: {} };
  for (const [key, n] of Object.entries(r.agreement)) {
    const v = key.split(" | ")[2];
    a.byVerdict[v] = (a.byVerdict[v] ?? 0) + n;
    if (v === "agree-same-declaration" || v === "agree-module-by-name") a.same += n;
    else if (v === "agree-same-declaration-version-not-compared") a.sameNoVersion += n;
    else if (v === "heuristic-same-family-and-name") a.heuristic += n;
    else if (v.startsWith("disagree")) a.differ += n;
    else if (v.startsWith("unverified")) a.unverified += n;
    else if (v === "no-answer") a.noAnswer += n;
    else if (v.startsWith("filtered:")) a.filtered += n;
    else a.other += n;
  }
  return a;
}
const pct = (a, b) => (b ? Math.round((10000 * a) / b) / 100 : null);
const rows = [];
for (const pin of pins) {
  const file = join(work, "out", `${pin}.default.join.json`);
  const base = { pin, toolchain: raRecord(pin, "default"), pymtheg: pymRecord(pin) };
  if (!existsSync(file)) {
    rows.push({ ...base, missing: true });
    continue;
  }
  const r = JSON.parse(readFileSync(file, "utf8"));
  rows.push({
    ...base,
    links: r.links,
    level2: r.level2.links,
    loose: r.loose,
    strict: r.strict,
    strictRemovedFromLooseGain: r.strictRemovedFromLooseGain,
    agreement: agreementOf(r),
    candidateSets: r.candidateSets,
    toolchainNoAnswer: r.toolchainNoAnswer,
    symbolsDefinedMoreThanOnce: r.scip.symbolsDefinedMoreThanOnce,
    libraryIdentityShapes: r.libraryIdentityShapes,
    libraryVerification: r.libraryVerification,
    rangeCheck: r.rangeCheck,
  });
}
const done = rows.filter((r) => !r.missing);
const sum = (f) => done.reduce((a, r) => a + f(r), 0);
const L = sum((r) => r.links);
const l2 = sum((r) => r.level2);
const cov = (k) => ({
  withToolchain: pct(l2 + sum((r) => r[k].gainCheckout + r[k].gainLibrary), L),
  checkoutOnly: pct(l2 + sum((r) => r[k].gainCheckout), L),
  libraryOnly: pct(l2 + sum((r) => r[k].gainLibrary), L),
  withoutTraitDeclarations: pct(l2 + sum((r) => r[k].gainCheckout + r[k].gainLibrary - r[k].gainTraitDeclaration), L),
  gated: pct(sum((r) => r[k].gatedLinks), L),
  gainCheckout: sum((r) => r[k].gainCheckout),
  gainLibrary: sum((r) => r[k].gainLibrary),
  gainTraitDeclaration: sum((r) => r[k].gainTraitDeclaration),
  gainUnderNonTestCfg: sum((r) => r[k].gainUnderNonTestCfg),
});
const ag = (k) => sum((r) => r.agreement[k]);
const removed = {};
for (const r of done) for (const [k, n] of Object.entries(r.strictRemovedFromLooseGain)) removed[k] = (removed[k] ?? 0) + n;
const total = {
  pins: done.length,
  links: L,
  level2: pct(l2, L),
  loose: cov("loose"),
  strict: cov("strict"),
  strictRemovedFromLooseGain: Object.fromEntries(Object.entries(removed).sort((a, b) => b[1] - a[1])),
  agreement: {
    sameDeclaration: ag("same"),
    sameDeclarationVersionNotCompared: ag("sameNoVersion"),
    differ: ag("differ"),
    sameFamilyAndNameOnly: ag("heuristic"),
    unverified: ag("unverified"),
    strict: pct(ag("same") + ag("sameNoVersion"), ag("same") + ag("sameNoVersion") + ag("differ")),
    unverifiedShare: pct(ag("heuristic") + ag("unverified"), ag("same") + ag("sameNoVersion") + ag("differ") + ag("heuristic") + ag("unverified")),
    heuristic: pct(ag("same") + ag("sameNoVersion") + ag("heuristic"), ag("same") + ag("sameNoVersion") + ag("heuristic") + ag("differ") + ag("unverified")),
  },
};
const variants = {};
for (const [pin, variant] of [["axum", "nobuild"], ["axum", "notest"], ["axum", "allfeatures"], ["axum", "examples"]]) variants[`${pin}.${variant}`] = raRecord(pin, variant);
for (const pin of ["ripgrep", "helix"]) variants[`${pin}.rerun`] = timeRecord(read(join(work, "out", `${pin}.rerun.stderr.txt`)));
for (const v of ["axum.allfeatures", "axum.allfeatures-examples", "ripgrep.offline"]) {
  const f = join(work, "out", `${v}.join.json`);
  if (existsSync(f)) {
    const r = JSON.parse(readFileSync(f, "utf8"));
    variants[`${v}.coverage`] = { level2: r.level2.percent, looseWithToolchain: r.loose.percent, looseGated: r.loose.gated, strictWithToolchain: r.strict.percent, strictGated: r.strict.gated };
  }
}
writeFileSync(join(outDir, "results.json"), JSON.stringify({ total, rows, variants }, null, 1) + "\n");

const pc = (a, b) => `${pct(a, b)}%`;
const md = [
  "| Pin | Rust links | Level 2 now | + toolchain, loose (first run) | + toolchain, strict | gated, loose | gated, strict | same declaration verified on both sides (unverified share) | same / same, version not compared / different / family+name only / unverified | RA wall s | RA CPU s | RA peak MB | index MB | crates (MB) | build scripts | proc-macro libs | duplicate-symbol messages (files) / symbols defined twice | Pymtheg cold wall s | Pymtheg peak MB |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |",
];
for (const r of done) {
  const t = r.toolchain ?? {};
  const p = r.pymtheg ?? {};
  const a = r.agreement;
  md.push(
    `| ${r.pin} | ${r.links.toLocaleString("en")} | ${pc(r.level2, r.links)} | ${r.loose.percent}% | ${r.strict.percent}% | ${r.loose.gated}% | ${r.strict.gated}% | ${pct(a.same + a.sameNoVersion, a.same + a.sameNoVersion + a.differ)}% (${pct(a.heuristic + a.unverified, a.same + a.sameNoVersion + a.differ + a.heuristic + a.unverified)}%) | ${a.same.toLocaleString("en")} / ${a.sameNoVersion.toLocaleString("en")} / ${a.differ} / ${a.heuristic.toLocaleString("en")} / ${a.unverified.toLocaleString("en")} | ${t.wallSeconds} | ${t.cpuSeconds} | ${t.peakMB} | ${t.indexMB} | ${t.downloadedCrates} (${t.downloadMB}) | ${t.buildScriptsRun} | ${t.procMacroLibraries} | ${t.duplicateSymbolMessages} (${t.duplicateSymbolFiles}) / ${r.symbolsDefinedMoreThanOnce} | ${p.wallSeconds} | ${p.peakMB} |`,
  );
}
md.push(
  `| **${total.pins} pins** | ${L.toLocaleString("en")} | **${total.level2}%** | ${total.loose.withToolchain}% | **${total.strict.withToolchain}%** | ${total.loose.gated}% | **${total.strict.gated}%** | **${total.agreement.strict}%** (${total.agreement.unverifiedShare}%) | ${total.agreement.sameDeclaration.toLocaleString("en")} / ${total.agreement.sameDeclarationVersionNotCompared.toLocaleString("en")} / ${total.agreement.differ} / ${total.agreement.sameFamilyAndNameOnly.toLocaleString("en")} / ${total.agreement.unverified.toLocaleString("en")} | | | | | | | | | | |`,
);
for (const r of rows.filter((x) => x.missing)) md.push(`| ${r.pin} | missing | | | | | | | | | | | | | | | | | |`);
writeFileSync(join(outDir, "table.md"), md.join("\n") + "\n");
console.log(JSON.stringify(total, null, 1));
