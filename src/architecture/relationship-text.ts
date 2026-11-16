// SPDX-License-Identifier: MIT
/** Advisory Markdown relationship comparison. Exact evidence hashes remain byte-sensitive. */
export function relationshipText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"),
    output: string[] = [];
  let fence: { character: string; length: number } | null = null,
    html: string | null = null,
    inlineOpen = false,
    paragraph = "",
    previousIndented = false;
  const flush = () => {
    if (paragraph) {
      output.push(paragraph);
      paragraph = "";
    }
  };
  const indented = (line: string) => /^(?: {4}|\t)/.test(line);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!,
      marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      output.push(line);
      if (
        marker &&
        marker[1]![0] === fence.character &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = null;
      continue;
    }
    if (html) {
      output.push(line);
      if (new RegExp(`</${html}\\s*>`, "i").test(line)) html = null;
      continue;
    }
    if (inlineOpen) {
      output.push(line);
      if ((line.match(/`+/g)?.length ?? 0) % 2) inlineOpen = false;
      continue;
    }
    if (marker) {
      flush();
      fence = { character: marker[1]![0]!, length: marker[1]!.length };
      output.push(line.trimEnd());
      previousIndented = false;
      continue;
    }
    const rawTag = /<(pre|script|style|textarea)(?:\s|>)/i.exec(line);
    if (rawTag) {
      flush();
      output.push(line);
      if (!new RegExp(`</${rawTag[1]}\\s*>`, "i").test(line)) html = rawTag[1]!;
      previousIndented = false;
      continue;
    }
    if (!line.trim()) {
      flush();
      let end = i;
      while (end + 1 < lines.length && !lines[end + 1]!.trim()) end++;
      if (
        previousIndented &&
        end + 1 < lines.length &&
        indented(lines[end + 1]!)
      )
        output.push(...lines.slice(i, end + 1));
      else if (output.length && output.at(-1) !== "") output.push("");
      i = end;
      continue;
    }
    if (indented(line)) {
      flush();
      output.push(line);
      previousIndented = true;
      continue;
    }
    previousIndented = false;
    const ticks = line.match(/`+/g)?.length ?? 0;
    if (ticks % 2) {
      flush();
      output.push(line);
      inlineOpen = true;
      continue;
    }
    if (
      /^ {0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>|(?:---+|\*\*\*+|___+)\s*$)/.test(
        line,
      ) ||
      /[|<>]/.test(line)
    ) {
      flush();
      output.push(line.trimEnd());
      continue;
    }
    paragraph += (paragraph ? " " : "") + line.trim();
  }
  flush();
  if (!fence && !html && !inlineOpen) while (output.at(-1) === "") output.pop();
  return output.join("\n");
}
