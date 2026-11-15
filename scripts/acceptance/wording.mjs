// What must never appear on a clean machine since R1-A: Java, javac, Quint,
// TLC, TLA+ and the TLA+ tools JAR. Whole words or exact tokens only, so
// "JavaScript", "quintessential" or "atlc" do not match. Shared by the driver
// and the self-test, which checks the matcher against the cases below.
export const WORDING = /\b(?:java|javac|quint|tlc)\b|tla2tools|\bTLA\+/i;

/** Programs Pymtheg must never start (file name of the executable). */
export const BACKEND_PROGRAM = /^(?:java|javac|quint|tlc)$/;
/** Arguments that betray a backend started through another program (`node …/quint/dist/src/cli.js`). */
export const BACKEND_ARGUMENT = /@informalsystems[/\\]quint|[/\\]quint[/\\]|tla2tools|\.jar$/i;
/** Toolchains Pymtheg may run only when a project opts in. */
export const TOOLCHAIN_PROGRAM = /^(?:go|cargo|rustc|rustup)$/;

export function wordingHits(text, limit = 3) {
  const hits = [];
  for (const line of String(text).split("\n")) {
    if (WORDING.test(line)) hits.push(line.trim().slice(0, 160));
    if (hits.length >= limit) break;
  }
  return hits;
}

export const WORDING_CASES = {
  match: [
    "java -version",
    "Java: missing",
    "javac 21",
    "Quint: ready — 0.33.1",
    "--backend quint",
    "TLC requires --tlc-jar",
    "tlc",
    "uses tla2tools.jar",
    "a TLA+ specification",
    "(java)",
    "path/to/quint",
  ],
  noMatch: [
    "TypeScript/JavaScript",
    "javascript",
    "Javadoc-style comment",
    "quintessential",
    "quintuple",
    "atlc",
    "tlcx",
    "TLAs",
    "atlas",
    "java_home_dir",
    "",
  ],
};
