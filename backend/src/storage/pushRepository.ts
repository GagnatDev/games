import type { JsonObject, PushSubscribe } from "@games/shared";
import { db } from "../db/kysely.js";
import { toJson } from "../db/schema.js";

export type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  topics: JsonObject;
};

/**
 * Endpoints are unique platform-wide, so re-subscribing the same browser under a
 * different account moves the row rather than duplicating it.
 */
export async function saveSubscription(
  userId: string,
  body: PushSubscribe,
  userAgent: string | null,
): Promise<void> {
  await db
    .insertInto("push_subscriptions")
    .values({
      user_id: userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      topics: toJson(body.topics),
      user_agent: userAgent,
    })
    .onConflict((oc) =>
      oc.column("endpoint").doUpdateSet({
        user_id: userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        topics: toJson(body.topics),
        user_agent: userAgent,
        failure_count: 0,
        updated_at: new Date(),
      }),
    )
    .execute();
}

export async function deleteSubscription(
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("push_subscriptions")
    .where("user_id", "=", userId)
    .where("endpoint", "=", endpoint)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

export async function listSubscriptions(
  userId: string,
): Promise<StoredSubscription[]> {
  const rows = await db
    .selectFrom("push_subscriptions")
    .select(["id", "endpoint", "p256dh", "auth", "topics"])
    .where("user_id", "=", userId)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    topics: (row.topics ?? {}) as JsonObject,
  }));
}

export async function markDelivered(id: string): Promise<void> {
  await db
    .updateTable("push_subscriptions")
    .set({ failure_count: 0, last_success_at: new Date(), updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

/** A 404/410 from the push service means the endpoint is gone for good. */
export async function dropSubscription(id: string): Promise<void> {
  await db.deleteFrom("push_subscriptions").where("id", "=", id).execute();
}

export async function markFailure(id: string): Promise<void> {
  await db
    .updateTable("push_subscriptions")
    .set((eb) => ({
      failure_count: eb("failure_count", "+", 1),
      updated_at: new Date(),
    }))
    .where("id", "=", id)
    .execute();
}
