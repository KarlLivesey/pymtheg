// R1-H: the npm package ships user documentation only, and no shipped file
// carries a personal home path, the owner's name or a private project name.
// Reads the real pack list (`npm pack --dry-run --json`); nothing is written.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const pack = spawnSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  },
);
const files = () => {
  assert.equal(pack.status, 0, pack.stderr);
  return JSON.parse(pack.stdout)[0].files.map((f) => f.path);
};
const userDocs = [
  "docs/agent-workflow.md",
  "docs/grammar.md",
  "docs/journeys.md",
  "docs/licences.md",
  "docs/mcp.md",
  "docs/output-plugins.md",
  "docs/project-init.md",
  "docs/report.schema.json",
  "docs/studio.md",
  "docs/support.md",
];
test("the package ships only user documentation from docs/", () => {
  const shipped = files()
    .filter((f) => f.startsWith("docs/"))
    .sort();
  assert.deepEqual(shipped, userDocs);
  for (const internal of [
    "docs/build-plan.md",
    "docs/decisions.md",
    "docs/mega-plan.md",
    "docs/trial-start.md",
    "docs/progress.md",
    "docs/runtime-map.md",
  ])
    assert.ok(!files().includes(internal), `${internal} must not ship`);
  assert.ok(
    !files().some((f) => f.startsWith("docs/changes/")),
    "docs/changes must not ship",
  );
  // Pymtheg's own licence ships (npm always packs LICENSE).
  assert.ok(files().includes("LICENSE"), "LICENSE must ship");
  // The product reads these at run time.
  for (const needed of [
    "docs/agent-workflow.md",
    "docs/grammar.md",
    "docs/report.schema.json",
  ])
    assert.ok(files().includes(needed), needed);
});
/**
 * Private network details: RFC 1918 IPv4 addresses (10/8, 172.16/12,
 * 192.168/16) and host names ending .internal, .local or .lan, or the bare
 * name devserver. Loopback, 0.0.0.0 and documentation ranges (192.0.2.x,
 * 198.51.100.x, 203.0.113.x) are allowed. In compiled code a member access
 * such as `this.local` has the same shape as a host name, so in .js, .mjs,
 * .d.ts and .css files the host-suffix rule applies only where a host name
 * would be written: inside a string or URL (after a quote, backtick, `//` or
 * `@`) and on comment lines, where backtick code spans (code references such
 * as `data.local`) are skipped. Markdown and other text files get the full
 * rule, code spans included. The address and devserver rules apply to every
 * shipped file, first- and third-party alike; nothing in the real package
 * needed to be exempted.
 */
const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
// A whole dotted quad: not part of a longer number or version string.
const privateIPv4 = new RegExp(
  `(?<![\\d.])(?:10\\.${octet}\\.${octet}|172\\.(?:1[6-9]|2\\d|3[01])\\.${octet}|192\\.168\\.${octet})\\.${octet}(?!\\d|\\.\\d)`,
);
const label = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const hostSuffix = `${label}(?:\\.${label})*\\.(?:internal|local|lan)(?![\\w-])`;
const textHost = new RegExp(`(?<![\\w.-])${hostSuffix}`, "i");
const codeHost = new RegExp(`(?<=["'\`@]|//)${hostSuffix}`, "i");
const devserver = /(?<![\w-])devserver(?![\w-])/i;
function networkFindings(path, text) {
  const code = /\.(m?js|d\.ts|css)$/.test(path);
  const found = [];
  text.split("\n").forEach((line, i) => {
    const comment = /^\s*(\/\/|\/?\*)/.test(line);
    if (privateIPv4.test(line))
      found.push(`${path}:${i + 1}: private IPv4 address`);
    const host = code
      ? comment
        ? textHost.test(line.replace(/`[^`]*`/g, " "))
        : codeHost.test(line)
      : textHost.test(line);
    if (host) found.push(`${path}:${i + 1}: private host name`);
    if (devserver.test(line))
      found.push(`${path}:${i + 1}: devserver host name`);
  });
  return found;
}
test("no shipped file carries a private network address or host name", () => {
  const offences = [];
  for (const path of files()) {
    if (/\.(wasm|png|ico)$/.test(path) || !existsSync(path)) continue;
    offences.push(...networkFindings(path, readFileSync(path, "utf8")));
  }
  assert.deepEqual(offences, []);
});
test("the private network rules fire on each private form and allow public, loopback and documentation forms", () => {
  const fires = (path, text) => networkFindings(path, text).length > 0;
  for (const text of [
    "server at 10.0.0.1",
    "server at 10.255.12.34:8080",
    "server at 172.16.0.1",
    "server at 172.31.255.254",
    "server at 192.168.88.47",
    "see private-box.internal",
    "see nas.local for files",
    "ssh build.lan",
    "ssh devserver",
    "ssh DevServer -p 22",
    "code spans are scanned in docs: `nas.local`",
  ])
    assert.ok(fires("README.md", text), text);
  for (const text of [
    'fetch("http://192.168.1.10/api")',
    "const url = `https://private-box.internal/x`;",
    'const host = "nas.local";',
    "ssh git@build.lan",
    "// connect to devserver",
    "// see private-box.internal for logs",
    " * reachable at nas.local only",
  ])
    assert.ok(fires("dist/x.js", text), text);
  for (const text of [
    "listen on 127.0.0.1 or 0.0.0.0",
    "example 192.0.2.10, 198.51.100.7 and 203.0.113.5",
    "public 8.8.8.8 and 172.32.0.1 and 172.15.0.1 and 192.169.0.1",
    "version 10.2.3 of the tool",
    "build 110.0.0.1 is not private",
    "the dev server runs builds",
    "localhost and example.com",
    "internal.example.com",
    "the local cache",
  ])
    assert.ok(!fires("README.md", text), text);
  for (const text of [
    "this.local = initial;",
    "const found = this.local(name);",
    "symbol.data?.local)",
    "names.local[occurrence.name]",
    "if(e.local)return",
    " * symbol's name and identity, `data.local`); package-level types",
  ])
    assert.ok(!fires("dist/x.js", text), text);
});
test("no shipped file carries a personal path, the owner's name or a private project name", () => {
  const offences = [];
  for (const path of files()) {
    if (/\.(wasm|png|ico)$/.test(path) || !existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const licenceText = [
      "LICENSE",
      "THIRD-PARTY-NOTICES",
      "docs/licences.md",
    ].includes(path);
    const rules = [
      ["personal path", /\/home\/[a-z_][a-z0-9_.-]*\//i],
      ["private project name", /\b(project-a|project-c)\b|\bTiered\b/i],
      ...(licenceText ? [] : [["owner's name", /\bKarl\b/]]),
    ];
    for (const [what, pattern] of rules) {
      const line = text.split("\n").findIndex((l) => pattern.test(l));
      if (line >= 0) offences.push(`${path}:${line + 1}: ${what}`);
    }
  }
  assert.deepEqual(offences, []);
});
