// SPDX-License-Identifier: MIT
/** Resolve a rendered link only within retained documents or explicit safe URLs. */
export type DocumentLink =
  | { kind: "document"; path: string; fragment: string }
  | { kind: "external"; href: string }
  | { kind: "unavailable"; reason: string };
export function documentLink(
  current: string,
  href: string,
  documents: ReadonlySet<string>,
): DocumentLink {
  const unavailable = (reason: string): DocumentLink => ({
    kind: "unavailable",
    reason,
  });
  if (!href || href.length > 8192) return unavailable("No usable link target");
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//"))
    return unavailable(
      "This link protocol is not supported in the document reader",
    );
  const separator = href.indexOf("#");
  let target: string, fragment: string;
  try {
    target = decodeURIComponent(
      separator < 0 ? href : href.slice(0, separator),
    );
    fragment = decodeURIComponent(
      separator < 0 ? "" : href.slice(separator + 1),
    );
  } catch {
    return unavailable("This link contains an invalid encoded address");
  }
  if (/[\\\u0000-\u001f]/.test(target) || target.includes("?"))
    return unavailable("This link is not a retained document path");
  const parts = target.startsWith("/") ? [] : current.split("/").slice(0, -1);
  if (!target) parts.push(current.split("/").at(-1)!);
  else
    for (const part of target.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length)
          return unavailable(
            "This link leaves the retained document collection",
          );
        parts.pop();
      } else parts.push(part);
    }
  const path = parts.join("/");
  return documents.has(path)
    ? { kind: "document", path, fragment }
    : unavailable(`Not retained in this revision: ${path}`);
}
