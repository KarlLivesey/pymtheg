import { sourceFileName } from "../shared/identity-values.js";
import type { InterfaceContext } from "./interface-builder.js";
import { formatSource } from "../language/format.js";
import { recipeSource, type RecipeId, type RecipeOptions } from "./recipes.js";
/** Server-side publication uses the language's real formatter. */
export function generateRecipe(
  id: RecipeId,
  options: RecipeOptions,
  context?: InterfaceContext,
): string {
  return formatSource(
    sourceFileName("recipe"),
    recipeSource(id, options, context),
  );
}
