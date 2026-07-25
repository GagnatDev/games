import { inject } from "vitest";

// Runs before any app module is imported, so config/env.ts sees the right values.
process.env["DATABASE_URL"] = inject("databaseUrl");
process.env["NODE_ENV"] = "test";
process.env["AUTH_MODE"] = "dev";
// Already applied in global setup; re-running per file would just take the lock.
process.env["RUN_MIGRATIONS"] = "false";
delete process.env["VAPID_PUBLIC_KEY"];
delete process.env["VAPID_PRIVATE_KEY"];
