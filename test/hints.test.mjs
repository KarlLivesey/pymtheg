import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingPresenter, shellWord } from "../dist/reporting/explain.js";

const cli = new URL("../dist/cli/main.js", import.meta.url).pathname;

function withModel(name, source, body) {
  const root = mkdtempSync(join(tmpdir(), "pym-hints-"));
  try {
    const file = join(root, name);
    writeFileSync(file, source);
    return body(file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const run = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

// A minimal behaviourally broken machine: structurally
// clean, but an event lets the machine break its invariant.
const broken = `rule twice(a: Nat) -> Nat = a + a;
machine Dedup {
  state executions: Nat in 0..2 = 0;
  event admit when executions < 2 { executions = executions + 1; }
  invariant singleExecution = executions <= 1;
}
`;

test("check on a behaviourally broken machine says behaviour was not checked and points to verify", () =>
  withModel("broken.pym", broken, (file) => {
    const checked = run("check", file);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Dedup\/types-effects-outcomes: established/);
    assert.match(
      checked.stdout,
      /BEHAVIOUR NOT CHECKED: check covers types, effects and outcomes only/,
    );
    assert.match(checked.stdout, /not behavioural evidence/);
    assert.ok(
      checked.stdout.includes(
        `Dedup (1 invariant): pymtheg verify ${file} --entry Dedup`,
      ),
      checked.stdout,
    );
    // Never a pass of the behaviour.
    assert.doesNotMatch(
      checked.stdout,
      /no_counterexample|behaviour (passed|ok|established)/i,
    );
    assert.doesNotMatch(checked.stdout, /fix the errors above/);
    // The pointer leads somewhere real: verify finds the defect check did not.
    const verified = run("verify", file, "--entry", "Dedup");
    assert.match(
      verified.stdout,
      /Dedup\/invariant\/singleExecution: counterexample/,
    );
  }));

test("no behaviour notice when there is no machine to check", () =>
  withModel(
    "plain.pym",
    `type Decision = Accept | Reject;
rule small(n: Nat) -> Bool = n < 3;
flow decide(n: Nat) -> Decision {
  if small(n) { return Accept; }
  return Reject;
}
`,
    (file) => {
      const checked = run("check", file);
      assert.equal(checked.status, 0, checked.stderr);
      assert.doesNotMatch(checked.stdout, /BEHAVIOUR|verify/);
    },
  ));

test("behaviour notice asks for errors to be fixed first and stays out of JSON", () =>
  withModel(
    "errors.pym",
    `machine Counter {
  state n: Nat in 0..3 = 3;
  event dec when n > 0 { n = n - 1; }
  invariant ok = n <= 3;
}
`,
    (file) => {
      const checked = run("check", file);
      assert.equal(checked.status, 1);
      assert.match(checked.stdout, /BEHAVIOUR NOT CHECKED/);
      assert.match(
        checked.stdout,
        /To check behaviour, fix the errors above, then run verify/,
      );
      const asJson = run("check", file, "--format", "json");
      const report = JSON.parse(asJson.stdout);
      assert.equal(report.session.requested, "check");
      assert.doesNotMatch(asJson.stdout, /BEHAVIOUR NOT CHECKED/);
    },
  ));

const suggestion = (message) => /`([^`]+)`/.exec(message)?.[1];

test("Nat subtraction in machine state suggests a declaration that checks when pasted", () =>
  withModel(
    "machine.pym",
    `machine Counter {
  state n: Nat in 0..3 = 1 + 2;
  event dec when n > 0 { n = n - 1; }
  event bump when n < 2 { n = (n - 1) + 2; }
  invariant ok = n <= 3;
}
`,
    (file) => {
      const checked = run("check", file, "--format", "json");
      const t002 = JSON.parse(checked.stdout).diagnostics.filter(
        (d) => d.code === "T002",
      );
      assert.equal(t002.length, 2, checked.stdout);
      for (const d of t002)
        assert.equal(
          d.message,
          "Expected Nat, got Int. Subtracting from a Nat gives an Int, because the result may be below zero. Change Nat to Int in the declaration of n, keeping its range: `state n: Int in 0..3 = 1 + 2;`",
        );
      // Apply the suggestion literally: replace the whole declaration with it.
      const source = readFileSync(file, "utf8");
      const declaration = "state n: Nat in 0..3 = 1 + 2;";
      assert.ok(source.includes(declaration));
      writeFileSync(
        file,
        source.replace(declaration, suggestion(t002[0].message)),
      );
      const fixed = run("check", file);
      assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
      assert.doesNotMatch(fixed.stdout, /error/);
      assert.match(
        fixed.stdout,
        /Counter\/types-effects-outcomes: established/,
      );
    },
  ));

test("Nat subtraction in a flow suggests Int; other Nat mismatches get no subtraction hint", () =>
  withModel(
    "flow.pym",
    `flow pred(x: Nat) -> Nat {
  return x - 1;
}
flow widen(x: Int) -> Nat {
  return x;
}
flow add(x: Nat) -> Nat {
  return x + 1;
}
flow lower(x: Int) -> Nat {
  return x - 1;
}
`,
    (file) => {
      const checked = run("check", file, "--format", "json");
      const report = JSON.parse(checked.stdout);
      const t002 = report.diagnostics.filter((d) => d.code === "T002");
      assert.equal(t002.length, 3, checked.stdout);
      const [pred, widen, lower] = [...t002].sort(
        (a, b) => a.span.start - b.span.start,
      );
      const advice =
        "If the value can go below zero, change Nat to Int in its declaration. For machine state, keep a finite range, for example `state count: Int in 0..3 = 0;`.";
      assert.equal(
        pred.message,
        `Expected Nat, got Int. Subtracting from a Nat gives an Int, because the result may be below zero. ${advice}`,
      );
      // The left side is already Int: do not claim it subtracted from a Nat.
      assert.equal(
        lower.message,
        `Expected Nat, got Int. The result of this subtraction is Int, and the target is Nat. ${advice}`,
      );
      assert.equal(widen.message, "Expected Nat, got Int");
      const explain = findingPresenter(report);
      assert.equal(
        explain(pred).title,
        "Subtracting from a Nat can go below zero",
      );
      assert.equal(
        explain(lower).title,
        "This subtraction gives an Int where a Nat is needed",
      );
      assert.match(explain(pred).nextStep, /change Nat to Int/);
      assert.equal(
        explain(widen).title,
        "This value does not match the required type",
      );
      // The example declaration in the advice is itself valid source.
      writeFileSync(
        file,
        `machine M {\n  ${suggestion(advice)}\n  event up when count < 3 { count = count + 1; }\n  invariant ok = count <= 3;\n}\n`,
      );
      const example = run("check", file);
      assert.equal(example.status, 0, example.stdout + example.stderr);
    },
  ));

test("printed verify command is one POSIX shell word per argument and runs as pasted", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-hints-"));
  try {
    const dir = join(root, 'it\'s a $HOME `id` "dir"');
    mkdirSync(dir);
    const file = join(dir, "broken.pym");
    writeFileSync(file, broken);
    const checked = run("check", file);
    assert.equal(checked.status, 0, checked.stderr);
    const command = /^ {2}Dedup \(1 invariant\): (pymtheg verify .*)$/m.exec(
      checked.stdout,
    )?.[1];
    assert.ok(command, checked.stdout);
    assert.equal(shellWord(file), `'${file.replaceAll("'", "'\\''")}'`);
    const pasted = spawnSync(
      "sh",
      ["-c", command.replace(/^pymtheg /, '"$PYM_NODE" "$PYM_CLI" ')],
      {
        encoding: "utf8",
        env: { ...process.env, PYM_NODE: process.execPath, PYM_CLI: cli },
      },
    );
    assert.match(
      pasted.stdout,
      /Dedup\/invariant\/singleExecution: counterexample/,
      pasted.stdout + pasted.stderr,
    );
    assert.equal(shellWord("/plain/path.pym"), "/plain/path.pym");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("printed verify commands keep --scenario for the checked file", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-hints-"));
  try {
    const file = join(root, "broken.pym");
    writeFileSync(file, broken);
    mkdirSync(join(root, ".pymtheg"));
    writeFileSync(
      join(root, ".pymtheg", "settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: { small: { file: "broken.pym", entry: "Dedup" } },
      }),
    );
    const checked = run("check", file, "--scenario", "small");
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const command = /^ {2}Dedup \(1 invariant\): pymtheg (verify .*)$/m.exec(
      checked.stdout,
    )?.[1];
    assert.equal(command, `verify ${file} --entry Dedup --scenario small`);
    const pasted = run(...command.split(" "));
    assert.match(
      pasted.stdout,
      /Dedup\/invariant\/singleExecution: counterexample/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Run every printed verify command as pasted; none may fail on its options.
function runPrinted(stdout) {
  const commands = [
    ...stdout.matchAll(
      /^ {2}(\w+) \(\d+ invariants?\): pymtheg (verify .*)$/gm,
    ),
  ];
  assert.ok(commands.length, stdout);
  return Object.fromEntries(
    commands.map(([, name, command]) => {
      const pasted = spawnSync(
        "sh",
        ["-c", `"$PYM_NODE" "$PYM_CLI" ${command}`],
        {
          encoding: "utf8",
          env: { ...process.env, PYM_NODE: process.execPath, PYM_CLI: cli },
        },
      );
      assert.ok(
        [0, 1].includes(pasted.status),
        `${command}\n${pasted.stdout}${pasted.stderr}`,
      );
      assert.match(
        pasted.stdout,
        new RegExp(
          `^${name}/invariant/\\w+: (counterexample|no_counterexample) \\(finite_model_check, complete\\)$`,
          "m",
        ),
        `${command}\n${pasted.stdout}${pasted.stderr}`,
      );
      return [name, command];
    }),
  );
}

function withScenario(source, scenario, body, extra = [], files = {}) {
  const root = mkdtempSync(join(tmpdir(), "pym-hints-"));
  try {
    const file = join(root, "mixed.pym");
    writeFileSync(file, source);
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(root, name), text);
    mkdirSync(join(root, ".pymtheg"));
    writeFileSync(
      join(root, ".pymtheg", "settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: { small: { file: "mixed.pym", ...scenario } },
      }),
    );
    const checked = run("check", file, "--scenario", "small", ...extra);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    return body(file, checked.stdout, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("--scenario is kept only for the machine that is the scenario's entry", () =>
  withScenario(
    `machine X {
  state n: Nat in 0..2 = 0;
  event up when n < 2 { n = n + 1; }
  invariant small = n <= 1;
}
machine Y {
  state b: Bool = false;
  event flip when !b { b = true; }
  invariant ok = b || !b;
}
`,
    {
      entry: "X",
      scope: { domains: { n: "0..2" }, assumptions: ["one counter"] },
    },
    (file, stdout) => {
      const commands = runPrinted(stdout);
      assert.equal(commands.X, `verify ${file} --entry X --scenario small`);
      assert.equal(commands.Y, `verify ${file} --entry Y`);
    },
  ));

test("a flow-entry scenario is not added to any machine's verify command", () =>
  withScenario(
    `flow step(n: Nat) -> Bool {
  return n < 2;
}
machine Counter {
  state n: Nat in 0..2 = 0;
  event up when n < 2 { n = n + 1; }
  invariant ok = n <= 2;
}
`,
    { entry: "step", scope: { inputs: { n: [0, 1, 2] } } },
    (file, stdout) => {
      const commands = runPrinted(stdout);
      assert.deepEqual(commands, {
        Counter: `verify ${file} --entry Counter`,
      });
    },
  ));

const flowAndCounter = `flow step(n: Nat) -> Bool {
  return n < 2;
}
machine Counter {
  state n: Nat in 0..2 = 0;
  event up when n < 2 { n = n + 1; }
  invariant ok = n <= 2;
}
`;
const twoMachines = `machine X {
  state n: Nat in 0..2 = 0;
  event up when n < 2 { n = n + 1; }
  invariant small = n <= 1;
}
machine Y {
  state b: Bool = false;
  event flip when !b { b = true; }
  invariant ok = b || !b;
}
`;
const xScope = {
  entry: "X",
  scope: { domains: { n: "0..2" }, assumptions: ["one counter"] },
};

test("explicit --entry naming a machine does not move a flow scenario onto it", () =>
  withScenario(
    flowAndCounter,
    { entry: "step", scope: { inputs: { n: [0, 1, 2] } } },
    (file, stdout) => {
      assert.deepEqual(runPrinted(stdout), {
        Counter: `verify ${file} --entry Counter`,
      });
    },
    ["--entry", "Counter"],
  ));

test("explicit --entry naming another machine keeps --scenario on the scenario's own machine", () =>
  withScenario(
    twoMachines,
    xScope,
    (file, stdout) => {
      assert.deepEqual(runPrinted(stdout), {
        X: `verify ${file} --entry X --scenario small`,
        Y: `verify ${file} --entry Y`,
      });
    },
    ["--entry", "Y"],
  ));

test("a scenario for an imported machine is printed against the checked file", () =>
  withScenario(
    `import "lib.pym";
