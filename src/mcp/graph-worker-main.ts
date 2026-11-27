// SPDX-License-Identifier: MIT
// C-48: the MCP server's graph worker entry (see graph-worker.ts).
import "../shared/quiet-warnings.js";
import { serveGraphRequests } from "./graph-worker.js";
serveGraphRequests();
