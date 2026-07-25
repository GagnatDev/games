import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "dotenv";

/**
 * Load the repo's env overlays for local development.
 *
 * Layering matches the platform convention (docs/conventions.md): the committed
 * overlay named by `ENV_FILE` (`.env.development` for `pnpm dev`, `.env.sidecar`
 * for `pnpm dev:sidecar`) wins over the gitignored `.env`, and the real process
 * environment always wins over both — which is what makes this a no-op in
 * Docker and Kubernetes, where the files do not exist and everything arrives as
 * real env vars from the Secrets.
 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  const root = findRepoRoot(cwd);
  if (!root) return;

  // Captured before applying anything, so a variable that was already set in the
  // real environment is never overwritten by a file.
  const preset = new Set(Object.keys(process.env));

  const overlay = process.env["ENV_FILE"] ?? ".env.development";
  for (const file of [overlay, ".env"]) {
    applyFile(join(root, file), preset);
  }
}

function applyFile(path: string, preset: Set<string>): void {
  if (!existsSync(path)) return;
  const parsed = parse(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!preset.has(key)) process.env[key] = value;
  }
}

/** Walk up looking for the workspace root, so this works from repo root or backend/. */
function findRepoRoot(from: string): string | null {
  let dir = resolve(from);
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
