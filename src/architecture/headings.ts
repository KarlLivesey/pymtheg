import { hash } from "../shared/identity.js";
export interface ArchitectureHeading {
  line: number;
  end: number;
  level: number;
  title: string;
  slug: string;
  key: string;
  anchor?: string;
  bodyHash: string;
  hasBody: boolean;
  text: string;
}
/** Compact declared IDs, including custom prefixes and child suffixes; numbered prose is not an ID. */
export function headingIdentifier(title: string): string | undefined {
  return /^([A-Za-z][A-Za-z_]*-?\d+(?:[-._][A-Za-z0-9]+)*)(?=$|[\s:—–])/.exec(
    title,
  )?.[1];
}
/** ATX headings outside fenced code; section spans include all child sections. */
export interface ArchitectureGeneric {
  name: string;
  parameters: string[];
  line: number;
  text: string;
}
export function architectureMarkdown(text: string): {
  headings: ArchitectureHeading[];
  generics: ArchitectureGeneric[];
} {
  const lines = text.split("\n"),
    headers: {
      line: number;
      level: number;
      title: string;
      slug: string;
      key: string;
      anchor?: string;
    }[] = [],
    counts = new Map<string, number>(),
    generics: ArchitectureGeneric[] = [];
  let fence: { character: string; length: number } | null = null,
    pendingAnchor: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!,
      marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence.character &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = null;
      continue;
    }
    if (marker) {
      fence = { character: marker[1]![0]!, length: marker[1]!.length };
      pendingAnchor = undefined;
      continue;
    }
    const html = /^\s*<a\s+id=["']([A-Za-z0-9_.:-]+)["']\s*>\s*<\/a>\s*$/.exec(
      line,
    );
    if (html) {
      pendingAnchor = html[1];
      continue;
    }
    if (/^\s*Generics(?:\s+are)?\s+(?:closed|declared):/i.test(line)) {
      for (const code of line.matchAll(/`([^`]+)`/g)) {
        const declaration =
          /^([A-Za-z_][A-Za-z_0-9]*)[<\[]([A-Z][A-Za-z_0-9]*(?:\s*,\s*[A-Z][A-Za-z_0-9]*)*)[>\]]$/.exec(
            code[1]!.trim(),
          );
        if (declaration)
          generics.push({
            name: declaration[1]!,
            parameters: declaration[2]!.split(",").map((p) => p.trim()),
            line: i,
            text: line,
          });
      }
    }
    const match = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (!match) {
      if (line.trim()) pendingAnchor = undefined;
      continue;
    }
    const explicit = /\s+\{#([A-Za-z0-9_.:-]+)\}\s*$/.exec(match[2]!),
      title = explicit ? match[2]!.slice(0, explicit.index).trim() : match[2]!,
      anchor = explicit?.[1] ?? pendingAnchor;
    pendingAnchor = undefined;
    const base =
        title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "section",
      count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const key = headingIdentifier(title) ?? title;
    headers.push({
      line: i,
      level: match[1]!.length,
      title,
      slug: base + (count ? "-" + count : ""),
      key,
      ...(anchor ? { anchor } : {}),
    });
  }
  const ends = headers.map(() => lines.length),
    open: number[] = [];
  headers.forEach((heading, i) => {
    while (
      open.length &&
      headers[open[open.length - 1]!]!.level >= heading.level
    )
      ends[open.pop()!] = heading.line;
    open.push(i);
  });
  return {
    generics,
    headings: headers.map((heading, i) => ({
      ...heading,
      end: ends[i]!,
      bodyHash: hash(lines.slice(heading.line + 1, ends[i]).join("\n")),
      hasBody: !!lines
        .slice(heading.line + 1, ends[i])
        .join("\n")
        .trim(),
      text: lines.slice(heading.line, ends[i]).join("\n"),
    })),
  };
}
/** RST adornment styles define levels in first-seen order; originals stay lossless. */
export function architectureHeadings(
  text: string,
  path = "document.md",
): ArchitectureHeading[] {
  if (!/\.rst$/i.test(path)) return architectureMarkdown(text).headings;
  const lines = text.split("\n"),
    styles = new Map<string, number>(),
    counts = new Map<string, number>(),
    headers: {
      line: number;
      titleLine: number;
      level: number;
      title: string;
      slug: string;
      key: string;
    }[] = [];
  const adornment = (line: string) =>
    /^([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])\1{1,}\s*$/.exec(line)?.[1];
  let previousUnderline = -1;
  for (let i = 0; i + 1 < lines.length; i++) {
    const rawTitle = lines[i]!.replace(/\r$/, ""),
      title = rawTitle.trim(),
      underline = lines[i + 1]!.replace(/\r$/, ""),
      character = adornment(underline);
    if (
      !title ||
      adornment(rawTitle) ||
      !character ||
      /^[*+-]\s/.test(title) ||
      underline.trimEnd() === "::"
    )
      continue;
    const overline =
      i > 0 &&
      i - 1 !== previousUnderline &&
      adornment(lines[i - 1]!) === character &&
      lines[i - 1]!.trimEnd().length === underline.trimEnd().length;
    if (
      (/^\s/.test(rawTitle) && !overline) ||
      (underline.trimEnd().length < title.length &&
        underline.trimEnd().length < 4)
    )
      continue;
    const start = overline ? i - 1 : i;
    // A section may immediately follow a heading's underline. Other prose
    // still needs a block boundary; indented literal/directive content is ignored.
    if (
      start > 0 &&
      lines[start - 1]!.trim() &&
      start - 1 !== previousUnderline
    )
      continue;
    previousUnderline = i + 1;
    const style = character + (overline ? "overline" : "underline");
    if (!styles.has(style)) styles.set(style, styles.size + 1);
    const base =
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "") || "section";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    headers.push({
      line: start,
      titleLine: i,
      level: Math.min(styles.get(style)!, 6),
      title,
      slug: base + (count ? "-" + count : ""),
      key: headingIdentifier(title) ?? title,
    });
    i++;
  }
  const ends = headers.map(() => lines.length),
    open: number[] = [];
  headers.forEach((heading, i) => {
    while (
      open.length &&
      headers[open[open.length - 1]!]!.level >= heading.level
    )
      ends[open.pop()!] = heading.line;
    open.push(i);
  });
  return headers.map(({ titleLine, ...heading }, i) => {
    const end = ends[i]!;
    const body = lines.slice(titleLine + 2, end).join("\n");
    return {
      ...heading,
      end,
      text: lines.slice(heading.line, end).join("\n"),
      bodyHash: hash(body),
      hasBody: !!body.trim(),
    };
  });
}

export const headingRegistryPath = ".pymtheg-heading-identities.json";

export { relationshipText } from "./relationship-text.js";
