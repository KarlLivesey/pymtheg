// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const finished = new Set(
  read("evidence/sw-1/results.json")
    .repos.filter(({ outcome }) => outcome === "finished")
    .map(({ id }) => id),
);
const pins = read("sweep/repos.json").filter(
  ({ id, language }) => language === "typescript" && finished.has(id),
);
if (pins.length !== 18) throw Error("Expected the 18 TypeScript pins");
console.log(JSON.stringify(pins));
