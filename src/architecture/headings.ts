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
export function architectureHeadings(text: string): ArchitectureHeading[] {
  return architectureMarkdown(text).headings;
}

export const headingRegistryPath = ".pymtheg-heading-identities.json";

export { relationshipText } from "./relationship-text.js";
