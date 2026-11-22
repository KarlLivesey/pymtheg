// The synthetic module, resolving through a name map it keeps between runs
// of an index session (C-45, C-48): a stale map would resolve differently
// from a cold index.
import { module as synthetic } from "../graph-core/synthetic.mjs";
export const keepingModule = {
  ...synthetic,
  id: "keeping",
  resolve(context) {
    const key = context.symbols.map((s) => s.id).join(",");
    let named = context.kept?.get("names", key);
    if (!named) named = new Map(context.symbols.map((s) => [s.name, s.id]));
    context.kept?.set("names", key, named);
    return {
      resolutions: context.links.map((link) => ({
        linkId: link.id,
        targetId: named.get(link.targetName) ?? null,
      })),
      links: [],
    };
  },
};
