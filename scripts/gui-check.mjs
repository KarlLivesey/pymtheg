// SPDX-License-Identifier: MIT
import { browserExecutable } from "../test/browser-launch.mjs";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { resolve, basename, join } from "node:path";
import { createHash } from "node:crypto";
const helper =
  process.env.PYM_HEADLESS_HELPER ?? "/home/user/.local/bin/pc-tools";
if (!existsSync(helper)) {
  console.error(
    "GUI checks require the configured bounded headless helper. See docs/studio.md.",
  );
  process.exit(2);
}
const engine = process.env.PYM_TEST_ENGINE ?? "chromium";
const configuredBrowser = browserExecutable(engine);
const files = [
  "test/studio.browser.mjs",
  "test/studio-entry-switch.browser.mjs",
  "test/studio-entry-dirty-switch.browser.mjs",
  "test/studio-cross-browser.browser.mjs",
  "test/studio-authoring.browser.mjs",
  "test/studio-understanding.browser.mjs",
  "test/studio-a11y.browser.mjs",
  "test/studio-scenario.browser.mjs",
  "test/studio-recovery.browser.mjs",
  "test/studio-investigate.browser.mjs",
  "test/studio-first-use.browser.mjs",
  "test/studio-block-editor.browser.mjs",
  "test/studio-block-recovery.browser.mjs",
  "test/studio-block-outcomes.browser.mjs",
  "test/studio-block-resources.browser.mjs",
  "test/studio-block-data-events.browser.mjs",
  "test/studio-block-input-help.browser.mjs",
  "test/studio-block-focus.browser.mjs",
  "test/studio-declaration-authoring.browser.mjs",
  "test/studio-operation-rules.browser.mjs",
  "test/studio-operation-edit.browser.mjs",
  "test/studio-component-contract.browser.mjs",
  "test/studio-declaration-recovery.browser.mjs",
  "test/studio-declaration-stale.browser.mjs",
  "test/studio-declaration-imports.browser.mjs",
  "test/studio-machine-authoring.browser.mjs",
  "test/studio-domain-error.browser.mjs",
  "test/studio-unused-scope.browser.mjs",
  "test/studio-state-range.browser.mjs",
  "test/studio-resource-edit.browser.mjs",
  "test/studio-resource-edit-recovery.browser.mjs",
  "test/studio-resource-merge.browser.mjs",
  "test/studio-implementation-link-draft.browser.mjs",
  "test/studio-type-authoring.browser.mjs",
  "test/studio-type-choices.browser.mjs",
  "test/studio-implementation-graph.browser.mjs",
  "test/studio-simultaneous-gaps.browser.mjs",
  "test/studio-save-basics.browser.mjs",
  "test/studio-two-tabs.browser.mjs",
  "test/studio-recovery-ownership.browser.mjs",
  "test/studio-preview-focus.browser.mjs",
  "test/studio-virtual-reader.browser.mjs",
  "test/studio-header-layout.browser.mjs",
  "test/studio-version-search.browser.mjs",
  "test/studio-implementation-review.browser.mjs",
  "test/studio-implementation-design-drift.browser.mjs",
  "test/studio-code-file-picker.browser.mjs",
  "test/studio-initialized-project.browser.mjs",
  "test/studio-project-setup.browser.mjs",
  "test/studio-document-removal.browser.mjs",
  "test/studio-editing-safety.browser.mjs",
  "test/studio-architecture.browser.mjs",
  "test/studio-architecture-import.browser.mjs",
  "test/studio-import-resolution.browser.mjs",
  "test/studio-readability.browser.mjs",
  "test/studio-architecture-create-only.browser.mjs",
  "test/studio-architecture-loading.browser.mjs",
  "test/studio-architecture-checkpoint.browser.mjs",
  "test/studio-architecture-rebase.browser.mjs",
  "test/studio-architecture-history.browser.mjs",
  "test/studio-v3-bundle.browser.mjs",
  "test/studio-architecture-work.browser.mjs",
  "test/studio-architecture-recovery.browser.mjs",
  "test/studio-architecture-conflict.browser.mjs",
  "test/studio-architecture-navigation.browser.mjs",
  "test/studio-trial.browser.mjs",
  "test/studio-trial-edit-race.browser.mjs",
  "test/studio-trial-assumptions.browser.mjs",
  "test/studio-completion.browser.mjs",
  "test/studio-completion-position.browser.mjs",
  "test/studio-project-interface.browser.mjs",
  "test/studio-recipe-outcomes.browser.mjs",
  "test/studio-rich-interface.browser.mjs",
  "test/studio-type-field-edits.browser.mjs",
  "test/studio-guide-layout.browser.mjs",
  "test/studio-interface-edit.browser.mjs",
  "test/studio-interface-scale.browser.mjs",
  "test/studio-large-sources.browser.mjs",
  "test/studio-shape-limit.browser.mjs",
  "test/studio-retitled-link.browser.mjs",
  "test/studio-crlf-review.browser.mjs",
  "test/studio-search-pages.browser.mjs",
  "test/studio-document-reader.browser.mjs",
  "test/studio-document-browsing.browser.mjs",
  "test/studio-source-planning.browser.mjs",
  "test/studio-source-subset.browser.mjs",
  "test/studio-stale-source-review.browser.mjs",
  "test/studio-source-selection-cache.browser.mjs",
  "test/studio-fork-attention.browser.mjs",
  "test/studio-source-reopen.browser.mjs",
  "test/studio-deleted-buffer.browser.mjs",
  "test/studio-report-import-keyboard.browser.mjs",
  "test/studio-source-repair.browser.mjs",
  "test/studio-setup-conflict.browser.mjs",
  "test/studio-source-profile.browser.mjs",
  "test/studio-new-form-types-recovery.browser.mjs",
  "test/studio-interface-resume.browser.mjs",
  "test/studio-interface-merge.browser.mjs",
  "test/studio-planning-a11y.browser.mjs",
  "test/studio-link-repair.browser.mjs",
  "test/studio-legacy-review.browser.mjs",
  "test/studio-evidence-revision.browser.mjs",

  "test/studio-shared-interface.browser.mjs",
  "test/studio-reuse-type.browser.mjs",
  "test/studio-branches.browser.mjs",
  "test/studio-new-form-recovery.browser.mjs",
  "test/studio-foreign-draft.browser.mjs",
  "test/studio-output-plugin.browser.mjs",
  "test/studio-contracts-regeneration.browser.mjs",
  "test/studio-implementation-check.browser.mjs",
  "test/studio-committed-recovery.browser.mjs",
];
const from = process.argv.indexOf("--from");
const start = from < 0 ? 0 : files.indexOf(process.argv[from + 1]);
if (start < 0) throw Error("Unknown GUI test passed to --from");
const countArg = process.argv.indexOf("--count");
const count = countArg < 0 ? files.length : Number(process.argv[countArg + 1]);
if (!Number.isSafeInteger(count) || count < 1 || count > files.length)
  throw Error("Choose a positive --count within the registered journey list.");
