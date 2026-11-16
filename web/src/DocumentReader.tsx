// SPDX-License-Identifier: MIT
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { documentLink } from "../../src/studio/document-links";
import { textPage, textPageCharacters } from "../../src/shared/text-pages";

export function DocumentReader({
  path,
  text,
  paths,
  fragment,
  onOpen,
}: {
  path: string;
  text: string;
  paths: ReadonlySet<string>;
  fragment?: string;
  onOpen: (path: string, fragment?: string) => void;
}) {
  const markdown = /\.(md|markdown)$/i.test(path);
  const [source, setSource] = useState(!markdown);
  const [offsets, setOffsets] = useState([0]);
  const [notice, setNotice] = useState("");
  const page = textPage(text, offsets.at(-1)!, textPageCharacters);
  const preview = useMemo(() => {
    let end = Math.min(text.length, 128000);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    return text.slice(0, end);
  }, [text]);
  const reader = useRef<HTMLElement | null>(null);
  // Generated DOM anchors belong to this reading view, not architecture identities.
  const slug = (children: unknown): string => {
    const content = (value: unknown): string => {
      if (typeof value === "string" || typeof value === "number")
        return String(value);
      if (Array.isArray(value)) return value.map(content).join("");
      if (value && typeof value === "object" && "props" in value)
        return content(
          (value as { props: { children?: unknown } }).props.children,
        );
      return "";
    };
    const base =
      content(children)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "") || "section";
    return base;
  };
  function goToFragment(fragment: string) {
    if (!fragment) {
      reader.current?.scrollIntoView({ block: "start" });
      setNotice("");
      return;
    }
    for (const element of reader.current?.querySelectorAll<HTMLElement>(
      "[id]",
    ) ?? [])
      if (element.id === fragment) {
        element.scrollIntoView({ block: "start" });
        element.focus();
        setNotice("");
        return;
      }
    const used = new Set<string>();
    for (const heading of reader.current?.querySelectorAll<HTMLElement>(
      "[data-fragment]",
    ) ?? []) {
      const base = heading.dataset.fragment!;
      let candidate = base,
        suffix = 2;
      while (used.has(candidate)) candidate = `${base}-${suffix++}`;
      used.add(candidate);
      if (candidate === fragment) {
        heading.scrollIntoView({ block: "start" });
        heading.focus();
        setNotice("");
        return;
      }
    }
    setNotice(
      `Section “${fragment}” is not in the reading preview. Use Exact source to find it.`,
    );
  }
  useEffect(() => {
    if (fragment && !source) goToFragment(fragment);
  }, [fragment, source, text]);
  return (
    <section className="document-reader" aria-label="Retained document">
      <div className="document-reader-toolbar">
        {markdown && (
          <div role="group" aria-label="Document view">
            <button
              type="button"
              className="button secondary"
              aria-pressed={!source}
              onClick={() => setSource(false)}
            >
              Read document
            </button>
            <button
              type="button"
              className="button secondary"
              aria-pressed={source}
              onClick={() => setSource(true)}
            >
              Exact source
            </button>
          </div>
        )}
        <button
          type="button"
          className="text-link"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([text], { type: "text/plain;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = path.split("/").at(-1)!;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download original
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {source ? (
        <>
          <p className="muted">
            Original source · characters {page.offset + (text.length ? 1 : 0)}–
            {page.offset + page.text.length} of {text.length}
          </p>
          <pre className="architecture-document">{page.text}</pre>
          {text.length > textPageCharacters && (
            <div className="document-reader-toolbar">
              <button
                type="button"
                className="button secondary"
                disabled={offsets.length === 1}
                onClick={() => setOffsets((previous) => previous.slice(0, -1))}
              >
                Previous source page
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={page.nextOffset === null}
                onClick={() => {
                  if (page.nextOffset !== null)
                    setOffsets((previous) => [...previous, page.nextOffset!]);
                }}
              >
                Next source page
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {preview.length < text.length && (
            <p className="notice">
              Reading preview shows the first {preview.length.toLocaleString()}{" "}
              of {text.length.toLocaleString()} characters. Exact source pages
              and the download contain the complete document.
            </p>
          )}
          <article ref={reader} className="document-prose">
            <Markdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(url) => url}
              components={{
                img: ({ alt }) => (
                  <span className="document-image-note">
                    [Image: {alt || "no description"}; remote content is not
                    loaded]
                  </span>
                ),
                a: ({ href, children }) => {
                  const target = documentLink(path, href ?? "", paths);
                  if (target.kind === "external")
                    return (
                      <a
                        href={target.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                        <span className="sr-only"> (opens externally)</span>
                      </a>
                    );
                  if (target.kind === "unavailable")
                    return (
                      <span title={target.reason}>
                        {children} <small>({target.reason})</small>
                      </span>
                    );
                  return (
                    <a
                      href={"#" + target.fragment}
                      onClick={(event) => {
                        event.preventDefault();
                        if (target.path !== path) {
                          onOpen(target.path, target.fragment);
                          return;
                        }
                        goToFragment(target.fragment);
                      }}
                    >
                      {children}
                    </a>
                  );
                },
                h1: ({ node, children }) => (
                  <h2
                    id={"reader-" + node?.position?.start.offset}
                    data-fragment={slug(children)}
                    tabIndex={-1}
                  >
                    {children}
                  </h2>
                ),
                h2: ({ node, children }) => (
                  <h3
                    id={"reader-" + node?.position?.start.offset}
                    data-fragment={slug(children)}
                    tabIndex={-1}
                  >
                    {children}
                  </h3>
                ),
                h3: ({ node, children }) => (
                  <h4
                    id={"reader-" + node?.position?.start.offset}
                    data-fragment={slug(children)}
                    tabIndex={-1}
                  >
                    {children}
                  </h4>
                ),
                h4: ({ node, children }) => (
                  <h5
                    id={"reader-" + node?.position?.start.offset}
                    data-fragment={slug(children)}
                    tabIndex={-1}
                  >
                    {children}
                  </h5>
                ),
                h5: ({ node, children }) => (
                  <h6
                    id={"reader-" + node?.position?.start.offset}
                    data-fragment={slug(children)}
                    tabIndex={-1}
                  >
                    {children}
                  </h6>
                ),
                h6: ({ node, children }) => (
                  <h6
                    id={"reader-" + node?.position?.start.offset}
                    data-fragment={slug(children)}
                    tabIndex={-1}
                  >
                    {children}
                  </h6>
                ),
                table: ({ children }) => (
                  <div
                    className="document-table"
                    tabIndex={0}
                    role="region"
                    aria-label="Document table"
                  >
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {preview}
            </Markdown>
          </article>
        </>
      )}
    </section>
  );
}
