// SPDX-License-Identifier: MIT
// Diagnostics only: this entire controller must run inside pc-tools headless.
import { chromium, firefox, webkit } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
const file = process.argv[2];
if (
  !file?.startsWith("test/") ||
  !file.endsWith(".browser.mjs") ||
  file.includes("..")
)
  throw Error("Choose a repository browser journey.");
const root = process.env.PYM_BROWSER_EVIDENCE_DIR;
const record = {
  file,
  engine: process.env.PYM_TEST_ENGINE ?? "chromium",
  started: new Date().toISOString(),
  events: [],
  pages: [],
  pendingRequests: [],
  maximumControllerEventLoopDelayMs: 0,
};
const pending = new Map();
function flush() {
  if (!root) return;
  record.pendingRequests = [...pending.values()];
  mkdirSync(root, { recursive: true });
  const target = join(root, basename(file) + ".diagnostics.json");
  writeFileSync(target + ".tmp", JSON.stringify(record, null, 2));
  renameSync(target + ".tmp", target);
}
function event(kind, detail) {
  record.events.push({ at: new Date().toISOString(), kind, detail });
  record.events = record.events.slice(-200);
  flush();
}
// Studio has no embedded frames. Keep the same WCAG rules while avoiding axe's
// auxiliary blank-page finishRun path in headless WebKit. Never omit a frame.
const analyzeAccessibility = AxeBuilder.prototype.analyze;
AxeBuilder.prototype.analyze = async function () {
  if (record.engine === "webkit") {
    if (this.page.frames().length !== 1)
      throw Error(
        "WebKit same-page accessibility audit requires exactly one frame; no frame was excluded.",
      );
    this.setLegacyMode(true);
    event("axe-same-page", {
      frames: 1,
      reason:
        "Headless WebKit auxiliary-page creation stalls; same-page rules retained.",
    });
  }
  return analyzeAccessibility.call(this);
};
const pages = new Map();
function watchPage(page) {
  const state = {
    url: page.url(),
    closed: false,
    crashed: false,
    lastDOM: null,
  };
  pages.set(page, state);
  record.pages.push(state);
  let capturing = false;
  const capture = async () => {
    if (capturing || page.isClosed()) return;
    capturing = true;
    try {
      state.lastDOM = await page.evaluate(() => ({
        at: new Date().toISOString(),
        title: document.title,
        active: document.activeElement?.outerHTML.slice(0, 2000),
        status: document.querySelector(".statusbar")?.textContent,
        html: document.documentElement.outerHTML.slice(0, 50000),
      }));
      state.url = page.url();
      flush();
    } catch (error) {
      event("diagnostic-read", String(error));
    } finally {
      capturing = false;
    }
  };
  state.capture = capture;
  page.on("domcontentloaded", () => {
    event("domcontentloaded", page.url());
    void capture();
  });
  page.on("crash", () => {
    state.crashed = true;
    event("crash", page.url());
  });
  page.on("close", () => {
    state.closed = true;
    event("page-closed", state.url);
  });
  page.on("pageerror", (error) => event("pageerror", String(error)));
  page.on("console", (message) =>
    event("console:" + message.type(), message.text().slice(0, 2000)),
  );
  page.on("request", (request) => {
    if (pending.size < 1000)
      pending.set(request, {
        method: request.method(),
        url: request.url(),
        started: new Date().toISOString(),
      });
  });
  page.on("requestfinished", (request) => {
    pending.delete(request);
  });
  page.on("requestfailed", (request) => {
    pending.delete(request);
    event("requestfailed", { url: request.url(), failure: request.failure() });
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      event("http-error", { url: response.url(), status: response.status() });
  });
}
for (const type of [chromium, firefox, webkit]) {
  const launch = type.launch.bind(type);
  type.launch = async (...args) => {
    if (type.name() === "webkit") {
      args[0] = {
        ...args[0],
        env: {
          ...process.env,
          ...args[0]?.env,
          LP_NUM_THREADS: "1",
          OMP_NUM_THREADS: "1",
        },
      };
    }
    event("launch", type.name());
    const browser = await launch(...args);
    if (type.name() === "webkit") {
      const close = browser.close.bind(browser);
      browser.close = async (...options) => {
        event("browser-close-requested", "webkit");
        for (const context of browser.contexts()) await context.close();
        event("contexts-closed", "webkit");
        await close(...options);
        event("browser-close-complete", "webkit");
      };
    }
    browser.on("disconnected", () =>
      event("browser-disconnected", type.name()),
    );
    const create = browser.newContext.bind(browser);
    browser.newContext = async (...options) => {
      const context = await create(...options);
      context.on("page", watchPage);
      return context;
    };
    return browser;
  };
}
let last = performance.now(),
  ticks = 0;
const timer = setInterval(() => {
  const now = performance.now();
  record.maximumControllerEventLoopDelayMs = Math.max(
    record.maximumControllerEventLoopDelayMs,
    now - last - 1000,
  );
  last = now;
  if (++ticks % 5 === 0) for (const page of record.pages) void page.capture();
  flush();
}, 1000);
timer.unref();
const terminate = () => {
  record.deadlineSignal = true;
  event(
    "SIGTERM",
    "Last cached DOM and pending requests retained; helper owns cleanup.",
  );
};
process.on("SIGTERM", terminate);
flush();
try {
  await import(pathToFileURL(resolve(file)).href);
} catch (error) {
  record.failure = String(error);
  throw error;
} finally {
  clearInterval(timer);
  process.removeListener("SIGTERM", terminate);
  record.finished = new Date().toISOString();
  flush();
}
