export const observationSource = "Code observation";
export const implementationLinkSource = "Implementation link";
export const implementationUnlinkSource = "Implementation link removed";
export function versionCategory(source: string): "design" | "code" | "links" {
  return source === observationSource
    ? "code"
    : source === implementationLinkSource ||
        source === implementationUnlinkSource
      ? "links"
      : "design";
}
