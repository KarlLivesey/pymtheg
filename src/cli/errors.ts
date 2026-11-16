// SPDX-License-Identifier: MIT
import { identity } from "../shared/identity.js";
import type { Report } from "../reporting/report.js";
export function invocationMessage(value: unknown): string {
  const message = (
    value instanceof Error ? value.message : String(value)
  ).replace(/^Error:\s*/, "");
  const missing =
    /ENOENT:.*(?:open|lstat|stat|scandir|realpath|mkdir) ['"]([^'"]+)['"]/.exec(
      message,
    );
  if (missing)
    return `File or folder not found: ${missing[1]}. Check the path and try again.`;
  const denied = /EACCES:.*(?:open|lstat|stat|scandir) ['"]([^'"]+)['"]/.exec(
    message,
  );
  if (denied) return `Cannot read ${denied[1]}. Check its access permissions.`;
  return message;
}
export function renderInvocationFailure(report: Report): string {
  const messages = [
    ...new Set(report.diagnostics.map((d) => invocationMessage(d.message))),
  ];
  return (
    messages.map((message) => `${identity.cli}: ${message}\n`).join("") ||
    `${identity.cli}: The requested operation could not complete.\n`
  );
}
