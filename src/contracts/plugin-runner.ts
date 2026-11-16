// SPDX-License-Identifier: MIT
import { decodeUtf8 } from "../shared/text.js";
import { pathToFileURL } from "node:url";
// The coordinator owns the deadline, including unresolved module initialisation.
const keepAlive = setInterval(() => {}, 60000);
try {
  const plugin: unknown = await import(pathToFileURL(process.argv[2]!).href);
  if (
    !plugin ||
    typeof plugin !== "object" ||
    !("apiVersion" in plugin) ||
    plugin.apiVersion !== "pymtheg.emitter/v1" ||
    !("emit" in plugin) ||
    typeof plugin.emit !== "function"
  )
    throw Error("Plugin must implement pymtheg.emitter/v1 and export emit");
  const metadata = {
    apiVersion: plugin.apiVersion,
    target: "target" in plugin ? plugin.target : null,
    extension: "extension" in plugin ? plugin.extension : null,
  };
  if (process.argv[3] === "--metadata") {
    process.stdout.write(JSON.stringify(metadata));
  } else {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 8 * 1024 * 1024) throw Error("Contract input exceeds 8 MiB");
      chunks.push(data);
    }
    const document: unknown = JSON.parse(
      decodeUtf8(Buffer.concat(chunks, bytes), "Contract input"),
    );
    if (
      !document ||
      typeof document !== "object" ||
      !("schema" in document) ||
      document.schema !== "pymtheg.contracts/v1"
    )
      throw Error("Unsupported contract document");
    const emitted: unknown = await plugin.emit(document);
    process.stdout.write(
      JSON.stringify({
        target: metadata.target,
        extension: metadata.extension,
        output: emitted,
      }),
    );
  }
} catch (error) {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
} finally {
  clearInterval(keepAlive);
}
