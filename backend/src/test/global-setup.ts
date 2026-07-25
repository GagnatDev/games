import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { GlobalSetupContext } from "vitest/node";

/**
 * One Postgres for the whole run, migrated once.
 *
 * CI already provides a service container, so an existing `DATABASE_URL` is
 * honoured and Testcontainers is skipped — same harness locally and in CI.
 */
let container: StartedPostgreSqlContainer | undefined;

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  let databaseUrl = process.env["DATABASE_URL"];

  if (!databaseUrl) {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("games")
      .withUsername("games")
      .withPassword("games")
      .start();
    databaseUrl = container.getConnectionUri();
  }

  provide("databaseUrl", databaseUrl);

  // Migrate + seed with the app's own code, so the tests exercise the same boot
  // path the pod does.
  process.env["DATABASE_URL"] = databaseUrl;
  process.env["NODE_ENV"] = "test";
  process.env["AUTH_MODE"] = "dev";

  const { runMigrations } = await import("../db/migrate.js");
  const { syncGameCatalogue } = await import("../games/sync.js");
  const { closePool } = await import("../db/pool.js");

  await runMigrations();
  await syncGameCatalogue();
  await closePool();
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
