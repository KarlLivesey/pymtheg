/** Shared authoring validation; the canonical checker still owns state semantics. */
export function validateNumericRange(
  minimum: string,
  maximum: string,
  type: "Nat" | "Int",
  label = "Range",
): { min: bigint; max: bigint } {
  if (!/^-?\d+$/.test(minimum.trim()) || !/^-?\d+$/.test(maximum.trim()))
    throw Error(`${label}: supply whole-number minimum and maximum values.`);
  const min = BigInt(minimum.trim()),
    max = BigInt(maximum.trim());
  if (min > max) throw Error(`${label}: minimum must not exceed maximum.`);
  if (type === "Nat" && min < 0n)
    throw Error(
      `${label}: Nat values cannot be negative. Choose Int for signed values.`,
    );
  return { min, max };
}
