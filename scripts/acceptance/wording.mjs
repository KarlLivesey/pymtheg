// SPDX-License-Identifier: MIT
// What must never appear on a clean machine since R1-A: Java (including its
// runtime/kit names and JAVA_HOME), javac, Quint, TLC, TLA+ and the TLA+ tools
// JAR. Whole words or exact tokens only, so "JavaScript", "javascript:",
// "quintessential" or "atlc" do not match.
//
// Choices: `\b` treats "_" as a word character, so JAVA_HOME is listed as its
// own token (and "java_home_dir", a different identifier, does not match).
// "java.exe" matches through `\bjava\b` ("." is not a word character).
// "TLCs" matches: in this product's output the only plausible meaning is runs
// of the TLC checker. "jdk", "jre" and "openjdk" match as whole words, and
// every token may carry a version suffix ("jdk21", "java21"). JAVA_OPTS and
// JAVA_TOOL_OPTIONS ("Picked up JAVA_TOOL_OPTIONS: …") are their own tokens.
// Shared by the driver and the self-test, which checks every case below.
export const WORDING = /\b(?:java|javac|java_home|java_opts|java_tool_options|jdk|jre|openjdk|quint|tlcs?)\d*\b|tla2tools|\bTLA\+/i;

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
    "C:\\Program Files\\bin\\java.exe",
    "javac 21",
    "JAVA_HOME is not set",
    "set java_home first",
    "openjdk 21.0.2",
    "Install a JDK",
    "JRE 17",
    "jdk21",
    "java21 is required",
    "openjdk17",
    "JAVA_OPTS=-Xmx2g",
    "Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8",
    "Quint: ready — 0.33.1",
    "--backend quint",
    "path/to/quint",
    "TLC requires --tlc-jar",
    "tlc",
    "two TLCs ran",
    "uses tla2tools.jar",
    "a TLA+ specification",
    "(java)",
  ],
  noMatch: [
    "TypeScript/JavaScript",
    "JavaScript",
    "javascript",
    "javascript:void(0)",
    "Javadoc-style comment",
    "quintessential",
    "quintuple",
    "atlc",
    "tlcx",
    "TLAs",
    "atlas",
    "java_home_dir",
    "jdkfoo",
    "java_opts_file",
    "JavaScript21",
    "",
  ],
};
