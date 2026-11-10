import { ZodError } from "zod";
/** Keep validation locations and guidance, never dump validator internals. */
export function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return validation(error.issues);
  let message = (
    error instanceof Error ? error.message : String(error)
  ).replace(/^Error:\s*/, "");
  try {
    const issues: unknown = JSON.parse(message);
    if (
      Array.isArray(issues) &&
      issues.length &&
      issues.every(
        (i) =>
          i &&
          typeof i === "object" &&
          Array.isArray(i.path) &&
          typeof i.message === "string",
      )
    )
      return validation(issues);
  } catch {
    /* ordinary error text */
  }
  if (
    /Unexpected (end|token|non-whitespace).*JSON|JSON.*position/i.test(message)
  )
    return "Stored data is not valid JSON. Re-export a healthy version before importing.";
  let imported = false;
  message = message.replace(/Nothing was imported\.\s*(?:Error:\s*)?/g, () => {
    if (imported) return "";
    imported = true;
    return "Nothing was imported. ";
  });
  return message.trim();
}
function validation(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  return (
    "Invalid data: " +
    issues
      .slice(0, 4)
      .map((i) => `${i.path.map(String).join(".") || "request"}: ${i.message}`)
      .join("; ") +
    (issues.length > 4
      ? `; ${issues.length - 4} more validation issues. Fix these fields and preview again.`
      : "")
  );
}
