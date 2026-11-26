// SPDX-License-Identifier: MIT
import { libraryModuleLinks, modules } from "./coverage-rules.mjs";
import { auditRange, baselineScore, compare, firstBlocker, itemRange, missGroups, pairedRepos, sampleSize, schema, score, seed, verifyModes, verifyReview } from "./coverage-refresh-data.mjs";

const languageNames = { go: "Go", rust: "Rust", typescript: "TypeScript / JavaScript" };
const number = (n) => n.toLocaleString("en-US");
const percent = (n) => n.toFixed(2) + "%";
const rate = ({ links, level2 }) => links ? percent(100 * level2 / links) : "—";
const gap = ({ links, level2 }) => number(Math.max(0, Math.ceil(9 * links / 10) - level2));
const inline = (value) => {
  const text = String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const ticks = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((part) => part.length)) + 1);
  return `${ticks} ${text} ${ticks}`;
};
const sampleText = ({ repo, file, line, code }) => `${repo} ${inline(`${file}:${line}`)} ${inline(code || "(empty source line)")}`;

function selectedModes(modes) {
  const bare = modes.bare.repos;
  const installed = modes.installed.repos;
  const go = modes["go-toolchain"].repos;
  // C-43: the opt-in Rust route, when the sweep measured it.
  const rust = modes["rust-toolchain"]?.repos ?? [];
  const used = (repos) => repos.filter((repo) => repo.counts && repo.toolchain?.state === "used");
  return { bare, installed, go, rust, pairedInstalled: pairedRepos(bare, installed, "installed"),
    pairedGo: pairedRepos(bare, go, "go-toolchain"), goUsed: used(go),
    pairedRust: pairedRepos(bare, rust, "rust-toolchain"), rustUsed: used(rust) };
}

export function scoreTable(modes, base, own = false) {
  const { bare, pairedInstalled, pairedGo, goUsed, pairedRust, rustUsed } = selectedModes(modes);
  const render = (module, mode, repos) => {
    const now = score(repos, module, own);
    const then = baselineScore(base.repos, module, own);
    const proven = { ...now, level2: now.level2 - now.assumed };
    const assumed = { ...now, level2: now.assumed };
    // D20: library module links count at Level 2, shown as their own part.
    const unit = { ...now, level2: libraryModuleLinks(repos, module, own) };
    const withModules = { ...now, level2: now.level2 + unit.level2 };
    const split = now.assumed ? `<br>${number(proven.level2)} proven (${rate(proven)})<br>${number(assumed.level2)} assumption-marked (${rate(assumed)})` : "";
    const moduleCell = unit.level2 ? `<br>${number(unit.level2)} library module links (${rate(unit)})<br>**${number(withModules.level2)} (${rate(withModules)}) with library module links**` : "";
    const gapCell = unit.level2 ? `${gap(now)}<br>${gap(withModules)} with library module links` : gap(now);
    // D17 clarified: with a toolchain route, Level 2 counting only the
    // route-decided links labelled none-seen (exports that count the label).
    const noneSeen = { ...now, level2: now.level2 - (now.seen ?? 0) };
    const labelCell = now.seen !== undefined && mode !== "Source only" && mode !== "Bare"
      ? `<br>${number(noneSeen.level2)} (${rate(noneSeen)}) counting only none-seen route answers` : "";
    return `| ${languageNames[module]} | ${mode} | ${number(now.links)} | ${number(now.level2)} (${rate(now)})${split}${labelCell}${moduleCell} | ${number(then.level2)} / ${number(then.links)} (${rate(then)}) | ${gapCell} |`;
  };
  return [
    "| Language | Mode | Links now | Level 2 now | Level 2 at 0.1.0 | Links to 90% |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    render("go", "Bare", bare),
    goUsed.length ? render("go", "Opt-in offline toolchain", pairedGo) : "| Go | Opt-in offline toolchain | — | not measured in this sweep | — | — |",
    render("rust", "Source only", bare),
    // C-43: shown once a sweep has the opt-in Rust mode; earlier sweeps did not run it.
    ...(modes["rust-toolchain"] ? [rustUsed.length ? render("rust", "Opt-in offline toolchain", pairedRust) : "| Rust | Opt-in offline toolchain | — | not measured in this sweep | — | — |"] : []),
    render("typescript", "Bare", bare),
    render("typescript", "Installed declarations", pairedInstalled),
  ].join("\n");
}

