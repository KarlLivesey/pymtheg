// SPDX-License-Identifier: MIT
export const textPageCharacters = 16384;
/** The offset is UTF-16, but a returned page always ends on a Unicode character boundary. */
export function textPage(text: string, offset: number, limit: number) {
  const high = (c: number) => c >= 0xd800 && c <= 0xdbff,
    low = (c: number) => c >= 0xdc00 && c <= 0xdfff;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > text.length ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > textPageCharacters
  )
    throw Error(
      "Choose a valid character offset and a page of 1–16384 characters",
    );
  if (
    offset > 0 &&
    low(text.charCodeAt(offset)) &&
    high(text.charCodeAt(offset - 1))
  )
    throw Error(
      "Character offset splits a Unicode character; use the returned nextOffset",
    );
  let end = Math.min(text.length, offset + limit);
  if (
    end < text.length &&
    high(text.charCodeAt(end - 1)) &&
    low(text.charCodeAt(end))
  )
    end = end - 1 === offset ? end + 1 : end - 1;
  return {
    text: text.slice(offset, end),
    offset,
    nextOffset: end < text.length ? end : null,
    offsetUnit: "UTF-16 code units" as const,
  };
}
