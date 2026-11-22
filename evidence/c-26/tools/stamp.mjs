// stamp.mjs : copies stdin to stdout with each line prefixed by the seconds
// since start (an observation of where an index run spends its time).
import { createInterface } from "node:readline";
const started = Date.now();
for await (const line of createInterface({ input: process.stdin }))
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${line}`);
