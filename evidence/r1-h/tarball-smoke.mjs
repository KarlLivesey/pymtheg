// R1-H: install a Pymtheg tarball into a fresh directory with production
// dependencies only, then exercise every surface from the installed package.
//   node evidence/r1-h/tarball-smoke.mjs ./pymtheg-1.0.0.tgz WORKDIR > result.json
// No sleeps: every server step waits for its printed readiness or a reply.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";

const [tarballArg, workArg] = process.argv.slice(2);
const work = resolve(workArg);
mkdirSync(work, { recursive: true });
const tarball = resolve(tarballArg);
const out = { tarball: basename(tarball), steps: {} };
const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, ...options });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

// Install: a package.json-less directory, local tarball, no dev dependencies.
writeFileSync(join(work, "package.json"), '{"name":"smoke","version":"0.0.0","private":true}\n');
copyFileSync(tarball, join(work, basename(tarball)));
const install = run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", `./${basename(tarball)}`], { cwd: work });
const warnings = (install.stdout + install.stderr).split("\n").filter((l) => /npm warn/i.test(l));
const size = (p) => {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const q = join(p, e.name);
    if (e.isSymbolicLink()) continue;
    total += e.isDirectory() ? size(q) : statSync(q).size;
  }
  return total;
};
const packages = run("npm", ["ls", "--all", "--parseable", "--omit=dev"], { cwd: work }).stdout.trim().split("\n").length - 1;
out.install = {
  status: install.status,
  nodeModulesBytes: size(join(work, "node_modules")),
  packages,
  warnings,
  installScriptWarnings: warnings.filter((w) => /install-scripts|install script/i.test(w)),
};
const pkg = join(work, "node_modules/pymtheg");
const bin = join(pkg, "dist/cli/main.js");
const cli = (args, cwd = work) => run(process.execPath, [bin, ...args], { cwd });
const step = (name, r, ok) => {
  out.steps[name] = { status: r.status, ok: ok(r), stderr: r.stderr.trim().slice(0, 300) };
};

step("help", cli(["--help"]), (r) => r.status === 0);
step("check", cli(["check", join(pkg, "examples/mvp/task-buggy.pym"), "--format", "json"]), (r) => r.status === 0 || r.status === 1);
step("verify", cli(["verify", join(pkg, "examples/mvp/task-buggy.pym"), "--entry", "TaskRunner", "--format", "json"]), (r) => r.status === 1 && /"counterexample"/.test(r.stdout));
step("simulate", cli(["simulate", join(pkg, "examples/mvp/task-fixed.pym"), "--entry", "TaskRunner", "--format", "json"]), (r) => r.status === 0 && /"exhaustive": false/.test(r.stdout));
step("doctor", cli(["doctor", "--format", "json"]), (r) => r.status === 0 && JSON.parse(r.stdout).ready === true);

// Graph: a sample with TypeScript, Go and Rust cross-file calls.
const sample = join(work, "sample");
for (const [path, text] of [
  ["web/a.ts", 'import { b } from "./b";\nexport function a() { return b(); }\n'],
  ["web/b.ts", "export function b() { return 1; }\n"],
  ["service/go.mod", "module example.com/service\n\ngo 1.22\n"],
  ["service/main.go", "package main\n\nfunc main() { helper() }\n"],
  ["service/helper.go", "package main\n\nfunc helper() {}\n"],
  ["engine/Cargo.toml", '[package]\nname = "engine"\nversion = "0.1.0"\nedition = "2021"\n'],
  ["engine/src/lib.rs", "mod util;\npub fn run() { util::help(); }\n"],
  ["engine/src/util.rs", "pub fn help() {}\n"],
]) {
  mkdirSync(dirname(join(sample, path)), { recursive: true });
  writeFileSync(join(sample, path), text);
}
const index = cli(["graph", "index", "--root", sample, "--json"]);
step("graph-index", index, (r) => r.status === 0);
for (const [name, selector, caller, file] of [
  ["ts", "b", "a", "web/a.ts"],
  ["go", "helper", "main", "service/main.go"],
  ["rust", "help", "run", "engine/src/lib.rs"],
]) {
  const callers = cli(["graph", "callers", selector, "--root", sample, "--json"]);
  // A definite cross-file call from the expected caller.
  step(`graph-callers-${name}`, callers, (r) =>
    r.status === 0 &&
    JSON.parse(r.stdout).data.links.some(
      (l) => l.kind === "calls" && l.certainty === "definite" && l.source?.name === caller && l.file === file,
    ),
  );
}

// MCP: raw JSON-RPC over stdio (the client library is a dev dependency).
out.steps.mcp = await new Promise((done) => {
  const child = spawn(process.execPath, [bin, "mcp", sample], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", stderr = "";
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  child.stderr.on("data", (c) => (stderr += c));
  child.stdout.on("data", (c) => {
    buffer += c;
    for (let i; (i = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      const m = JSON.parse(line);
      if (m.id === 1) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      } else if (m.id === 2) {
        const tools = m.result.tools.map((t) => t.name);
        child.stdin.end();
        child.on("close", (code) => done({ ok: tools.length > 0, tools: tools.length, exit: code, stderr: stderr.trim().slice(0, 300) }));
      }
    }
  });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
});

// Studio: start, wait for the printed URL, fetch the page and an API route, SIGINT.
out.steps.studio = await new Promise((done) => {
  const child = spawn(process.execPath, [bin, "studio", sample, "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  let text = "", stderr = "", fetched = false;
  child.stderr.on("data", (c) => (stderr += c));
  child.stdout.on("data", async (c) => {
    text += c;
    const url = /Open in Firefox: (\S+)/.exec(text)?.[1];
    if (!url || fetched) return;
    fetched = true;
    const page = await fetch(url);
    const html = await page.text();
    const script = /src="([^"]+\.js)"/.exec(html)?.[1];
    const asset = script ? await fetch(new URL(script, url)) : null;
    child.on("close", (code, signal) =>
      done({ ok: page.status === 200 && asset?.status === 200 && code === 0, http: page.status, asset: asset?.status ?? null, exit: code, signal, stderr: stderr.trim().slice(0, 300) }),
    );
    child.kill("SIGINT");
  });
});
out.ok = Object.values(out.steps).every((s) => s.ok) && out.install.status === 0;
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
