import { readArchitectureFolder } from "../architecture/store.js";
import { StudioService } from "../studio/service.js";
import type { WorkspaceIdentity } from "../shared/workspace.js";
import type { z } from "zod";
import type { importResolutionSchema } from "../architecture/schema.js";
import {
  documentationDirectory,
  projectDocumentationPath,
  documentationChanges,
} from "../shared/document-selection.js";
import { withImportInventory } from "../architecture/import-policy.js";
/** Default discovery is intentionally documentation-focused. Other locations use explicit folder import. */
export async function projectDocumentation(root: string, signal?: AbortSignal) {
  return readArchitectureFolder(root, {
    ...(signal ? { signal } : {}),
    directory: documentationDirectory,
    file: projectDocumentationPath,
  });
}
export interface DocumentationPreviewOptions {
  resolutions?: z.infer<typeof importResolutionSchema>[] | undefined;
  allowBrokenLinks?: boolean | undefined;
  service?: StudioService;
  onPreview?: (preview: {
    token: string;
    documents: { path: string; text: string }[];
  }) => void;
}
export async function previewProjectDocumentation(
  root: string,
  workspace: WorkspaceIdentity,
  commit: boolean,
  signal: AbortSignal,
  options: DocumentationPreviewOptions = {},
) {
  const found = await projectDocumentation(root, signal);
  const base = {
    total: found.documents.length,
    files: found.documents.slice(0, 100).map((d) => d.path),
    filesTruncated: found.documents.length > 100,
  };
  const service = options.service ?? new StudioService(root);
  try {
    const current = await service.architectureOverview();
    const source = {
      id: "project-docs:" + workspace.id,
      label: workspace.name + " documentation",
      kind: "folder" as const,
      selection: "project-documents" as const,
    };
    const tracked = current.sources.some((s) => s.id === source.id);
    if (!found.documents.length && !tracked)
      return { ...base, status: "none" as const, committed: false };
    const preview = await service.previewArchitectureImport(
      "Project documentation",
      {
        documents: withImportInventory(
          found.documents,
          found.root,
          found.excluded,
          source.id,
        ),
        source,
        mode: tracked ? "refresh" : "add",
        resolutions: options.resolutions ?? [],
      },
      signal,
    );
    options.onPreview?.({ token: preview.token, documents: found.documents });
    const blocked =
      preview.conflicts.length > 0 ||
      (preview.newlyBrokenAuthoredLinks.length > 0 &&
        !options.allowBrokenLinks);
    if (commit && !blocked) {
      const saved = await service.commitPreparedArchitectureImport(
        preview.token,
        signal,
      );
      return {
        ...base,
        status:
          saved.id === current.activeRevision
            ? ("unchanged" as const)
            : ("imported" as const),
        committed: saved.id !== current.activeRevision,
        revision: saved.id,
        changes: documentationChanges(preview.summary),
        warnings: preview.warnings,
      };
    }
    return {
      ...base,
      status: blocked ? ("needs_review" as const) : ("preview" as const),
      ...(options.service ? { previewToken: preview.token } : {}),
      committed: false,
      changes: documentationChanges(preview.summary),
      conflicts: preview.conflicts,
      newlyBrokenAuthoredLinks: preview.newlyBrokenAuthoredLinks,
      warnings: preview.warnings,
      review: preview,
    };
  } finally {
    if (!options.service) await service.close();
  }
}
