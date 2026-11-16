// SPDX-License-Identifier: MIT
import { textPage } from "./text-pages.js";
import { agentLimits } from "./limits.js";
import { randomUUID } from "node:crypto";
import { hash, json } from "../shared/identity.js";
import type { Scaffold } from "../contracts/scaffold.js";
export const emissionSections = ["source", "manifest", "details"] as const;
export type EmissionSection = (typeof emissionSections)[number];
export const emissionRetention = {
  records: agentLimits.retainedEmissions,
  bytes: agentLimits.emissionBytes,
  pageCharacters: agentLimits.textPageCharacters,
} as const;
interface Artifact {
  id: string;
  runId: string;
  snapshotId: string;
  format: string;
  extension: string;
  implementation: Scaffold["implementation"];
  assurance: Scaffold["assurance"];
  texts: Record<EmissionSection, string | null>;
  sizes: Record<
    EmissionSection,
    { characters: number; bytes: number; hash: string } | null
  >;
  bytes: number;
  symbols: number;
  omitted: number;
}
const high = (c: number) => c >= 0xd800 && c <= 0xdbff;
const low = (c: number) => c >= 0xdc00 && c <= 0xdfff;
function validText(text: string) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (high(code)) {
      if (!low(text.charCodeAt(++i))) return false;
    } else if (low(code)) return false;
  }
  return true;
}
/** Retains immutable emission text only; reads never execute a language plugin. */
export class EmissionStore {
  private artifacts = new Map<string, Artifact>();
  private retained = 0;
  constructor(
    private limits: { records: number; bytes: number } = emissionRetention,
  ) {
    if (
      !Number.isSafeInteger(limits.records) ||
      limits.records < 1 ||
      !Number.isSafeInteger(limits.bytes) ||
      limits.bytes < 1
    )
      throw Error("Invalid emission retention limits");
  }
  get size() {
    return this.artifacts.size;
  }
  get bytes() {
    return this.retained;
  }
  put(runId: string, emission: Scaffold) {
    if (!validText(emission.source))
      throw Error("Generated source contains invalid Unicode text");
    const texts: Artifact["texts"] = {
      source: emission.source,
      manifest: emission.contractManifest
        ? json(emission.contractManifest)
        : null,
      details: json({
        symbols: emission.symbols,
        notes: emission.notes,
        dependencies: emission.dependencies,
        omitted: emission.omitted,
      }),
    };
    const sizes: Artifact["sizes"] = {
      source: null,
      manifest: null,
      details: null,
    };
    let bytes = 0;
    for (const section of emissionSections) {
      const text = texts[section];
      if (text === null) continue;
      const length = Buffer.byteLength(text);
      bytes += length;
      sizes[section] = {
        characters: text.length,
        bytes: length,
        hash: hash(text),
      };
    }
    if (bytes > this.limits.bytes)
      throw Error(
        "Generated output exceeds the 32 MiB MCP retention budget. Export it through the CLI.",
      );
    while (
      this.artifacts.size >= this.limits.records ||
      this.retained + bytes > this.limits.bytes
    ) {
      const oldest = this.artifacts.keys().next().value;
      if (oldest === undefined) break;
      this.retained -= this.artifacts.get(oldest)!.bytes;
      this.artifacts.delete(oldest);
    }
    const artifact: Artifact = {
      id: randomUUID(),
      runId,
      snapshotId: emission.snapshotId,
      format: emission.format,
      extension: emission.extension,
      implementation: emission.implementation,
      assurance: emission.assurance,
      texts,
      sizes,
      bytes,
      symbols: emission.symbols.length,
      omitted: emission.omitted.length,
    };
    this.artifacts.set(artifact.id, artifact);
    this.retained += bytes;
    return this.describe(artifact);
  }
  private describe(artifact: Artifact) {
    return {
      emissionId: artifact.id,
      runId: artifact.runId,
      snapshotId: artifact.snapshotId,
      format: artifact.format,
      extension: artifact.extension,
      implementation: artifact.implementation,
      assurance: artifact.assurance,
      sections: artifact.sizes,
      symbolCount: artifact.symbols,
      omittedCount: artifact.omitted,
    };
  }
  read(
    id: string,
    section: EmissionSection,
    offset = 0,
    limit: number = emissionRetention.pageCharacters,
  ) {
    const artifact = this.artifacts.get(id);
    if (!artifact)
      throw Error(
        "Generated artifact expired or does not belong to this session. Call emit_scaffold again; recheck the source first if its run has expired.",
      );
    const text = artifact.texts[section],
      size = artifact.sizes[section];
    if (text === null || !size)
      throw Error("This generated artifact has no " + section + " section");
    return {
      ...this.describe(artifact),
      section,
      ...textPage(text, offset, limit),
      totalCharacters: size.characters,
      totalBytes: size.bytes,
      contentHash: size.hash,
    };
  }
  clear() {
    this.artifacts.clear();
    this.retained = 0;
  }
}
