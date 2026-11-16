// SPDX-License-Identifier: MIT
import { expect } from "@playwright/test";
/** The server has acknowledged these exact fields; status text may belong to a prior payload. */
export async function waitForRecovery(app, select, expected) {
  await expect
    .poll(() => select(app.service.readRecovery()), { timeout: 0 })
    .toEqual(expected);
}
