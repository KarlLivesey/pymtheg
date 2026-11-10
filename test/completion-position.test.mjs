import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { parse } from "../dist/language/parser.js";
import {
  CompletionPositions,
  completionCaller,
} from "../dist/studio/completion-position.js";
import { callableSnippet } from "../dist/studio/completion.js";
const file = "/source.pym";
const source =
  "op fetch(x: Nat) -> Nat;\nflow f(a: Nat, b: Nat) -> Unit {\n  let n = 0;\n}\nflow g(a: Nat) -> Unit {\n  let n = 1;\n}\n";
function fixture() {
  const parsed = parse(file, source);
  const nat = { kind: "nat", label: "Nat" };
  const symbols = parsed.declarations.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    span: d.span,
    headerEnd: d.result.span.end,
    callable: {
      parameters: d.params.map((p) => ({ name: p.name, shape: nat })),
      result: d.result.name === "Unit" ? { kind: "unit", label: "Unit" } : nat,
    },
  }));
  let state = EditorState.create({ doc: source });
  const history = new CompletionPositions();
  return {
    symbols,
    history,
    get state() {
      return state;
    },
    change(change) {
      const tr = state.update({ changes: change });
      history.record(state.doc, tr.state.doc, tr.changes);
      state = tr.state;
    },
  };
}
test("completion maps a live cursor back to its real checked caller, preserving ambiguity", () => {
  const f = fixture();
  const at = source.indexOf("\n}", source.indexOf("flow f"));
  const insert =
    "\n  // ordinary typing shifts into the next old declaration\n  call fet";
  f.change({ from: at, insert });
  const caller = completionCaller(
    f.symbols,
    file,
    f.history.site(source, f.state.doc, at + insert.length),
  );
  assert.equal(caller.name, "f");
  assert.match(callableSnippet(f.symbols[0], caller), /unknown "Value for x"/);
  const gAt = f.state.doc.toString().indexOf("let n = 1;") + 10;
  f.change({ from: gAt, insert: "\n call fet" });
  const g = completionCaller(
    f.symbols,
    file,
    f.history.site(source, f.state.doc, gAt + 10),
  );
  assert.equal(g.name, "g");
  assert.match(callableSnippet(f.symbols[0], g), /\$\{a\}/);
});
test("header and scope edits invalidate guesses; exact recheck restores context", () => {
  for (const change of [
    { from: source.indexOf("a: Nat"), insert: "new" },
    { from: source.indexOf("let n"), insert: "}" },
  ]) {
    const f = fixture();
    f.change(change);
    assert.equal(
      completionCaller(
        f.symbols,
        file,
        f.history.site(
          source,
          f.state.doc,
          f.state.doc.toString().indexOf("let n"),
        ),
      ),
      undefined,
    );
  }
  const f = fixture();
  for (let i = 0; i < 130; i++)
    f.change({ from: source.indexOf("let n"), insert: " " });
  assert.equal(f.history.site(source, f.state.doc, 70), undefined);
  assert.deepEqual(f.history.site(f.state.doc.toString(), f.state.doc, 70), {
    offset: 70,
    changes: [],
  });
  assert.equal(
    completionCaller(f.symbols, file, {
      offset: f.symbols.at(-1).span.end,
      changes: [],
    }),
    undefined,
  );
});
