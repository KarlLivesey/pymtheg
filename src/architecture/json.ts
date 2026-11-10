/** Retained foreign JSON is data. Keep numbers that JS cannot represent exactly
 * as explicit literal records for display; never silently round them. */
export function parseArchitectureJson(text: string): {
  value: unknown;
  exactNumbers: number;
} {
  let exactNumbers = 0;
  const value: unknown = JSON.parse(
    text.startsWith("\uFEFF") ? text.slice(1) : text,
    (_key: string, value: unknown, context?: { source?: string }) => {
      if (
        typeof value === "number" &&
        (!Number.isSafeInteger(value) || Object.is(value, -0))
      ) {
        if (typeof context?.source !== "string")
          throw Error(
            "Exact JSON numeric literals require the supported Node runtime",
          );
        exactNumbers++;
        return { $exactNumber: context.source };
      }
      return value;
    },
  );
  return { value, exactNumbers };
}
