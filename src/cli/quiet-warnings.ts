// SPDX-License-Identifier: MIT
/**
 * The CLI's import of the warning filter (src/shared/quiet-warnings.ts, where
 * worker entries outside the CLI import it too). Importing this module runs
 * the filter.
 */
export { isReliedOnExperimentalWarning } from "../shared/quiet-warnings.js";
