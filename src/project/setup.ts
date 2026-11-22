// SPDX-License-Identifier: MIT
import { initializeWorkspace, type InitOptions } from "./workspace.js";
import {
  previewProjectDocumentation,
  type DocumentationPreviewOptions,
} from "./documents.js";
/** Shared CLI/Studio setup flow; importing documentation remains a separate explicit choice. */
export async function setupProject(
  root: string,
  name: string | undefined,
  importDocuments: boolean,
  signal: AbortSignal,
  {
    trust,
    defaulted,
    ...options
  }: DocumentationPreviewOptions & InitOptions = {},
) {
  signal.throwIfAborted();
  const initialized = await initializeWorkspace(root, name, {
    ...(trust ? { trust } : {}),
    ...(defaulted ? { defaulted } : {}),
  });
  try {
    const documentation = await previewProjectDocumentation(
      initialized.root,
      initialized.workspace,
      importDocuments,
      signal,
      options,
    );
    return { ...initialized, documentation };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ...initialized,
      documentation: {
        status: "unavailable" as const,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
