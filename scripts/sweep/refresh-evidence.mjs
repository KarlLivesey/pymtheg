// SPDX-License-Identifier: MIT
import "../isolated-home.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { combineLabels, draw, firstBlocker, modeNames, overlayInstalled, readLabels, sampleSize, schema, seed, verifyModes } from "./coverage-refresh-data.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  commit: { type: "string" }, labels: { type: "string" }, output: { type: "string" }, base: { type: "string" },
  module: { type: "string" }, from: { type: "string", default: "1" }, limit: { type: "string", default: "150" },
} });
const [action] = positionals;
const scratch = process.env.PYM_SCRATCH;
if (!scratch) throw Error("Set PYM_SCRATCH to the sweep directory on disk");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const runPath = (mode) => join(scratch, `${mode}-run.json`);
const exportPath = (mode) => join(scratch, `${mode}-export.json`);

if (action === "export") {
  for (const mode of modeNames.filter((mode) => existsSync(runPath(mode)))) {
    const result = spawnSync(process.execPath, ["scripts/sweep/coverage-export.mjs", "--refresh",
      "--results", runPath(mode), "--output", exportPath(mode)], { stdio: "inherit" });
    if (result.error || result.status !== 0) throw result.error ?? Error(`Export ${mode} exited ${result.status ?? result.signal}`);
  }
} else if (action === "draw" || action === "context") {
  const rows = draw(read(exportPath("bare")).repos).filter((row) => !values.module || row.module === values.module);
  const from = Number(values.from) - 1;
  const selected = rows.slice(from, from + Number(values.limit));
  if (action === "draw") {
    for (const [index, row] of selected.entries()) {
      const { rank, repo, file, line, column, kind, target, code, reasons, outcome, unit } = row;
      console.log([from + index + 1, rank, `${repo}/${file}:${line}:${column}`, kind, target,
        firstBlocker(reasons, outcome), unit ?? "", code].join("\t"));
    }
  } else {
    const attempts = new Map(read(runPath("bare")).repos.map(({ id, attempt }) => [id, attempt]));
    for (const [index, row] of selected.entries()) {
      const lines = readFileSync(join(scratch, attempts.get(row.repo), "checkout", row.file), "utf8").split("\n");
      const start = Math.max(0, row.line - 9);
      console.log(`\n${from + index + 1}. ${row.repo}/${row.file}:${row.line}:${row.column} ${row.kind} ${row.target}`);
      if (row.candidates?.length) console.log(`Checkout candidates: ${row.candidates.map(({ file, name }) => `${file} ${name}`).join(", ")}`);
      if (row.libraryCandidates?.length) console.log(`Library candidates: ${row.libraryCandidates.map(({ unit, symbol }) => [unit, symbol].filter(Boolean).join(" ")).join(", ")}`);
      for (const [offset, line] of lines.slice(start, row.line + 5).entries()) {
        const column = start + offset + 1 === row.line ? row.column - 1 : 0;
        console.log(`${start + offset + 1} ${line.slice(Math.max(0, column - 100), column + 220)}`);
      }
    }
  }
} else if (action === "assemble") {
  if (!/^[a-f0-9]{40}$/.test(values.commit ?? "") || !values.labels || !values.output) {
    throw Error("assemble needs --commit SHA --labels FILE --output FILE");
  }
  const modes = Object.fromEntries(modeNames.map((mode) => [mode, read(exportPath(mode))]));
  verifyModes(modes, read("sweep/repos.json"));
  const samples = combineLabels(draw(modes.bare.repos), readLabels(readFileSync(values.labels, "utf8")));
  for (const { repos } of Object.values(modes)) for (const repo of repos) delete repo.shortlist;
  const data = { schema, measuredCommit: values.commit, seed, sampleSize, modes, samples };
  writeFileSync(values.output, gzipSync(`${JSON.stringify(data)}\n`, { level: 9 }));
} else if (action === "overlay-installed") {
  if (!values.base || !values.output) throw Error("overlay-installed needs --base ARCHIVE --commit SHA --output FILE");
  const data = JSON.parse(gunzipSync(readFileSync(values.base)));
  if (data.schema !== schema) throw Error("Expected a refresh archive");
  data.modes = overlayInstalled(data.modes, read(exportPath("installed")), values.commit);
  verifyModes(data.modes, read("sweep/repos.json"));
  writeFileSync(values.output, gzipSync(`${JSON.stringify(data)}\n`, { level: 9 }));
} else {
  throw Error("Use export, draw, context, assemble or overlay-installed");
}
