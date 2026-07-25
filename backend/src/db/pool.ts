import { Pool } from "pg";
import { env } from "../config/env.js";
import { logger } from "../logger.js";

/**
 * One pool per process. Sized for a small shared Postgres instance: the whole
 * platform runs on one db-dev-s, so a single app must not hoard connections.
 */
export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "games",
});

pool.on("error", (err) => {
  // An idle client dying is recoverable — pg discards it and opens a new one.
  logger.error({ err: err.message }, "idle postgres client error");
});

export async function closePool(): Promise<void> {
  await pool.end();
}
