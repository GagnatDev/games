import { Kysely, PostgresDialect } from "kysely";
import { pool } from "./pool.js";
import type { Database } from "./schema.js";

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export type DB = typeof db;
