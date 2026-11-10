import { isAbsolute, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { parse } from "../language/parser.js";
import { hash } from "../shared/identity.js";
import { decodeUtf8 } from "../shared/text.js";
import { readSourceBytesSync } from "../shared/source-read.js";
import { searchInterfaces } from "./interface-search.js";
import {
  declarationTypeQuerySchema,
  type DeclarationTypeInventory,
} from "./declaration-type-protocol.js";
export interface DeclarationTypeInput {
  file: string;
  text?: string;
}
/** Discovery uses the real parser, but a candidate is not a typechecked contract. */
export function declarationTypeInventory(
  root: string,
  inputs: DeclarationTypeInput[],
  warnings: string[] = [],
): DeclarationTypeInventory {
  const items: DeclarationTypeInventory["items"] = [],
    notes = warnings.slice(0, 100),
    sources: string[] = [];
  let bytes = 0,
    parsedFiles = 0,
    complete = warnings.length === 0,
    metadataBytes = 0,
    metadataStopped = false;
  function warn(message: string) {
    complete = false;
    if (notes.length < 100) notes.push(message);
  }
  for (const input of inputs.slice(0, 10000)) {
    const path = resolve(root, input.file),
      file = relative(root, path).split("\\").join("/");
    if (isAbsolute(file) || file === ".." || file.startsWith("../")) {
      warn("A type source was outside the project and was not read.");
      continue;
    }
    try {
      if (input.text === undefined && realpathSync(path) !== path) {
        warn(file + ": linked or moved source was not read.");
        continue;
      }
      const text = input.text ?? decodeUtf8(readSourceBytesSync(path), file),
        size = Buffer.byteLength(text);
      if (size > 2 * 1024 * 1024) {
        warn(file + ": source exceeds 2 MiB.");
        continue;
      }
      if (bytes + size > 32 * 1024 * 1024) {
        warn(
          "Type search reached its 32 MiB source budget. Narrow the source set.",
        );
        break;
      }
      bytes += size;
      const sourceHash = hash(text),
        parsed = parse(path, text);
      parsedFiles++;
      sources.push(file + "\0" + sourceHash);
      if (parsed.diagnostics.length)
        warn(
          file +
            ": syntax errors may hide types; correct the file before using its definitions.",
        );
      const declarations = parsed.declarations.filter(
        (d) => d.kind === "type" || d.kind === "resource",
      );
      const counts = new Map<string, number>();
      for (const d of parsed.declarations)
        counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
      for (const d of declarations) {
        const symbolId = file + "#" + d.name;
        metadataBytes += Buffer.byteLength(
          symbolId + file + d.name + sourceHash,
        );
        if (items.length >= 100000 || metadataBytes > 16 * 1024 * 1024) {
          warn(
            "Type search reached its metadata budget. Narrow the source set.",
          );
          metadataStopped = true;
          break;
        }
        items.push({
          name: d.name,
          symbolId,
          file,
          sourceHash,
          kind:
            d.kind === "resource"
              ? "resource"
              : d.kind === "type" && d.fields === null
                ? "choice"
                : "record",
          status:
            (counts.get(d.name) ?? 0) > 1
              ? "duplicate"
              : parsed.diagnostics.length
                ? "syntax-incomplete"
                : "candidate",
        });
      }
      if (metadataStopped) break;
    } catch (error) {
      warn(
        file +
          ": could not read type definitions (" +
          (error instanceof Error ? error.message : String(error)) +
          ").",
      );
    }
  }
  if (inputs.length > 10000)
    warn(
      "Type search covers the first 10,000 source files. Narrow the source set.",
    );
  return {
    id: hash(JSON.stringify({ sources, notes })),
    items,
    complete,
    warnings: notes,
    parsedFiles,
    bytes,
    meaning:
      "Types found in source files. Preview checks the selected definitions and imports; this list is not verification evidence.",
  };
}
export function declarationTypePage(
  inventory: DeclarationTypeInventory,
  value: unknown,
) {
  const query = declarationTypeQuerySchema.parse(value);
  const all = searchInterfaces(
    inventory.items.filter(
      (item) => query.kind === "all" || item.kind === query.kind,
    ),
    query.query,
    "",
  );
  const items = all.slice(query.offset, query.offset + query.limit);
  return {
    ...inventory,
    id: undefined,
    inventoryId: inventory.id,
    items,
    total: all.length,
    offset: query.offset,
    nextOffset:
      query.offset + items.length < all.length
        ? query.offset + items.length
        : null,
  };
}
