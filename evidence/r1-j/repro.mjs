// R1-J reproduction: drives the built product over real stdio MCP on an
// uninitialised Go + Rust fixture. Usage: node evidence/r1-j/repro.mjs
// (from the repository root, after npm run build). Prints JSON lines.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, writeFile, readdir, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const base = process.env.PYM_SCRATCH ?? tmpdir();
const root = await mkdtemp(join(base, "r1j-"));
const many = 150;
const files = {
  "go.mod": "module example.test/r1j\n\ngo 1.22\n",
  "main.go":
    "package main\n\nfunc Save(n int) int { return n + 1 }\n\nfunc main() { _ = Save(1) }\n",
  "Cargo.toml": '[package]\nname = "r1j"\nversion = "0.1.0"\nedition = "2021"\n',
  "src/lib.rs": [
    "pub struct SearcherBuilder { n: u32 }",
    "impl SearcherBuilder {",
    "    pub fn new() -> SearcherBuilder { SearcherBuilder { n: 0 } }",
    "    pub fn build(&self) -> u32 { self.n }",
    "}",
    "pub struct Wrap<T> { v: T }",
    "impl<T: Clone> Wrap<T> {",
    "    pub fn get(&self) -> T { self.v.clone() }",
    "}",
    "pub trait Sink { fn sink(&mut self, n: u32); }",
    "pub struct Engine;",
    "impl Engine { pub fn run(&self) -> u32 { 1 } }",
    "pub fn make() -> u32 { SearcherBuilder::new().build() }",
    ...Array.from(
      { length: many },
      (_, i) => `pub fn caller${i}<E: Runner>(e: E) -> u32 { e.run() }`,
    ),
    "pub trait Runner { fn run(&self) -> u32; }",
    "",
  ].join("\n"),
  "designs/machine.pym":
    "machine Counter {\n  state n: Nat in 0..2 = 0;\n  event inc when n < 2 { n = n + 1; }\n  invariant small = n <= 2;\n}\n",
};
for (const [p, t] of Object.entries(files)) {
  await mkdir(join(root, p, ".."), { recursive: true });
  await writeFile(join(root, p), t);
}
execFileSync("git", ["init", "-q", root]);
const out = (label, value) =>
  console.log(JSON.stringify({ label, value }, null, 0));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("dist/cli/main.js"), "mcp", root],
  stderr: "pipe",
});
const client = new Client({ name: "r1j-repro", version: "1" });
await client.connect(transport);
const call = async (name, args) => {
  const r = await client.callTool(
    { name, arguments: args },
    { timeout: 3600000 },
  );
  return { isError: r.isError ?? false, body: r.structuredContent ?? r.content };
};
const graph = async (action, query, extra = {}) => {
  let r = await call("code_graph", {
    action,
    ...(query === undefined ? {} : { query }),
    ...extra,
  });
  if (r.body.state === "running")
    r = await call("graph_result", { jobId: r.body.jobId, wait: true });
  return r;
};
const link = async (action, args = {}) => {
  let r = await call("requirement_links", { action, ...args });
  if (r.body.state === "running")
    r = await call("link_result", { jobId: r.body.jobId, wait: true });
  return r;
};
try {
  const { tools } = await client.listTools();
  out("tools", tools.map((t) => t.name));
  const { resources } = await client.listResources();
  out("resources", resources.map((r) => r.uri));
  const info = await call("project_info", {});
  out("project_info.summary", info.body);
  out("read_source go", await call("read_source", { file: "main.go" }));
  out("index", (await graph("index")).body.summary?.counts);
  for (const q of [
    "SearcherBuilder::new",
    "impl SearcherBuilder::new",
    "Wrap::get",
    "Wrap<T>::get",
    "impl<T: Clone> Wrap<T>::get",
    "Sink::sink",
    "Engine::run",
    "Save",
    "main.Save",
  ]) {
    const r = await graph("symbol", q);
    out(`symbol ${q}`, {
      status: r.body.summary?.status,
      answer: (r.body.items ?? []).map((i) => [i.type, i.qualifiedName]),
      error: r.body.error,
    });
  }
  const callers = await graph("callers", "impl Engine::run", { limit: 20 });
  out("callers Engine::run query", callers.body.summary?.query);
  out("callers possible_callers sample", callers.body.previews?.possibleCallers);
  const req = await link("requirement", { id: "R1", title: "Save" });
  out("requirement", req);
  out(".pymtheg after requirement", await readdir(join(root, ".pymtheg"), { recursive: true }).catch((e) => String(e)));
  out("git status", execFileSync("git", ["-C", root, "status", "--porcelain", "-uall"], { encoding: "utf8" }));
  const add = await link("add", { record: "R1", selector: "Save" });
  out("add", add.body.items);
  out("project_info after", (await call("project_info", {})).body.summary ?? (await call("project_info", {})).body);
  const id = add.body.items?.[0]?.id;
  out("refresh+note", await link("refresh", { link: id ?? "x", note: "n" }));
  out("unlinked+file", await link("unlinked", { file: "main.go" }));
  // G: machine-only design
  const run = await call("check_design", { file: "designs/machine.pym" });
  out("check machine", { exit: run.body.exitStatus, runId: run.body.runId });
  out("try_inputs machine", await call("try_inputs", { runId: run.body.runId, entry: "Counter", inputs: {} }));
  out("emit_scaffold machine", (await call("emit_scaffold", { runId: run.body.runId, target: "go" })).body.baseline);
  for (let i = 0; i < 3; i++) await call("check_design", { file: "designs/machine.pym" });
  out("emit_implementation_check expired", await call("emit_implementation_check", { runId: run.body.runId, target: "go", implementationType: "Impl" }));
  const versions = await call("read_implementation", { section: "versions" });
  const revision = versions.body.activeRevision ?? versions.body.items?.[0]?.id;
  out("revision", revision);
  out("unlink never", await call("unlink_implementation", { revision: revision ?? "x", planId: "plan:R1", nodeId: "nope" }));
  out("link no observation", await call("link_implementation", { revision: revision ?? "x", planId: "plan:R1", nodeId: "nope", planHash: "h", observationId: "o", reviewed: true }));
} finally {
  await client.close();
  console.log("ROOT " + root);
}
