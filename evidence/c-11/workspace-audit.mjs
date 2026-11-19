// SPDX-License-Identifier: MIT
// Check which earlier corpus graphs could reach an unreadable workspace root.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const scratch = process.env.PYM_SCRATCH;
const [build, run] = process.argv.slice(2);
const { workspaceLinks } = await import(
  pathToFileURL(
    join(scratch, build, "dist/graph/languages/typescript/workspace.js"),
  )
);
const { repos } = JSON.parse(
  readFileSync(join(scratch, `${run}-run.json`), "utf8"),
);

for (const repo of repos) {
  if (repo.outcome !== "finished") continue;
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
  try {
    const contexts = db
      .prepare(
        `SELECT body FROM graph_contexts WHERE path='package.json' OR path LIKE '%/package.json'
      OR path='pnpm-workspace.yaml' OR path LIKE '%/pnpm-workspace.yaml'`,
      )
      .all()
      .map(({ body }) => JSON.parse(body));
    const manifests = [],
      unreadable = [];
    for (const { path, text } of contexts) {
      if (!path.endsWith("package.json")) continue;
      try {
        const json = JSON.parse(text);
        if (!json || typeof json !== "object" || Array.isArray(json))
          throw Error("Expected an object");
        manifests.push({ path, json });
      } catch {
        unreadable.push(dirname(path));
      }
    }
    const { incompleteRoots } = workspaceLinks(manifests, contexts, unreadable);
    const available = db.prepare(
      `SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript' AND status<>'failed'`,
    );
    const files = incompleteRoots.size
      ? available
          .all()
          .filter(({ path }) =>
            [...incompleteRoots].some(
              (root) => root === "." || path.startsWith(`${root}/`),
            ),
          )
          .map(({ path }) => path)
      : [];
    console.log(
      JSON.stringify({
        repo: repo.id,
        incompleteRoots: [...incompleteRoots],
        affectedFiles: files.length,
        examples: files.slice(0, 4),
      }),
    );
  } finally {
    db.close();
  }
}
