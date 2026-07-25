import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closePool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { syncGameCatalogue } from "./games/sync.js";
import { logger } from "./logger.js";

/**
 * Boot order matters: migrations and the catalogue sync finish *before* the
 * server listens, so the startup probe only goes green once the schema the
 * running code expects is actually in place.
 */
async function main(): Promise<void> {
  if (env.runMigrations) {
    await runMigrations();
  }
  await syncGameCatalogue();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, authMode: env.authMode, push: env.push !== null },
      "games backend listening",
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      closePool()
        .catch((err) => logger.error({ err }, "failed to close the pool"))
        .finally(() => process.exit(0));
    });
    // Don't let a hung connection keep the pod alive past the grace period.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.fatal(
    { err: err instanceof Error ? err.stack : String(err) },
    "failed to start",
  );
  process.exit(1);
});
