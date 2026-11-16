import { roundCents } from "./money.js";

export function formatTotal(total: number): string {
  return "$" + roundCents(total).toFixed(2);
}
