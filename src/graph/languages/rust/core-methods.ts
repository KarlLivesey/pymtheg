// SPDX-License-Identifier: MIT
// Inherent instance methods from Rust 1.98.1's library/core/src. The minor
// version column records the earliest Rust 1.x release supplying the method
// in core. Keep impls whose receiver matches for all type arguments and
// methods available across target and feature configurations.
import type { Edition } from "./cargo.js";
type Receiver = "owned" | "shared" | "mutable";
const groups = [
  [
    "str",
    "shared",
    27,
    0,
    "as_bytes as_ptr bytes char_indices chars is_empty len lines parse trim",
  ],
  [
    "str",
    "shared",
    27,
    1,
    "contains ends_with find rfind rsplit split split_terminator starts_with trim_matches",
  ],
  ["str", "shared", 27, 2, "rsplitn splitn"],
  ["str", "shared", 27, 0, "split_whitespace"],
  ["str", "shared", 30, 0, "trim_end trim_start"],
  ["str", "shared", 27, 1, "is_char_boundary split_at"],
  [
    "char",
    "owned",
    27,
    0,
    "escape_default escape_unicode is_alphabetic is_alphanumeric is_control is_lowercase is_numeric is_uppercase is_whitespace len_utf16 len_utf8 to_lowercase to_uppercase",
  ],
  ["char", "owned", 27, 1, "is_digit to_digit"],
  [
    "int",
    "owned",
    0,
    0,
    "count_ones count_zeros leading_zeros trailing_zeros swap_bytes",
  ],
  [
    "int",
    "owned",
    0,
    1,
    "checked_add checked_div checked_mul checked_sub pow saturating_add saturating_sub",
  ],
  [
    "int",
    "owned",
    0,
    1,
    "rotate_left rotate_right wrapping_add wrapping_mul wrapping_sub",
  ],
  ["int", "owned", 7, 1, "overflowing_add overflowing_mul overflowing_sub"],
  ["int", "owned", 32, 0, "to_be_bytes to_le_bytes to_ne_bytes"],
  ["uint", "owned", 0, 0, "is_power_of_two next_power_of_two"],
  ["uint", "owned", 73, 1, "div_ceil"],
  ["sint", "owned", 0, 0, "abs is_negative is_positive signum"],
  [
    "float",
    "owned",
    0,
    0,
    "is_finite is_infinite is_nan is_normal is_sign_negative is_sign_positive recip",
  ],
  ["float", "owned", 0, 1, "max min"],
  ["float", "owned", 20, 0, "to_bits"],
  ["float", "owned", 40, 0, "to_be_bytes to_le_bytes to_ne_bytes"],
  ["float", "owned", 85, 0, "abs signum"],
  ["option::Option", "owned", 0, 0, "unwrap"],
  [
    "option::Option",
    "owned",
    0,
    1,
    "and and_then expect map ok_or ok_or_else or or_else unwrap_or unwrap_or_else",
  ],
  ["option::Option", "shared", 0, 0, "as_ref is_none is_some iter"],
  ["option::Option", "mutable", 0, 0, "as_mut iter_mut take"],
  ["result::Result", "owned", 0, 0, "err ok unwrap unwrap_err"],
  [
    "result::Result",
    "owned",
    0,
    1,
    "and and_then map map_err or or_else unwrap_or unwrap_or_else",
  ],
  ["result::Result", "owned", 4, 1, "expect"],
  ["result::Result", "owned", 17, 1, "expect_err"],
  ["result::Result", "shared", 0, 0, "as_ref is_err is_ok iter"],
  ["result::Result", "mutable", 0, 0, "as_mut iter_mut"],
] as const;

type Method = { receiver: Receiver; since: number; arity: number };
const methods = new Map<string, Map<string, Method>>();
export const coreMethodNames = new Set<string>();
for (const [owner, receiver, since, arity, names] of groups) {
  const entries = methods.get(owner) ?? new Map();
  methods.set(owner, entries);
  for (const name of names.split(" ")) {
    entries.set(name, { receiver, since, arity });
    coreMethodNames.add(name);
  }
}

export function primitiveReceiver(type: string): boolean {
  return /^(?:[ui](?:8|16|32|64|128|size)|f(?:32|64)|str|char)$/.test(type);
}

export function coreMethod(
  owner: string,
  name: string,
  receiver: string,
  arity: number,
): { symbol: string; since: number } | undefined {
  const family = /^[ui](?:8|16|32|64|128|size)$/.test(owner)
    ? [owner[0] === "u" ? "uint" : "sint", "int"]
    : /^f(?:32|64)$/.test(owner)
      ? ["float"]
      : [owner];
  for (const type of family) {
    const method = methods.get(type)?.get(name);
    if (method?.receiver === receiver && method.arity === arity)
      return {
        symbol: `${owner}::${name}`,
        since: /[ui]128$/.test(owner)
          ? Math.max(method.since, 26)
          : method.since,
      };
  }
}

const editionFloor = { "2015": 0, "2018": 31, "2021": 56, "2024": 85 };
export function compilerFloor(edition: Edition, rustVersionMinor = 0): number {
  return Math.max(editionFloor[edition], rustVersionMinor);
}
