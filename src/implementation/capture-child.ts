// SPDX-License-Identifier: MIT
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { observeTypescript } from "./typescript.js";
import { observationDocuments } from "./storage.js";
import type { ObservedSource } from "./schema.js";

try {
  const lines = createInterface({
    input: createReadStream(process.argv[2]!),
    crlfDelay: Infinity,
  });
  let header:
    | {
        version: Parameters<typeof observeTypescript>[1];
        options: Parameters<typeof observeTypescript>[2];
      }
    | undefined;
  const files: ObservedSource[] = [];
  for await (const line of lines) {
    if (!header) header = JSON.parse(line) as typeof header;
    else files.push(JSON.parse(line) as ObservedSource);
  }
  if (!header) throw Error("Capture input is empty.");
  process.stdout.write("ready\n");
  const documents = observationDocuments(
    observeTypescript(files, header.version, header.options),
  );
  for (const [index, document] of documents.entries())
    await writeFile(join(process.argv[3]!, index + ".json"), document.text, {
      flag: "wx",
    });
  await writeFile(
    join(process.argv[3]!, "receipt.json"),
    JSON.stringify(documents.map((d) => d.path)),
    { flag: "wx" },
  );
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : String(error)) + "\n",
  );
  process.exitCode = 1;
}
