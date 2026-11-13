import { SqliteGraphStore } from "../graph/store.js";
import { storagePath } from "./local.js";

/** Project graph entry point; the core's explicit-path interface remains intact. */
export function openProjectGraph(
  root: string,
  projectId: string,
): SqliteGraphStore {
  return new SqliteGraphStore(storagePath(root, "graph", true), projectId);
}
