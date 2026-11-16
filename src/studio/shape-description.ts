// SPDX-License-Identifier: MIT
import type { ValueShape } from "./shapes.js";
export function describeShape(shape: ValueShape): string {
  switch (shape.kind) {
    case "nat":
      return "a whole number, zero or greater";
    case "int":
      return "a whole number";
    case "bool":
      return "true or false";
    case "string":
      return "text";
    case "unit":
      return "no returned value";
    case "list":
      return `a list of ${describeShape(shape.item)}`;
    case "record":
      return `${shape.label}, with ${shape.fields.map((f) => f.name).join(", ")}`;
    case "tagged":
      return `one of ${shape.variants.map((v) => v.tag).join(", ")}`;
    case "resource":
      return `a ${shape.label} resource`;
    case "unsupported":
      return shape.label;
  }
}
