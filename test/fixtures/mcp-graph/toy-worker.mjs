// The production graph worker (C-48: persistent, with an index session),
// run with the test-only toy registry.
import { serveGraphRequests } from "../../../dist/mcp/graph-worker.js";
import { LanguageRegistry } from "../../../dist/graph/index.js";
import toy from "../../../dist/graph/languages/toy/index.js";
serveGraphRequests({ registry: new LanguageRegistry([toy]) });
