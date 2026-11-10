import {
  validateInterfaceType,
  type InterfaceType,
} from "./interface-builder.js";

/** Readable draft text, never source generation or an assertion of completeness. */
export function describeDraftType(
  value: InterfaceType,
  options: { expandDefinitions?: boolean } = {},
): string {
  try {
    validateInterfaceType(value, { draft: true });
  } catch {
    return "unavailable type";
  }
  const describe = (type: InterfaceType): string => {
    if (typeof type === "string") return type;
    switch (type.kind) {
      case "unselected":
        return "type not chosen";
      case "named":
        return type.name || "named type not chosen";
      case "list":
        return `List<${describe(type.element)}>`;
      case "result":
        return `Result<${describe(type.ok)}, ${describe(type.error)}>`;
      case "record":
        return options.expandDefinitions
          ? `${type.name || "Unnamed record"} { ${type.fields.map((field) => `${field.name || "Unnamed field"}: ${describe(field.type)}`).join(", ")} }`
          : type.name || "Unnamed record";
      case "choice":
        return options.expandDefinitions
          ? `${type.name || "Unnamed outcomes"} (${type.variants.map((variant) => (variant.name || "Unnamed outcome") + (variant.payload === undefined ? "" : ` carrying ${describe(variant.payload)}`)).join(" | ")})`
          : type.name || "Unnamed outcomes";
    }
  };
  return describe(value);
}
