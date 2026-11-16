// SPDX-License-Identifier: MIT
import { randomUUID } from "node:crypto";
import { hash, json } from "../shared/identity.js";
import { agentLimits } from "./limits.js";
import { textPage } from "./text-pages.js";
import type { ProjectView } from "../studio/protocol.js";
export const inventorySections = [
  "summary",
  "files",
  "warnings",
  "scenario_names",
  "configuration",
] as const;
export type InventorySection = (typeof inventorySections)[number];
export interface InventoryQuery {
  section?: InventorySection | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
  query?: string | undefined;
}
type File = Readonly<{
  path: string;
  hash: string;
  characters: number;
  loaded: boolean;
}>;
function preview(value: string): string {
  return value.length <= 240 ? value : textPage(value, 0, 240).text + "…";
}
interface Inventory {
  id: string;
  root: string;
  workspace: ProjectView["workspace"];
  files: File[];
  warnings: string[];
  names: string[];
  configuration: string;
  scenarioText: string;
  configurationHash: string;
  configurationFileHash: string | null;
  bytes: number;
}
function page<T>(
  rows: readonly T[],
  offset: number,
  limit: number,
  budget = 96 * 1024,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > rows.length ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw Error("Choose a valid item offset and a page of 1–100 items");
  const items: T[] = [];
  let bytes = 0;
  for (let i = offset; i < Math.min(rows.length, offset + limit); i++) {
    const item = rows[i]!,
      size = Buffer.byteLength(json(item));
    if (bytes + size > budget) {
      if (!items.length)
        throw Error(
          "One inventory item exceeds its response budget; inspect its source directly",
        );
      break;
    }
    bytes += size;
    items.push(item);
  }
  return {
    items,
    total: rows.length,
    offset,
    nextOffset:
      offset + items.length < rows.length ? offset + items.length : null,
  };
}
/** Frozen browsing metadata. Checking and source reads still load their own current snapshots. */
export class ProjectInventories {
  private snapshots = new Map<string, Inventory>();
  private bytes = 0;
  capture(
    project: Pick<
      ProjectView,
      | "root"
      | "workspace"
      | "files"
      | "inventoryWarnings"
      | "config"
      | "configHash"
    >,
  ) {
    const files = project.files.map(({ path, hash, text, loaded }) =>
      Object.freeze({
        path,
        hash,
        characters: text.length,
        loaded: loaded !== false,
      }),
    );
    const warnings = [...(project.inventoryWarnings ?? [])],
      names = Object.keys(project.config.scenarios).sort();
    const configuration = json(project.config),
      scenarioText = json(project.config.scenarios);
    const bytes =
      Buffer.byteLength(json({ files, warnings, names })) +
      Buffer.byteLength(configuration) +
      Buffer.byteLength(scenarioText);
    if (bytes > agentLimits.inventoryBytes)
      throw Error(
        "Inventory metadata exceeds 32 MiB. Narrow the configured source roots.",
      );
    while (
      this.snapshots.size >= agentLimits.retainedInventories ||
      this.bytes + bytes > agentLimits.inventoryBytes
    ) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.snapshots.get(oldest)!.bytes;
      this.snapshots.delete(oldest);
    }
    const snapshot: Inventory = {
      id: randomUUID(),
      root: project.root,
      workspace: project.workspace
        ? Object.freeze({ ...project.workspace })
        : null,
      files,
      warnings,
      names,
      configuration,
      scenarioText,
      configurationHash: hash(configuration),
      configurationFileHash: project.configHash ?? null,
      bytes,
    };
    this.snapshots.set(snapshot.id, snapshot);
    this.bytes += bytes;
    return snapshot.id;
  }
  read(id: string, options: InventoryQuery = {}) {
    const inventory = this.snapshots.get(id);
    if (!inventory)
      throw Error(
        "Inventory expired or belongs to another session. Call project_info without inventoryId to capture the current project.",
      );
    const section = options.section ?? "summary",
      offset = options.offset ?? 0,
      limit =
        options.limit ??
        (section === "configuration" ? agentLimits.textPageCharacters : 100),
      query = (options.query ?? "").toLowerCase();
    const common = {
      inventoryId: id,
      root: inventory.root,
      workspace: inventory.workspace,
      configurationHash: inventory.configurationHash,
      configurationFileHash: inventory.configurationFileHash,
      inventoryMeaning:
        "Captured browsing metadata. read_source and check_design read current source independently.",
    };
    if (section === "configuration")
      return {
        ...common,
        section,
        ...textPage(inventory.configuration, offset, limit),
        totalCharacters: inventory.configuration.length,
        contentHash: inventory.configurationHash,
      };
    if (section === "warnings") {
      const selected = page(
        inventory.warnings.filter((w) => w.toLowerCase().includes(query)),
        offset,
        limit,
      );
      return {
        ...common,
        section,
        inventoryWarnings: selected.items,
        totalWarnings: selected.total,
        offset,
        nextOffset: selected.nextOffset,
      };
    }
    if (section === "scenario_names") {
      const matching = inventory.names.filter((n) =>
        n.toLowerCase().includes(query),
      );
      const selected = page(matching.map(preview), offset, limit);
      return {
        ...common,
        section,
        scenarioNames: selected.items,
        scenarioNamesTruncated: matching
          .slice(offset, offset + selected.items.length)
          .some((n) => n.length > 240),
        fullNamesLocation: "configuration",
        totalScenarios: selected.total,
        offset,
        nextOffset: selected.nextOffset,
      };
    }
    const selected = page(
      inventory.files.filter((f) => f.path.toLowerCase().includes(query)),
      offset,
      limit,
    );
    const fileInfo = {
      ...common,
      section,
      files: selected.items,
      totalFiles: inventory.files.length,
      matchingFiles: selected.total,
      offset,
      nextOffset: selected.nextOffset,
    };
    if (section === "files") return fileInfo;
    const warnings = page(inventory.warnings.map(preview), 0, 20, 32 * 1024),
      names = page(inventory.names.map(preview), 0, 20, 32 * 1024);
    return {
      ...fileInfo,
      inventoryWarnings: warnings.items,
      warningPreviewsTruncated: inventory.warnings
        .slice(0, warnings.items.length)
        .some((w) => w.length > 240),
      totalWarnings: warnings.total,
      nextWarningOffset: warnings.nextOffset,
      totalScenarios: inventory.names.length,
      scenarioNames: names.items,
      scenarioNamesTruncated: inventory.names
        .slice(0, names.items.length)
        .some((n) => n.length > 240),
      fullNamesLocation: "configuration",
      nextScenarioOffset: names.nextOffset,
      ...(Buffer.byteLength(inventory.scenarioText) <= 32 * 1024
        ? { scenarios: JSON.parse(inventory.scenarioText) as unknown }
        : { configurationRequiresPaging: true }),
    };
  }
  clear() {
    this.snapshots.clear();
    this.bytes = 0;
  }
  get size() {
    return this.snapshots.size;
  }
}
