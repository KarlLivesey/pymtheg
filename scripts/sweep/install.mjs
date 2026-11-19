// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const lockfiles = {
  npm: ["npm-shrinkwrap.json", "package-lock.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
};

export async function installation(root, scratch) {
  const read = (name) =>
    readFile(join(root, name), "utf8").catch(() => undefined);
  const text = await read("package.json");
  if (!text) return { status: "unsupported", reason: "missing-manifest" };
  let declared;
  try {
    declared = JSON.parse(text).packageManager;
  } catch {
    return { status: "unsupported", reason: "invalid-manifest" };
  }
  const exact =
    typeof declared === "string" &&
    /^(npm|pnpm|yarn)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\+sha(?:224|256|384|512)\.[\da-f]+)?$/.exec(
      declared,
    );
  if (declared && !exact)
    return { status: "unsupported", reason: "unsupported-package-manager" };
  let manager, lock;
  for (const [name, names] of Object.entries(lockfiles)) {
    if (exact && exact[1] !== name) continue;
    for (const file of names) {
      lock = await read(file);
      if (lock) break;
    }
    if (lock) {
      manager = name;
      break;
    }
  }
  if (!manager) return { status: "unsupported", reason: "missing-lockfile" };
  // Package-manager hooks can run outside the lifecycle path for Git sources.
  // The sweep supports registry and local workspace packages.
  if (
    /(?:^|[\s"'=:{,])(?:git\+|git:\/\/|git@[\w.-]+:|github:[\w.-]+\/)/im.test(
      lock,
    )
  )
    return { manager, status: "unsupported", reason: "git-dependency" };
  const cache = join(scratch, "install-cache");
  const env = {
    PATH: process.env.PATH,
    LC_ALL: "C.UTF-8",
    TMPDIR: scratch,
    COREPACK_HOME: join(cache, "corepack"),
    COREPACK_ENV_FILE: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    npm_config_userconfig: join(cache, "npm-user.npmrc"),
    npm_config_globalconfig: join(cache, "npm-global.npmrc"),
    npm_config_ignore_scripts: "true",
    npm_config_script_shell: "/bin/false",
    npm_config_cache: join(cache, "npm"),
    YARN_RC_FILENAME: `.pymtheg-sweep-${randomUUID()}.yarnrc`,
    YARN_IGNORE_PATH: "1",
    YARN_ENABLE_SCRIPTS: "false",
    YARN_ENABLE_GLOBAL_CACHE: "false",
    YARN_NODE_LINKER: "node-modules",
    YARN_CACHE_FOLDER: join(cache, "yarn"),
    YARN_GLOBAL_FOLDER: join(cache, "yarn-global"),
  };
  if (manager === "npm")
    return {
      manager,
      command: "npm",
      args: [
        "ci",
        "--ignore-scripts",
        "--script-shell=/bin/false",
        "--no-audit",
        "--no-fund",
      ],
      env,
    };
  if (manager === "pnpm") {
    const version = exact
      ? declared
      : /lockfileVersion:\s*['"]?6/.test(lock)
        ? "pnpm@8.15.9"
        : "pnpm@10.15.1";
    return {
      manager,
      command: "corepack",
      env,
      args: [
        version,
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--ignore-pnpmfile",
        "--config.manage-package-manager-versions=false",
        "--virtual-store-dir=node_modules/.pnpm",
        "--store-dir",
        join(cache, "pnpm"),
        `--config.cache-dir=${join(cache, "pnpm-meta")}`,
      ],
    };
  }
  const classic = exact
    ? exact[2].startsWith("1.")
    : /^# yarn lockfile v1/m.test(lock);
  return {
    manager,
    command: "corepack",
    env,
    args: [
      exact ? declared : classic ? "yarn@1.22.22" : "yarn@4.9.2",
      "install",
      ...(classic
        ? [
            "--frozen-lockfile",
            "--ignore-scripts",
            "--non-interactive",
            "--cache-folder",
            join(cache, "yarn-classic"),
          ]
        : ["--immutable", "--mode=skip-build"]),
    ],
  };
}