function itemFor(module, reason, catalog) {
  const defined = catalog.items.find((item) => item.module === module && item.reason === reason);
  if (defined) return defined;
  const id = `${module === "typescript" ? "ts" : module}-${reason.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return { id, title: `Review ${reason.replaceAll("-", " ")}`, status: "Needs diagnosis" };
}

function share([lower, upper]) {
  if (Math.abs(upper - lower) < 0.0000001) return percent(100 * lower);
  return `${percent(100 * lower)}–${percent(100 * upper)}`;
}

function ceilingRange(blocked, totals) {
  const missRate = (totals.links - totals.level2) / totals.links;
  return share(blocked.interval.toReversed().map((n) => 1 - n * missRate));
}

function ceiling(groups, samples, totals, module) {
  const impossible = auditRange(groups, samples, ["none"]);
  const outside = auditRange(groups, samples, ["outside"]);
  const blocked = auditRange(groups, samples, ["none", "outside"]);
  const unknown = samples.filter(({ staticAnswer }) => staticAnswer === "unknown").length;
  const summary = `Bare ceiling estimate **${ceilingRange(blocked, totals)}**. Of missing links, ${share(impossible.observed)} have no static answer (95% bounds ${share(impossible.interval)}) and ${share(outside.observed)} need material outside the checkout (95% bounds ${share(outside.interval)}). The review could not classify ${unknown} of ${samples.length} sampled links for the ceiling.`;
  if (module !== "rust") return summary;
  const reclassified = samples.map((row) => row.standardLibrary ? { ...row, staticAnswer: "outside" } : row);
  const alternate = auditRange(groups, reclassified, ["none", "outside"]);
  return `${summary} Counting every standard-library and prelude target as outside lowers the Rust ceiling estimate to **${ceilingRange(alternate, totals)}**.`;
}

function itemTable(groups, samples, module, totals, catalog, alternateGroups) {
  const content = ["| Support item | First stored reason | Links | Pins | Link kinds | Sample | Estimated points | Status | Examples |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- |"];
  const paired = new Map(alternateGroups.map((group) => [group.reason, group]));
  const hasAlternate = module !== "rust";
  for (const group of [...groups, ...alternateGroups.filter(({ reason }) => !groups.some((group) => group.reason === reason))]) {
    const bare = groups.includes(group);
    const { reason, count, pins, kinds, examples } = group;
    const item = itemFor(module, reason, catalog);
    const draw = samples.filter((row) => firstBlocker(row.reasons, row.outcome) === reason);
    const [lower, upper] = bare ? itemRange(count, draw) : [0, 0];
    const high = 100 * upper / totals.links;
    const precision = high > 0 && high < 0.01 ? 4 : 2;
    const points = bare ? `${(100 * lower / totals.links).toFixed(precision)}–${high.toFixed(precision)} pp${draw.length ? "" : "*"}` : "—";
    const kindText = [...kinds].sort(([a, n], [b, m]) => m - n || compare(a, b))
      .map(([kind]) => kind).join(", ");
    const alternate = paired.get(reason);
    const sites = [...examples].sort((a, b) => compare(a.rank, b.rank)).slice(0, 2);
    if (sites.length === 1) {
      const first = sites[0];
      const second = alternate?.examples.find((site) => site.repo !== first.repo || site.file !== first.file || site.line !== first.line);
      if (second) sites.push(second);
    }
    const evidence = sites.length === 1 ? `${sampleText(sites[0])}<br>Only one source line` : sites.map(sampleText).join("<br>");
    const countCell = hasAlternate ? `${number(bare ? count : 0)} / ${number(alternate?.count ?? 0)}` : number(count);
    const pinCell = hasAlternate ? `${number(bare ? pins.size : 0)} / ${number(alternate?.pins.size ?? 0)}` : number(pins.size);
    content.push(`| ${item.title} ${inline(item.id)} | ${inline(reason)} | ${countCell} | ${pinCell} | ${kindText} | ${draw.length} | ${points} | ${item.status} | ${evidence} |`);
  }
  return content.join("\n");
}

export function catalogChanges(modes, catalog, legacy) {
  const { bare, pairedInstalled, pairedGo } = selectedModes(modes);
  const active = modules.flatMap((module) => {
    const reasons = new Set(missGroups(bare, module).map(({ reason }) => reason));
    const other = module === "go" ? pairedGo : module === "typescript" ? pairedInstalled : [];
    for (const { reason } of missGroups(other, module)) reasons.add(reason);
    return [...reasons].map((reason) => ({ ...itemFor(module, reason, catalog), module, reason }));
  });
  const old = new Set(legacy.items.map(({ id }) => id));
  return {
    added: active.filter(({ id }) => !old.has(id)).sort((a, b) => compare(a.id, b.id)),
    retained: active.filter(({ id }) => old.has(id)).map(({ id }) => id).sort(compare),
    retired: legacy.items.filter(({ id }) => !active.some((item) => item.id === id)).map(({ id }) => ({ id,
      note: catalog.retired?.[id] ?? "Replaced by the stored-reason groups. This source-audit category had no equivalent stored reason." })),
  };
}

export function runTables(modes) {
  const { bare, pairedInstalled, pairedGo, pairedRust } = selectedModes(modes);
  const bareById = new Map(bare.map((repo) => [repo.id, repo]));
  const picked = { bare: bareById, installed: new Map(pairedInstalled.map((repo) => [repo.id, repo])),
    "go-toolchain": new Map(pairedGo.map((repo) => [repo.id, repo])),
    "rust-toolchain": new Map(pairedRust.map((repo) => [repo.id, repo])) };
  return ["# Sweep attempts", "", "Peak is the largest recorded resident-memory peak across the attempt's stages. Wall covers checkout, setup, both indexes and queries. Cold columns cover the first index. Level 2 uses the pin language and marks every score carried forward from bare mode.",
    ...Object.entries(modes).flatMap(([mode, { repos }]) => ["", `## ${mode}`, "",
      "| Pin | Outcome | Level 2 | Wall (s) | Peak (MiB) | Cold (s) | Cold peak (MiB) | Detail |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...repos.map(({ id, language, outcome, wallSeconds, peakRssKiB, cold, failure, install, toolchain, failedFiles, failedModules, indexErrors, compilerAssertion, invalidUtf16Files, measuredCommit }) => {
        const stage = failure?.stage;
        const selected = picked[mode].get(id);
        const languageCount = selected?.counts?.[language];
        const fallback = mode !== "bare" && selected === bareById.get(id) && selected?.counts;
        const level2 = `${languageCount ? rate(languageCount) : "—"}${fallback ? " (bare)" : ""}`;
        const modules = Object.entries(failedModules ?? {}).filter(([, count]) => count)
          .map(([module, count]) => `${number(count)} ${languageNames[module]}`).join(", ");
        const detail = [install && [install.manager, install.version, install.status, install.reason].filter(Boolean).join(" "),
          measuredCommit && `measured at ${inline(measuredCommit)}`,
          stage && [stage, failure.exit != null && `exit ${failure.exit}`, failure.progress, failure.memory].filter(Boolean).join(" · "),
          toolchain && [toolchain.state, toolchain.reason, toolchain.packages && `${toolchain.packages.clean}/${toolchain.packages.total} clean packages`,
            toolchain.upgradedLinks !== undefined && toolchain.packages === undefined && `${number(toolchain.upgradedLinks)} links upgraded`].filter(Boolean).join(" · "),
          indexErrors?.analysisErrors && `${indexErrors.analysisErrors} analysis error${indexErrors.analysisErrors === 1 ? "" : "s"}`,
          compilerAssertion && `TypeScript compiler assertion (${compilerAssertion})`,
          invalidUtf16Files && `${number(invalidUtf16Files)} files marked failed due to an invalid UTF-16 range`,
          indexErrors?.resolutionErrors && `${indexErrors.resolutionErrors} resolution error${indexErrors.resolutionErrors === 1 ? "" : "s"}`,
          outcome === "finished" && `${cold.status}, ${number(failedFiles)} failed files${modules ? ` (${modules})` : ""}`].filter(Boolean).join(" · ") || "—";
        const seconds = (value) => value != null ? value.toFixed(1) : "—";
        const memory = (value) => value ? (value / 1024).toFixed(1) : "—";
        return `| ${id} | ${outcome} | ${level2} | ${seconds(wallSeconds)} | ${memory(peakRssKiB)} | ${seconds(cold?.wallSeconds ?? (stage === "cold" ? failure.wallSeconds : null))} | ${memory(cold?.peakRssKiB ?? (stage === "cold" ? failure.peakRssKiB : null))} | ${detail} |`;
      }),
    ]), ""].join("\n");
}

