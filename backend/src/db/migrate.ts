import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runner } from "node-pg-migrate";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

/**
 * Run the plain-SQL migrations in `migrations/` before the server listens.
 *
 * node-pg-migrate takes a Postgres advisory lock for the duration, so a rolling
 * deploy where several new pods boot at once is safe: the first one migrates and
 * the others wait, then find nothing to do.
 */
export async function runMigrations(): Promise<void> {
  const dir = resolveMigrationsDir();
  logger.info({ dir }, "running database migrations");

  await runner({
    databaseUrl: env.databaseUrl,
    dir,
    direction: "up",
    migrationsTable: "pgmigrations",
    // Plain .sql files only — no TypeScript migration loader needed.
    log: (msg: string) => {
      // node-pg-migrate expects timestamp-prefixed filenames and grumbles once
      // per file about ours. The numbered convention is deliberate (it matches
      // the other homectl apps), so keep that noise out of the pod logs.
      if (msg.startsWith("Can't determine timestamp")) {
        logger.debug(msg);
        return;
      }
      logger.info(msg);
    },
    verbose: false,
  });

  logger.info("database migrations up to date");
}

/**
 * The migrations live at `backend/migrations` in the repo and at
 * `dist/migrations` in the image (the build copies them next to the bundle).
 * MIGRATIONS_DIR overrides the search.
 */
function resolveMigrationsDir(): string {
  const candidates = [
    env.migrationsDir,
    "dist/migrations",
    "migrations",
    "backend/migrations",
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const abs = resolve(process.cwd(), candidate);
    if (existsSync(abs)) return abs;
  }

  throw new Error(
    `Could not find the migrations directory (looked for ${candidates.join(", ")} under ${process.cwd()}). Set MIGRATIONS_DIR.`,
  );
}
