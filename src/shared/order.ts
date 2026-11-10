/** Code-unit ordering for identities and wire formats; independent of host locale. */
export const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