export function renderPlan(input, base, pins, catalog, legacy, archiveName) {
  if (input.schema !== schema || !/^[a-f0-9]{40}$/.test(input.measuredCommit) || input.seed !== seed || input.sampleSize !== sampleSize) {
    throw Error("Invalid refresh archive");
  }
  verifyModes(input.modes, pins);
  const baselinePins = new Map(base.repos.map((repo) => [repo.id, repo]));
  if (base.release?.package !== "pymtheg@0.1.0" || !base.release.integrity || baselinePins.size !== pins.length ||
      pins.some(({ id, commit, language }) => baselinePins.get(id)?.commit !== commit || baselinePins.get(id)?.language !== language)) {
    throw Error("Expected the published 0.1.0 breakdown for the same pins");
  }
  const { bare, installed, go, rust, pairedInstalled, pairedGo, goUsed, rustUsed } = selectedModes(input.modes);
  const { samples } = input;
  verifyReview(bare, samples);
  const finished = bare.filter(({ counts }) => counts).length;
  const installedUsable = installed.filter((repo) => repo.counts && repo.install?.status === "installed").length;
  const installedFallback = installed.filter((repo) => !repo.counts || repo.install?.status !== "installed")
    .map(({ id, install, outcome, failure }) => `${id} (${install?.reason ?? `${outcome}${failure?.stage ? ` at ${failure.stage}` : ""}`})`);
  const installedWithoutTypeScript = installed.filter((repo) => repo.install?.status === "installed" &&
    repo.counts?.typescript.links === 0 && repo.failedModules?.typescript)
    .map((repo) => `${repo.id} (${number(repo.failedModules.typescript)} failed files)`);
  const replays = Map.groupBy(installed.filter(({ measuredCommit }) => measuredCommit), ({ measuredCommit }) => measuredCommit);
  const replayNotes = [...replays].map(([commit, rows]) =>
    `Installed attempts for ${rows.map(({ id }) => id).join(", ")} were measured later at ${inline(commit)}. The installed totals use these attempts where usable and keep the original measurements for the other pins.`);
  const archive = archiveName ?? (replays.size ? "sw-5" : "sw-4");
  const changes = catalogChanges(input.modes, catalog, legacy);
  const typescriptPins = bare.filter(({ language }) => language === "typescript");
  const allFailed = typescriptPins.filter((repo) => repo.counts?.typescript.links === 0 && repo.failedModules?.typescript);
  const failedPins = allFailed.map((repo) => `${repo.id} (${number(repo.failedModules.typescript)} files)`).join(" and ");
  const scoringPins = pairedInstalled.filter((repo) => repo.language === "typescript" && repo.counts?.typescript.links > 0).length;
  const zeroTypeScriptNote = allFailed.length ? [replays.size
    ? `${failedPins} contribute zero TypeScript links to the original bare measurement. The installed-declarations score uses observed TypeScript links from ${scoringPins} of ${typescriptPins.length} TypeScript pins.`
    : `${failedPins} finished their bare attempts, but every TypeScript or JavaScript file failed, so they contribute zero TypeScript links and the own-pin scores cover ${scoringPins} of ${typescriptPins.length} TypeScript pins.`] : [];
  const taint = bare.flatMap(({ inventory }) => inventory ?? []).filter(([module, , , reasons]) =>
    module === "rust" && reasons.includes("failed-file-unseen-declarations")).reduce((sum, row) => sum + row[4], 0);
  const missed = bare.filter(({ counts }) => !counts).map(({ id, outcome, failure }) => `${id} (${outcome}${failure?.stage ? ` at ${failure.stage}` : ""})`);
  return [
    "# Coverage plan for 0.2.0", "", scoreTable(input.modes, base), "",
    ...zeroTypeScriptNote, "",
    "Each stored link counts under its source language in a finished graph, so Go files in a TypeScript pin count under Go and JavaScript counts with TypeScript.",
    "Level 2 credits a resolved checkout target or a library unit with a named symbol. The gap is the number of additional Level 2 links required at the current link count.",
    "Under D20, a link whose referent is a library module or package (an import of the module) is complete when it names the library unit. These library module links count at Level 2 and are shown as a separate part. Each figure is given with and without them. A member link that names only the package stays below Level 2.", "",
    `Measured main commit ${inline(input.measuredCommit)}. Each 0.1.0 entry uses the release's finished bare graphs. The earlier exporter inferred named library targets from the stored facts where it could.`,
    ...replayNotes,
    `[Current sweep and source audit](../evidence/${archive}/coverage-plan-input.json.gz) · [0.1.0 breakdown](../evidence/sw-3/breakdown.json.gz)`, "",
    "## Coverage within each language's own pins", "", scoreTable(input.modes, base, true), "",
    "[C-19, experimental Rust toolchain coverage measurement](changes/C-19.md), measured a possible route that Pymtheg has yet to implement.", "",
    "## Pin completion", "",
    `**${finished}/${bare.length} bare pins finished.** ${missed.length ? `Unfinished attempts were ${missed.join(", ")}.` : "All bare graphs contribute to the totals."}`,
    ...(replays.size ? [] : zeroTypeScriptNote),
    replays.size
      ? `${installedUsable}/${installed.length} TypeScript pins completed the installed graph and sweep queries with lifecycle scripts disabled. Each unusable installed attempt contributes its bare graph when available.`
      : `TypeScript dependencies installed and indexed on ${installedUsable}/${installed.length} pins with lifecycle scripts disabled. Each unusable installed attempt contributes its bare graph when available.`,
    ...(installedFallback.length ? [`Installed-mode fallbacks include ${installedFallback.join(", ")}.`] : []),
    ...(installedWithoutTypeScript.length ? [`Installed graphs with zero TypeScript links after analysis failed include ${installedWithoutTypeScript.join(", ")}.`] : []),
    `The offline Go toolchain provided facts on ${goUsed.length}/${go.length} Go pins. Go links in other languages' pins use the bare graph.${goUsed.length < go.length ? " Go pins with unusable opt-in attempts also use the bare graph." : ""}`,
    ...(rust.length ? [`The offline Rust toolchain (rust-analyzer) answered on ${rustUsed.length}/${rust.length} Rust pins. Rust links in other languages' pins, and Rust pins whose attempt was unavailable or partial, use the source-only graph.`] : []),
    `[Per-pin outcomes, fallback details, time and memory](../evidence/${archive}/${replays.size ? "README.md" : "attempts.md"})`, "",
    "## Support items", "",
    "Each missing link belongs to its first stored blocker. Read the direct reason first, then the ordered reasons for an open candidate set, then uncertainty and the reason saved before a configuration override. Split semicolon lists left to right and keep the first occurrence. A link without a reason is grouped by its outcome.",
    "Counts and pin totals are exact. Link kinds and examples use the bare group when available. An alternate group can supply another example when the bare group has one source line. The archive retains every combination and count, including secondary reasons.",
    `The audit draws ${sampleSize} bare links per language. Estimated points show how much Level 2 could rise if the item gave a definite answer at those links. Ranges include source-review uncertainty. An asterisk marks the full possible range for a group with no sampled link.`,
    "The audit counts a target as reachable from a bare checkout when checked-in source and shipped standard-library data establish its owner and name, including third-party targets whose library unit and symbol the source spells out.",
    "[Sampling and uncertainty](../evidence/sw-4/README.md)", "",
    ...modules.flatMap((module) => {
      const groups = missGroups(bare, module);
      const review = samples.filter((row) => row.module === module);
      const totals = score(bare, module);
      const alternate = module === "go" ? pairedGo : module === "typescript" ? pairedInstalled : [];
      return [`### ${languageNames[module]}`, "", ceiling(groups, review, totals, module), "",
        ...(module === "go" ? ["Counts are bare / opt-in offline Go toolchain.", "",
          "The protobuf reflection call `largeMessageDesc.Fields().ByName(\"f34\")` records both `external-implementers-possible` and `structural-match-unverified`. Its count goes under the first reason. [Pinned Go source](https://github.com/protocolbuffers/protobuf-go/blob/ef99f06f37ec921e64fdbcec131a82013f38776e/internal/reflection_test/reflection_test.go#L100)", ""]
          : module === "typescript" ? ["Counts are bare / installed declarations.",
            ...(replays.size ? ["The bare inventory and ceiling use SW-4. The installed inventory includes the later attempts listed beside the scoreboard."] : []), ""] : []),
        itemTable(groups, review, module, totals, catalog, missGroups(alternate, module)), ""];
    }),
    "## Changes to the item list", "",
    `The Rust failed-file reason appears on ${number(taint)} links below Level 2. The old 13.04-point estimate came from an overbroad diagnostic. The reason was corrected and grammar fixes removed the remaining reported misses in the affected pins. [Failed-file diagnosis](changes/C-15.md) · [Rust grammar recovery](changes/C-21.md)`, "",
    `The fresh inventory adds ${changes.added.length} reason groups and reuses ${changes.retained.length} previous item IDs. [Added and retired items](../evidence/sw-4/items.md)`, "",
  ].join("\n");
}

export function renderChanges(changes) {
  return ["# Support item changes", "", "## Added", "",
    "| Item | Stored reason |", "| --- | --- |",
    ...changes.added.map(({ id, title, reason }) => `| ${inline(id)} ${title} | ${inline(reason)} |`),
    "", "## Reused", "", changes.retained.map(inline).join(", "), "", "## Retired", "",
    "| Previous item | Reason for retirement |", "| --- | --- |",
    ...changes.retired.map(({ id, note }) => `| ${inline(id)} | ${note} |`), "",
  ].join("\n");
}
