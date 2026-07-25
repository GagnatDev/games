import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { PORT } from "../playwright.config";
import { writeStackInfo } from "./stack";

/**
 * Bring up the same shape the pod runs: the bundled backend serving the built
 * SPA from WEB_ROOT, against a real Postgres, with AUTH_MODE=dev standing in for
 * the auth sidecar.
 *
 * CI provides `DATABASE_URL` (a service container), so Testcontainers is only
 * used for local runs.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const backendDir = resolve(repoRoot, "backend");
const serverEntry = resolve(backendDir, "dist", "server.cjs");
const webRoot = resolve(repoRoot, "frontend", "dist");

export default async function globalSetup(): Promise<() => Promise<void>> {
  for (const [path, hint] of [
    [serverEntry, "pnpm --filter @games/backend build"],
    [resolve(webRoot, "index.html"), "pnpm --filter @games/frontend build"],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`${path} is missing — run \`${hint}\` first (or \`pnpm build\`).`);
    }
  }

  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("games")
      .withUsername("games")
      .withPassword("games")
      .start();
    databaseUrl = container.getConnectionUri();
  }

  const server: ChildProcess = spawn(process.execPath, [serverEntry], {
    cwd: backendDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      // The e2e stack stands in for the sidecar with a fixed player.
      AUTH_MODE: "dev",
      DATABASE_URL: databaseUrl,
      PORT: String(PORT),
      WEB_ROOT: webRoot,
      LOG_LEVEL: "warn",
    },
  });

  // Hand the connection string to the workers so they can reset state per test.
  writeStackInfo({ databaseUrl });

  await waitForHealth(`http://127.0.0.1:${PORT}/health`);

  return async () => {
    server.kill("SIGTERM");
    await container?.stop();
  };
}

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`backend did not become healthy at ${url}`);
}
