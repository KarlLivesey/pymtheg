import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
const observe = (files) =>
  observeTypescript(
    Object.entries(files).map(([path, text]) => ({
      path,
      text,
      hash: hash(text),
    })),
    { label: "CommonJS", gitCommit: null, dirty: true },
  );

test("static CommonJS function exports have linkable identities and own their calls", () => {
  const graph = observe({
    "lib.js":
      "function helper(value) { return value > 0; } module.exports.send = function named(value) { return helper(value); }; exports.cancel = (value) => helper(value);",
    "main.js":
      'const service = require("./lib"); function run() { service.send(1); service.cancel(2); }',
    "default.js": "module.exports = function serve() { return 1; };",
  });
  for (const id of [
    "lib.js#function:send",
    "lib.js#function:cancel",
    "default.js#function:serve",
  ])
    assert.ok(
      graph.nodes.some((n) => n.id === id && n.body === "present"),
      id,
    );
  for (const name of ["send", "cancel"]) {
    assert.ok(
      graph.edges.some(
        (e) =>
          e.from === `lib.js#function:${name}` &&
          e.to === "lib.js#function:helper" &&
          e.kind === "calls",
      ),
    );
    assert.ok(
      graph.edges.some(
        (e) =>
          e.from === "main.js#function:run" &&
          e.to === `lib.js#function:${name}` &&
          e.kind === "calls",
      ),
    );
  }
  assert.equal(graph.reader.id, "typescript-ast/v21");
});

test("parameter-property constructors count their implicit initialization as work", () => {
  const graph = observe({
    "classes.ts":
      "class Stored { constructor(public id: string, readonly count: number) {} } class Empty { constructor(id: string) {} }",
  });
  assert.equal(
    graph.nodes.find((n) => n.qualifiedName === "Stored.constructor").body,
    "present",
  );
  assert.equal(
    graph.nodes.find((n) => n.qualifiedName === "Empty.constructor").body,
    "empty",
  );
});

test("dynamic CommonJS names are not invented as static function identities", () => {
  const graph = observe({
    "dynamic.js":
      "exports[getName()] = () => true; module.exports.fixed = () => false;",
  });
  assert.ok(graph.nodes.some((n) => n.name === "fixed"));
  assert.ok(
    !graph.nodes.some(
      (n) => n.kind === "function" && n.name.includes("getName"),
    ),
  );
});

test("reassigned CommonJS exports stay ambiguous instead of choosing a runtime target", () => {
  const graph = observe({
    "repeated.js":
      "exports.send = () => 1; exports.send = () => 2; exports.send();",
  });
  assert.equal(graph.nodes.filter((n) => n.kind === "function").length, 2);
  const call = graph.edges.find((e) => e.kind === "calls");
  assert.equal(call.to, null);
  assert.equal(call.resolution, "unresolved");
});

test("exported object function properties own their calls and are linkable from consumers", () => {
  const graph = observe({
    "object.js":
      "function helper() { return 1; } module.exports = { eps() { return helper(); }, zeta: () => helper(), theta: function () { return helper(); } };",
    "consumer.js":
      'const api = require("./object"); function run() { return api.zeta() + api.theta(); }',
  });
  for (const name of ["eps", "zeta", "theta"]) {
    const node = graph.nodes.find((n) => n.name === name);
    assert.ok(node, name + " must have an observed declaration");
    assert.ok(
      graph.edges.some(
        (e) =>
          e.from === node.id &&
          e.to === "object.js#function:helper" &&
          e.kind === "calls",
      ),
    );
  }
  assert.equal(
    graph.edges.some(
      (e) =>
        e.kind === "calls" &&
        e.from === "file:object.js" &&
        e.to === "object.js#function:helper",
    ),
    false,
  );
  for (const name of ["zeta", "theta"])
    assert.ok(
      graph.edges.some(
        (e) =>
          e.from === "consumer.js#function:run" &&
          e.to === graph.nodes.find((n) => n.name === name).id,
      ),
    );
});
