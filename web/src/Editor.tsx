import {
  CompletionPositions,
  type CompletionSite,
} from "../../src/studio/completion-position";
import { search, searchKeymap } from "@codemirror/search";
import { useEffect, useRef } from "react";
import {
  EditorState,
  Compartment,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  Decoration,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  historyField,
  undo,
  redo,
} from "@codemirror/commands";
import {
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  autocompletion,
  snippet,
  type Completion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
const selected = StateEffect.define<{ from: number; to: number } | null>();
const selectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(selected)) {
        const range = effect.value;
        value =
          range && range.to > range.from
            ? Decoration.set([
                Decoration.mark({ class: "source-finding" }).range(
                  range.from,
                  range.to,
                ),
              ])
            : Decoration.none;
      }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const language = StreamLanguage.define({
  token(stream) {
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/\b\d+\b/)) return "number";
    if (
      stream.match(
        /\b(?:flow|rule|op|type|resource|machine|state|event|invariant|when|return|call|let|match|if|else|for|in|retry|on|cancel|take|borrow|own|move|transition|effects|cost|overhead|budget|bound|requires|ensures|settles|stable|atomic|protocol|submit|outcome|assert|creates|unknown|import|initial|terminal|states)\b/,
      )
    )
      return "keyword";
    if (
      stream.match(
        /\b(?:Bool|Int|Nat|String|Unit|List|Result|true|false|unit)\b/,
      )
    )
      return "typeName";
    stream.next();
    return null;
  },
});
const historyCache = new Map<string, ReturnType<EditorState["toJSON"]>>();
export function Editor(props: {
  documentId: string;
  initialCursor?: number;
  insertion?: { serial: number; template: string; documentId: string } | null;
  onInsertionHandled?: (serial: number) => void;
  value: string;
  readonly: boolean;
  range: { start: number; end: number } | null;
  checkedText: string | undefined;
  completions: (site: CompletionSite | undefined) => Completion[];
  onChange: (text: string) => void;
  onCheck: () => void;
  onSave: () => void;
  onNavigate: (offset: number, references: boolean) => void;
  onCursor: (offset: number) => void;
  hover: (offset: number) => string | null;
  onActions?: (actions: { undo: () => void; redo: () => void } | null) => void;
}) {
  const parent = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    latest = useRef(props),
    editable = useRef(new Compartment()),
    applying = useRef(false),
    positions = useRef(new CompletionPositions());
  latest.current = props;
  useEffect(() => {
    if (!parent.current) return;
    const config = {
      doc: latest.current.value,
      selection: {
        anchor: Math.min(
          latest.current.initialCursor ?? 0,
          latest.current.value.length,
        ),
      },
      extensions: [
        lineNumbers(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Specification source",
        }),
        history({ minDepth: 100 }),
        highlightActiveLine(),
        bracketMatching(),
        closeBrackets(),
        search(),
        language,
        syntaxHighlighting(
          HighlightStyle.define([
            ...defaultHighlightStyle.specs,
            {
              tag: [tags.typeName, tags.standard(tags.name)],
              color: "#006b44",
            },
          ]),
        ),
        selectionField,
        hoverTooltip((view, pos) => {
          const text = latest.current.hover(pos);
          if (!text) return null;
          return {
            pos,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.className = "symbol-tooltip";
              dom.textContent =
                text + " · F12 definition · Shift F12 references";
              return { dom };
            },
          };
        }),
        editable.current.of([
          EditorState.readOnly.of(latest.current.readonly),
          EditorView.editable.of(!latest.current.readonly),
        ]),
        keymap.of([
          {
            key: "F12",
            run: (view) => {
              latest.current.onNavigate(view.state.selection.main.from, false);
              return true;
            },
          },
          {
            key: "Shift-F12",
            run: (view) => {
              latest.current.onNavigate(view.state.selection.main.from, true);
              return true;
            },
          },
          {
            key: "Mod-Enter",
            run: () => {
              latest.current.onCheck();
              return true;
            },
          },
          {
            key: "Mod-s",
            run: () => {
              latest.current.onSave();
              return true;
            },
          },
          ...searchKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        autocompletion({
          override: [
            (context) => {
              const word = context.matchBefore(/[A-Za-z_][\w.]*/);
              const line = context.state.doc.lineAt(context.pos);
              const before = context.state.doc.sliceString(
                line.from,
                word?.from ?? context.pos,
              );
              if (
                before.trimStart().startsWith("//") ||
                (before.match(/"/g)?.length ?? 0) % 2
              )
                return null;
              const call = before.match(/\bcall\s+$/);
              if (!word && !context.explicit && !call) return null;
              const expression = /\b(return|let|if)\b/.test(before);
              const options = latest.current
                .completions(
                  positions.current.site(
                    latest.current.checkedText,
                    context.state.doc,
                    context.pos,
                  ),
                )
                .filter((option) =>
                  call
                    ? option.type === "method"
                    : !expression || option.type !== "method",
                )
                .map((option) => {
                  if (!call || typeof option.apply !== "function")
                    return option;
                  const apply = option.apply;
                  return {
                    ...option,
                    apply: (
                      view: EditorView,
                      completion: Completion,
                      from: number,
                      to: number,
                    ) => apply(view, completion, from - call[0].length, to),
                  };
                });
              return { from: word?.from ?? context.pos, options };
            },
          ],
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            positions.current.record(
              update.startState.doc,
              update.state.doc,
              update.changes,
            );
          if (update.selectionSet)
            latest.current.onCursor(update.state.selection.main.from);
          if (update.docChanged && !applying.current)
            latest.current.onChange(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "var(--font-code, 15px)" },
          ".cm-content": {
            fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
            padding: "18px 0",
            lineHeight: "1.65",
          },
          ".cm-scroller": { overflow: "auto" },
          ".cm-gutters": {
            backgroundColor: "#f4f7f8",
            borderRight: "1px solid #e6ecee",
            color: "#5b6e79",
          },
          ".cm-activeLine": { backgroundColor: "#f1f7f7" },
          ".source-finding": {
            backgroundColor: "#ffe5ad",
            borderBottom: "2px solid #df9d32",
          },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    };
    const saved = historyCache.get(props.documentId);
    const state =
      saved && saved.doc === props.value
        ? EditorState.fromJSON(saved, config, { history: historyField })
        : EditorState.create(config);
    const editor = new EditorView({ parent: parent.current, state });
    editor.scrollDOM.tabIndex = 0;
    editor.scrollDOM.setAttribute("role", "region");
    editor.scrollDOM.setAttribute(
      "aria-label",
      "Specification source scroll area",
    );
    view.current = editor;
    latest.current.onActions?.({
      undo: () => {
        undo(editor);
      },
      redo: () => {
        redo(editor);
      },
    });
    return () => {
      latest.current.onActions?.(null);
      historyCache.delete(props.documentId);
      historyCache.set(
        props.documentId,
        editor.state.toJSON({ history: historyField }),
      );
      while (historyCache.size > 20)
        historyCache.delete(historyCache.keys().next().value!);
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) {
      applying.current = true;
      try {
        editor.dispatch({
          changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: props.value,
          },
        });
      } finally {
        applying.current = false;
      }
    }
  }, [props.value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(props.readonly),
        EditorView.editable.of(!props.readonly),
      ]),
    });
  }, [props.readonly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && props.insertion) {
      if (props.readonly || props.insertion.documentId !== props.documentId) {
        props.onInsertionHandled?.(props.insertion.serial);
        return;
      }
      const { from, to } = editor.state.selection.main;
      snippet(props.insertion.template)(editor, null, from, to);
      editor.focus();
      props.onInsertionHandled?.(props.insertion.serial);
    }
  }, [props.insertion, props.readonly, props.documentId]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const range = props.range
      ? {
          from: Math.min(props.range.start, editor.state.doc.length),
          to: Math.min(props.range.end, editor.state.doc.length),
        }
      : null;
    editor.dispatch({
      effects: [
        selected.of(range),
        ...(range
          ? [EditorView.scrollIntoView(range.from, { y: "center" })]
          : []),
      ],
      ...(range ? { selection: { anchor: range.from, head: range.to } } : {}),
    });
  }, [props.range, props.value]);
  return (
    <div
      className="editor"
      ref={parent}
      aria-label={props.readonly ? "Run source snapshot" : "Source editor"}
    />
  );
}
