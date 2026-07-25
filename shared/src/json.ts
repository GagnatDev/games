import { z } from "zod";

/**
 * The platform stores every game-specific structure as jsonb and never looks
 * inside it. These helpers are the one shared guard rail: the shape is "any JSON
 * object", bounded in size so a single save cannot be used to fill the database.
 *
 * Games layer their own Zod schemas on top of this in their own code — that is
 * where real structure is enforced, not in the database and not here.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Hard ceiling for a single jsonb document, in bytes of serialized JSON. */
export const MAX_JSON_BYTES = 256 * 1024;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const jsonValue = jsonValueSchema;

/** A jsonb document: a JSON object, at most MAX_JSON_BYTES serialized. */
export const jsonObject = z
  .record(jsonValueSchema)
  .refine((value) => byteLength(value) <= MAX_JSON_BYTES, {
    message: `document exceeds ${MAX_JSON_BYTES} bytes`,
  });

// TextEncoder rather than Buffer: this module is imported by the browser bundle
// as well as the server.
const encoder = new TextEncoder();

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? "").byteLength;
}