flow step(n: Nat) -> Bool {
  return n < 2;
}
`,
    xScope,
    (file, stdout, root) => {
      const commands = runPrinted(stdout);
      assert.deepEqual(commands, {
        X: `verify ${file} --entry X --scenario small`,
        Y: `verify ${join(root, "lib.pym")} --entry Y`,
      });
    },
    [],
    { "lib.pym": twoMachines },
  ));

test("shellWord quotes a word starting with = (zsh expands =word)", () => {
  assert.equal(shellWord("=ls"), "'=ls'");
  assert.equal(shellWord("a=b"), "a=b");
});

test("more than five machines: the remainder is counted, singular for one", () => {
  const machines = (count) =>
    Array.from(
      { length: count },
      (_, i) =>
        `machine M${i} {\n  state b: Bool = false;\n  event flip when !b { b = true; }\n  invariant ok = b || !b;\n}\n`,
    ).join("");
  withModel("six.pym", machines(6), (file) => {
    const { stdout } = run("check", file);
    assert.match(stdout, /^ {2}and 1 more machine$/m);
    assert.doesNotMatch(stdout, /M5 \(/);
  });
  withModel("seven.pym", machines(7), (file) => {
    const { stdout } = run("check", file);
    assert.match(stdout, /^ {2}and 2 more machines$/m);
  });
});

test("source-discovery guidance points at .pymtheg/settings.json", () => {
  const explain = findingPresenter({
    snapshot: { files: [] },
    results: [],
  });
  const help = explain({
    code: "L003",
    severity: "warning",
    message: "skipped",
    span: { file: "x.pym", start: 0, end: 0 },
    related: [],
    path: [],
  });
  assert.match(
    help.nextStep,
    /sources\.include\/exclude in \.pymtheg\/settings\.json\./,
  );
  assert.doesNotMatch(help.nextStep, /\.pymtheg\.json/);
});
