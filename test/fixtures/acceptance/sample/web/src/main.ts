import { formatTotal } from "./format.js";

export function renderBasket(prices: number[]): string {
  const total = prices.reduce((sum, price) => sum + price, 0);
  return "Total: " + formatTotal(total);
}
