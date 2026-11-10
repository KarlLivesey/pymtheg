import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("retained Markdown reads as structured text without active HTML or image requests", async () => {
  const temp = await mkdtemp(join(tmpdir(), "pym-reader-test-"));
  try {
    const require = createRequire(import.meta.url);
    const outfile = join(temp, "reader.mjs");
    await build({
      entryPoints: [resolve("web/src/DocumentReader.tsx")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      plugins: [
        {
          name: "one-react",
          setup(builder) {
            builder.onResolve({ filter: /^react(?:\/|$)/ }, (args) => ({
              path: require.resolve(args.path),
              external: true,
            }));
          },
        },
      ],
    });
    const { DocumentReader } = await import(pathToFileURL(outfile).href);
    const source =
      '# Storage plan\n\nKeep **durable** writes.\n\n- Flush first\n- Then acknowledge\n\n| Decision | Status |\n| --- | --- |\n| WAL | Accepted |\n\n```ts\nconst count = 2;\n```\n\n[Local](next.md) [Missing](missing.md) [External](https://example.test) [Unsafe](javascript:alert(1))\n\n![secret image](https://tracker.test/beacon.png)\n<script>alert("never")</script>\n';
    const html = renderToStaticMarkup(
      createElement(DocumentReader, {
        path: "docs/plan.md",
        text: source,
        paths: new Set(["docs/plan.md", "docs/next.md"]),
        onOpen() {},
      }),
    );
    assert.match(html, /<h2[^>]*>Storage plan<\/h2>/);
    assert.match(html, /<strong>durable<\/strong>/);
    assert.match(html, /<li>Flush first<\/li>/);
    assert.match(html, /<table>/);
    assert.match(html, /<code class="language-ts">/);
    assert.match(html, /Not retained in this revision: docs\/missing.md/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(html, /Exact source/);
    assert.doesNotMatch(
      html,
      /<script|<img|<iframe|href="javascript:|src="https:/i,
    );
    assert.match(html, /remote content is not loaded/);
    assert.match(html, /&lt;script&gt;/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
