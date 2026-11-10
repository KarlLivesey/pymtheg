import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
/** Route only test artifacts; fixtures and application paths are unchanged. */
export function browserEvidence(path) {
  const root = process.env.PYM_BROWSER_EVIDENCE_DIR;
  if (!root) return path;
  const target = join(root, path.replace(/^evidence\//, ""));
  mkdirSync(dirname(target), { recursive: true });
  return target;
}
