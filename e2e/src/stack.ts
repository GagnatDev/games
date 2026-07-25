import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The handful of facts global setup discovers and the test workers need.
 *
 * Written to disk rather than passed through `process.env`, because Playwright
 * runs global setup and the test workers in separate processes and the worker's
 * environment is not guaranteed to carry mutations made during setup.
 */
export type StackInfo = { databaseUrl: string };

const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".cache",
  "stack.json",
);

export function writeStackInfo(info: StackInfo): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(info, null, 2));
}

export function readStackInfo(): StackInfo {
  return JSON.parse(readFileSync(file, "utf8")) as StackInfo;
}
