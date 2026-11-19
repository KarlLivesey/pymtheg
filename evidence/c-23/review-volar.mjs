// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [directory, receipt, baseline, candidate] = process.argv.slice(2);
const scratch = resolve(directory);
const { repos } = JSON.parse(readFileSync(receipt, "utf8"));
const astro = repos.find((repo) => repo.id === "withastro/astro");
const store = join(scratch, astro.attempt, "checkout/node_modules/.pnpm");
const pkg = readdirSync(store).find((entry) =>
  entry.startsWith("@volar+language-server@2.4.31_"),
);
const root = join(scratch, `${candidate}-volar-probe`);
mkdirSync(join(root, "node_modules/@volar"), { recursive: true });
cpSync(
  join(store, pkg, "node_modules/@volar/language-server"),
  join(root, "node_modules/@volar/language-server"),
  { recursive: true },
);
writeFileSync(
  join(root, "probe.ts"),
  `
import { register as configure } from "@volar/language-server/lib/features/configurations";
import { register as registerFolders } from "@volar/language-server/lib/features/workspaceFolders";
declare const server: Parameters<typeof configure>[0];
declare const useConfiguration: boolean;
const configuration = configure(server);
const folders = registerFolders(server);
configuration.onDidChange(() => {});
folders.onDidChange(() => {});
(useConfiguration ? configuration : folders).onDidChange(() => {});
`,
);
const owner = "ReturnType<typeof register>.onDidChange";
const commands = (build, args) =>
  JSON.parse(
    execFileSync(
      "unshare",
      [
        "--user",
        "--map-root-user",
        "--net",
        "--",
        process.execPath,
        join(scratch, build, "dist/cli/main.js"),
        ...args,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
const look = (build, symbol) => {
  const { data } = commands(build, [
    "graph",
    "uses",
    "@volar/language-server",
    symbol,
    "--root",
    ".",
    "--json",
  ]);
  return {
    symbol,
    counts: data.classCounts,
    links: data.links
      .map(({ targetName, certainty }) => ({ targetName, certainty }))
      .sort((a, b) => a.targetName.localeCompare(b.targetName)),
  };
};
commands(baseline, ["init", ".", "--name", "volar-review", "--format", "json"]);
const before = look(baseline, owner);
const after = [
  "lib/features/configurations.d.ts:",
  "lib/features/workspaceFolders.d.ts:",
  "",
].map((path) => look(candidate, path + owner));
console.log(JSON.stringify({ before, after }, null, 2));
