import { z } from "zod";
import { loadEnvFiles } from "./loadEnv.js";

loadEnvFiles();

/**
 * Boot-time configuration. Validated once, fails fast and loudly with every
 * problem listed — a misconfigured pod should crashloop with a readable reason,
 * not serve broken requests.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * `dev` runs with a fixed local principal and no auth service. `sidecar`
   * requires the X-Homectl-* headers the homectl-auth-proxy injects. Defaults to
   * `sidecar` in production so a missing overlay can never silently disable auth.
   */
  AUTH_MODE: z.enum(["dev", "sidecar"]).optional(),
  DEV_AUTH_SUB: z.string().min(1).default("dev-user"),
  DEV_AUTH_EMAIL: z.string().min(1).default("dev@homectl.no"),
  DEV_AUTH_ROLE: z.string().min(1).default("player"),

  /** Terraform-managed (`games-vapid-secrets`). All three or none. */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default("mailto:admin@homectl.no"),

  /** Directory holding the built SPA. Unset in dev — Vite serves the frontend. */
  WEB_ROOT: z.string().min(1).optional(),
  /** Overrides migration discovery; set to `dist/migrations` in the image. */
  MIGRATIONS_DIR: z.string().min(1).optional(),
  RUN_MIGRATIONS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid games backend configuration:\n${lines.join("\n")}`);
  }

  const v = parsed.data;
  const isProduction = v.NODE_ENV === "production";
  const authMode = v.AUTH_MODE ?? (isProduction ? "sidecar" : "dev");

  const hasVapid = Boolean(v.VAPID_PUBLIC_KEY && v.VAPID_PRIVATE_KEY);
  if (!hasVapid && (v.VAPID_PUBLIC_KEY || v.VAPID_PRIVATE_KEY)) {
    throw new Error(
      "Invalid games backend configuration:\n" +
        "  - VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together (or both left unset to disable Web Push)",
    );
  }

  return {
    nodeEnv: v.NODE_ENV,
    isProduction,
    isTest: v.NODE_ENV === "test",
    port: v.PORT,
    logLevel: v.LOG_LEVEL,
    databaseUrl: v.DATABASE_URL,
    authMode,
    devPrincipal: {
      sub: v.DEV_AUTH_SUB,
      email: v.DEV_AUTH_EMAIL,
      role: v.DEV_AUTH_ROLE,
    },
    push: hasVapid
      ? {
          publicKey: v.VAPID_PUBLIC_KEY!,
          privateKey: v.VAPID_PRIVATE_KEY!,
          subject: v.VAPID_SUBJECT,
        }
      : null,
    webRoot: v.WEB_ROOT ?? null,
    migrationsDir: v.MIGRATIONS_DIR ?? null,
    runMigrations: v.RUN_MIGRATIONS,
  } as const;
}

export type Env = ReturnType<typeof load>;

export const env: Env = load();
