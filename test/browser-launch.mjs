import { chromium, firefox, webkit } from "@playwright/test";
import { existsSync } from "node:fs";

/** Resolve the browser belonging to the pinned Playwright version. No download or launch. */
export function browserExecutable(
  engine = process.env.PYM_TEST_ENGINE ?? "chromium",
) {
  const types = { chromium, firefox, webkit };
  if (!types[engine]) throw Error("Choose chromium, firefox or webkit.");
  const override = process.env["PYM_" + engine.toUpperCase()];
  const path = override || types[engine].executablePath();
  if (!existsSync(path))
    throw Error(
      "The " +
        engine +
        " browser for the pinned Playwright version is missing. " +
        "Run node node_modules/playwright/cli.js install " +
        engine +
        ", or set PYM_" +
        engine.toUpperCase() +
        " to an explicit executable. " +
        "PLAYWRIGHT_BROWSERS_PATH selects a nondefault installation directory.",
    );
  return path;
}

export function browserType(
  engine = process.env.PYM_TEST_ENGINE ?? "chromium",
) {
  const type = { chromium, firefox, webkit }[engine];
  if (!type) throw Error("Choose chromium, firefox or webkit.");
  return type;
}

/** Test-profile settings only. Keep Firefox inside the shared process/thread budget. */
export function browserLaunchOptions(
  engine = process.env.PYM_TEST_ENGINE ?? "chromium",
) {
  return {
    headless: true,
    executablePath: browserExecutable(engine),
    ...(engine === "firefox"
      ? {
          firefoxUserPrefs: {
            "dom.ipc.processCount": 1,
            "dom.ipc.processCount.webIsolated": 1,
            "dom.ipc.processPrelaunch.enabled": false,
            "gfx.webrender.software": true,
            "gfx.webrender.multithreading": false,
          },
        }
      : {}),
  };
}