const selected = files.slice(start, start + count);
const evidenceArg = process.argv.indexOf("--evidence-dir");
const evidenceRoot =
  evidenceArg < 0
    ? mkdtempSync(resolve("evidence/gui-run-"))
    : resolve(process.argv[evidenceArg + 1] ?? "");
mkdirSync(evidenceRoot, { recursive: true });
console.log(`GUI artifacts: ${evidenceRoot}`);
const digest = (text) => createHash("sha256").update(text).digest("hex");
function fingerprint() {
  const result = {};
  function visit(path) {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) result[file] = digest(readFileSync(file));
    }
  }
  for (const path of ["src", "web/src", "dist", "dist-web", "test"])
    visit(path);
  for (const path of [
    "package.json",
    "package-lock.json",
    "scripts/gui-check.mjs",
  ])
    result[path] = digest(readFileSync(path));
  return result;
}
const manifest = fingerprint();
const manifestHash = digest(JSON.stringify(manifest));
writeFileSync(
  join(evidenceRoot, "candidate-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
const record = {
  manifestHash,
  browserExecutable: configuredBrowser,
  browserEngine: engine,
  started: new Date().toISOString(),
  intended: selected,
  journeys: [],
  stableCandidate: null,
};
function publish() {
  const path = join(evidenceRoot, "journeys.json");
  writeFileSync(path + ".tmp", JSON.stringify(record, null, 2));
  renameSync(path + ".tmp", path);
}
publish();
let failed = false;
for (const file of selected) {
  const started = new Date().toISOString();
  const result = spawnSync(
    helper,
    [
      "headless",
      "--seconds",
      "60",
      "--",
      "env",
      "GOMAXPROCS=1",
      "UV_THREADPOOL_SIZE=1",
      "PYM_TEST_ENGINE=" + engine,
      "PYM_BROWSER_ENGINE=" + engine,
      ...(process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE
        ? [
            "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=" +
              process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE,
          ]
        : []),
      "PYM_BROWSER_EVIDENCE_DIR=" + evidenceRoot,
      "PYM_" + engine.toUpperCase() + "=" + configuredBrowser,
      process.execPath,
      "test/browser-journey.mjs",
      file,
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYM_BROWSER_EVIDENCE_DIR: evidenceRoot },
    },
  );
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidenceRoot, basename(file) + ".log"), output);
  process.stdout.write(output);
  record.journeys.push({
    file,
    started,
    finished: new Date().toISOString(),
    exitCode: result.status,
    signal: result.signal,
    passed: !result.error && result.status === 0,
    error: result.error?.message ?? null,
    log: basename(file) + ".log",
  });
  publish();
  if (result.status !== 0) {
    console.error(
      `GUI check ${file} did not complete successfully. The failed attempt and diagnostics are retained; this is not a passed check.`,
    );
    process.exitCode = result.status ?? 2;
    failed = true;
    break;
  }
}
record.stableCandidate = digest(JSON.stringify(fingerprint())) === manifestHash;
record.finished = new Date().toISOString();
publish();
if (!record.stableCandidate) {
  console.error(
    "Candidate files changed during GUI checking; results do not certify a single build.",
  );
  process.exitCode = 2;
}
if (!failed && record.stableCandidate)
  console.log(
    `All ${record.journeys.length} GUI journeys passed against the unchanged candidate ${manifestHash}.`,
  );
