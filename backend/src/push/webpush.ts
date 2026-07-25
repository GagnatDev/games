import webpush, { type WebPushError } from "web-push";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import {
  dropSubscription,
  listSubscriptions,
  markDelivered,
  markFailure,
} from "../storage/pushRepository.js";

/**
 * Web Push with the Terraform-managed VAPID keypair (`games-vapid-secrets`,
 * `vapid = true` in homectl-infra). With no keys configured the whole feature is
 * simply off — the API reports a null public key and the SPA hides push, which
 * is what local dev and CI run with.
 */
const enabled = env.push !== null;

if (enabled && env.push) {
  webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);
  logger.info("web push enabled");
} else {
  logger.info("web push disabled (no VAPID keys configured)");
}

export function pushEnabled(): boolean {
  return enabled;
}

export function publicKey(): string | null {
  return env.push?.publicKey ?? null;
}

export type PushPayload = {
  title: string;
  body: string;
  /** Path inside the app to open on click, e.g. `/landfall`. */
  url?: string;
  /** Collapses repeat notifications for the same thing. */
  tag?: string;
  data?: Record<string, unknown>;
};

export type PushResult = { sent: number; removed: number; failed: number };

/** Fan a notification out to every device a player has registered. */
export async function sendToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!enabled) return { sent: 0, removed: 0, failed: 0 };

  const subscriptions = await listSubscriptions(userId);
  const body = JSON.stringify(payload);
  const result: PushResult = { sent: 0, removed: 0, failed: 0 };

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        await markDelivered(sub.id);
        result.sent += 1;
      } catch (err) {
        const status = (err as WebPushError).statusCode;
        // Gone for good: the browser uninstalled the app or revoked permission.
        if (status === 404 || status === 410) {
          await dropSubscription(sub.id);
          result.removed += 1;
          return;
        }
        await markFailure(sub.id);
        result.failed += 1;
        logger.warn({ status, endpoint: sub.endpoint }, "web push delivery failed");
      }
    }),
  );

  return result;
}
