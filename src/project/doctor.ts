import { printLegacyNotice } from "../storage/legacy.js";
import { findProjectRoot } from "../storage/local.js";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { identity } from "../shared/identity.js";
import { defaultQuint, quintVersion, tlcHash } from "../backends/adapter.js";
import { runProcess } from "../backends/process.js";
export async function doctor(
  signal: AbortSignal,
  jar: string | null = process.env.PYM_TLC_JAR ?? null,
) {
  printLegacyNotice(findProjectRoot(process.cwd()));
  const checks: {
    name: string;
    status: "ready" | "missing" | "incompatible";
    detail: string;
  }[] = [];
  checks.push({
    name: "Node",
    status:
      Number(process.versions.node.split(".")[0]) === 24
        ? "ready"
        : "incompatible",
    detail: process.version + " (supported: 24 LTS)",
  });
  try {
    const p = await runProcess(defaultQuint, ["--version"], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      signal,
      maxBytes: 8192,
    });
    checks.push({
      name: "Quint",
      status:
        p.kind === "spawn_failed"
          ? "missing"
          : p.kind === "exited" &&
              p.code === 0 &&
              p.stdout.includes(quintVersion)
            ? "ready"
            : "incompatible",
      detail: p.kind === "exited" ? p.stdout.trim() : p.kind,
    });
  } catch (e) {
    checks.push({ name: "Quint", status: "missing", detail: String(e) });
  }
  const java = await runProcess("java", ["-version"], {
    cwd: process.cwd(),
    timeoutMs: 5000,
    signal,
    maxBytes: 8192,
  });
  checks.push({
    name: "Java",
    status:
      java.kind === "spawn_failed"
        ? "missing"
        : java.kind === "exited" && java.code === 0
          ? "ready"
          : "incompatible",
    detail:
      java.kind === "exited"
        ? ((java.stderr || java.stdout).split("\n")[0] ?? "Available")
        : java.kind,
  });
  if (jar) {
    try {
      const digest = createHash("sha256")
        .update(await readFile(jar))
        .digest("hex");
      checks.push({
        name: "TLC",
        status: digest === tlcHash ? "ready" : "incompatible",
        detail:
          digest === tlcHash
            ? "Pinned TLC JAR available"
            : "JAR checksum does not match pinned release",
      });
    } catch (e) {
      checks.push({ name: "TLC", status: "missing", detail: String(e) });
    }
  } else
    checks.push({
      name: "TLC",
      status: "missing",
      detail:
        "Set PYM_TLC_JAR to the official v1.7.4 JAR. Local checking does not require it.",
    });
  try {
    await stat(
      fileURLToPath(new URL("../../dist-web/index.html", import.meta.url)),
    );
    checks.push({
      name: "Studio",
      status: "ready",
      detail: "Built GUI available",
    });
  } catch {
    checks.push({
      name: "Studio",
      status: "missing",
      detail: "Run npm run build",
    });
  }
  return { schema: "pymtheg.doctor/v1", version: identity.version, checks };
}
