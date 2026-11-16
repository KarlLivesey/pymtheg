// SPDX-License-Identifier: MIT
import { isAbsolute, relative, sep, win32 } from "node:path";
/** Only machine-generated provenance labels are normalized; authored document text is never rewritten. */
export function sharedSourceLabel(root: string, source: string): string {
  if (!isAbsolute(source) && !win32.isAbsolute(source)) return source;
  const path = relative(root, source);
  if (
    (win32.isAbsolute(source) && !isAbsolute(source)) ||
    path === ".." ||
    path.startsWith(".." + sep)
  )
    return "External source (machine-local location omitted)";
  return path.split(sep).join("/") || ".";
}
/** New draft locations may be absolute on input, but shared storage never retains a local root. */
export function sharedProjectPath(root: string, path: string): string {
  if (!path) return path; // An unanswered draft path remains unanswered.
  const candidate = isAbsolute(path)
    ? relative(root, path).split(sep).join("/")
    : path;
  if (
    !candidate ||
    candidate === "." ||
    win32.isAbsolute(candidate) ||
    isAbsolute(candidate) ||
    candidate.includes("\\") ||
    candidate.includes("\0") ||
    candidate.split("/").includes("..")
  )
    throw Error(
      "Shared paths must stay inside the project and use relative POSIX paths",
    );
  return candidate;
}
