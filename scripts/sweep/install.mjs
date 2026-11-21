// SPDX-License-Identifier: MIT
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const extract = promisify(execFile);

// The dev sweep runs on Linux x64. Verify each native executable archive
// before extraction.
const nativeTools = {
  "bun@1.3.11": {
    url: "https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.3.11.tgz",
    sha512: "z3GFCk1UBzDOOiEBHL32lVP7Edi26BhOjKb6bIc0nRyabbRiyON4++GR0zmd/H5zM5S0+UcXFgCGnD+b8avTLw==",
    entry: "package/bin/bun",
  },
  "nub@0.8.3": {
    url: "https://github.com/nubjs/nub/releases/download/v0.8.3/nub-linux-x64.tar.gz",
    sha256: "249b064916db290c53de5bc1721a1dd78cf82e0f951f320782598b477cad7af9",
    entry: "bin/nub",
  },
  "pnpm@12.0.0": {
    url: "https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.0.0.tgz",
    sha512: "6Rsl+zEWMOmus7v7/9J3OE8EMvHyNAfxYmDfmhQG4J0985OuT3G3Ho9NSGHjkBn4aU4bgklWifRhe1HX8dUSyw==",
    entry: "package/pnpm",
  },
};

export async function installerCommand(setup, scratch) {
  if (!setup.native) return setup.command;
  const { url, sha256, sha512, entry } = setup.native;
  const cache = join(scratch, "install-cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, `${setup.manager}-${setup.version}-`));
  const archive = join(directory, "tool.tgz");
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw Error(`Installer download returned HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const digest = createHash(sha256 ? "sha256" : "sha512");
  for await (const chunk of createReadStream(archive)) digest.update(chunk);
  if (digest.digest(sha256 ? "hex" : "base64") !== (sha256 ?? sha512))
    throw Error("Installer archive checksum does not match the pin");
  await extract("tar", ["-xzf", archive, "-C", directory]);
  return join(directory, entry);
}

const lockfiles = {
  npm: ["npm-shrinkwrap.json", "package-lock.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock"],
  nub: ["pnpm-lock.yaml"],
};

export async function installation(root, scratch, { legacyPeerDeps = false } = {}) {
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
    /^(npm|pnpm|yarn|bun|nub)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\+sha(?:224|256|384|512)\.[\da-f]+)?$/.exec(
      declared,
    );
  if (declared && !exact)
    return { status: "unsupported", reason: "unsupported-package-manager" };
  let manager, lock;
  for (const [name, names] of Object.entries(lockfiles)) {
    if (exact && exact[1] !== name) continue;
    if (!exact && name === "nub") continue;
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
    XDG_CACHE_HOME: join(cache, "xdg-cache"),
    XDG_CONFIG_HOME: join(cache, "xdg-config"),
    XDG_DATA_HOME: join(cache, "xdg-data"),
    XDG_STATE_HOME: join(cache, "xdg-state"),
    NUB_HOME: join(cache, "nub"),
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
      command: exact ? "corepack" : "npm",
      prefix: exact ? [declared] : [],
      version: exact?.[2],
      args: [
        "ci",
        ...(legacyPeerDeps ? ["--legacy-peer-deps"] : []),
        "--ignore-scripts",
        "--script-shell=/bin/false",
        "--no-audit",
        "--no-fund",
      ],
      env,
    };
  const specification = exact ? declared : manager === "bun" ? "bun@1.3.11" : undefined;
  const native = nativeTools[specification];
  if ((native || manager === "bun" || manager === "nub") &&
      (!native || process.platform !== "linux" || process.arch !== "x64")) {
    return { manager, status: "unsupported", reason: "installer-binary-unavailable" };
  }
  const frozen = ["install", "--frozen-lockfile", "--ignore-scripts"];
  if (manager === "bun" || manager === "nub") {
    return {
      manager,
      native,
      version: specification.split("@")[1],
      env,
      args: manager === "bun" ? [...frozen, "--cache-dir", join(cache, "bun")] : frozen,
    };
  }
  if (manager === "pnpm") {
    const version = exact?.[2] ?? (/lockfileVersion:\s*['"]?6/.test(lock) ? "8.15.9" : "10.15.1");
    // The native pnpm 12 CLI uses the installer defaults for its virtual store.
    const legacy = Number.parseInt(version, 10) < 12;
    return {
      manager,
      command: "corepack",
      native,
      prefix: native ? [] : [exact ? declared : `pnpm@${version}`],
      version,
      env,
      args: [
        ...frozen,
        "--ignore-pnpmfile",
        ...(legacy ? [
          "--config.manage-package-manager-versions=false",
          "--virtual-store-dir=node_modules/.pnpm",
          `--config.cache-dir=${join(cache, "pnpm-meta")}`,
        ] : []),
        "--store-dir",
        join(cache, "pnpm"),
      ],
    };
  }
  const classic = exact
    ? exact[2].startsWith("1.")
    : /^# yarn lockfile v1/m.test(lock);
  const yarn = exact ? declared : classic ? "yarn@1.22.22" : "yarn@4.9.2";
  return {
    manager,
    command: "corepack",
    prefix: [yarn],
    version: yarn.split("@")[1].split("+")[0],
    env,
    args: [
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
