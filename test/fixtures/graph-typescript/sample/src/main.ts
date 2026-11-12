// Ünïcödé 🚀 before every declaration.
import createJob from "@lib/api";
import { fmt, Job } from "./lib/index";
import type { Runner } from "./lib/api";
import { api } from "./lib/index";
import { Circle, Square, Config } from "./shapes";
import { helper } from "@sample/util";
import chalk from "chalk";

export const café: Config = { name: Config.fallback };

export function main(runner: Runner, shape: Circle | Square): void {
  createJob();
  fmt(1);
  new Job().run();
  api.format("x");
  shape.area();
  helper();
  chalk();
  void import("./lazy");
}
