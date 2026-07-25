import { z } from "zod";

/**
 * Landfall's own save shape.
 *
 * This is the pattern the whole platform is built around: the database stores
 * `state` as opaque jsonb, and the *game* — here, in its own chunk — is the only
 * thing that knows what is inside it. Changing this schema is a code change plus a
 * `STATE_VERSION` bump, never a database migration.
 */

export const STATE_VERSION = 1;

export const landfallStateSchema = z.object({
  version: z.literal(STATE_VERSION),
  /** Placeholder while the game is a shell — enough to prove persistence works. */
  captain: z.object({
    port: z.string(),
    cash: z.number(),
  }),
  log: z.array(z.object({ at: z.string(), note: z.string() })).max(50),
});

export type LandfallState = z.infer<typeof landfallStateSchema>;

export function newGameState(): LandfallState {
  return {
    version: STATE_VERSION,
    captain: { port: "oslo", cash: 250_000 },
    log: [],
  };
}

/** Unknown or future saves are reported, never silently reset. */
export function parseState(raw: unknown): LandfallState | null {
  const result = landfallStateSchema.safeParse(raw);
  return result.success ? result.data : null;
}
