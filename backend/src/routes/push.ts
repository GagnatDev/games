import { Router } from "express";
import { z } from "zod";
import {
  type PushConfigResponse,
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "@games/shared";
import { HttpError, asyncHandler } from "../middleware/errors.js";
import { publicKey, pushEnabled, sendToUser } from "../push/webpush.js";
import { deleteSubscription, saveSubscription } from "../storage/pushRepository.js";

const testPushSchema = z
  .object({
    title: z.string().trim().min(1).max(120).default("games.homectl.no"),
    body: z.string().trim().min(1).max(400).default("Web Push is wired up."),
    url: z.string().startsWith("/").max(512).default("/"),
  })
  .strict();

export function pushRouter(): Router {
  const router = Router();

  /**
   * The VAPID public key is served at runtime rather than baked into the bundle:
   * it arrives in the pod from the Terraform-managed `games-vapid-secrets`
   * Secret, and a VITE_ variable would freeze whatever value existed at build
   * time. `null` means the deployment has no keys and the SPA hides push.
   */
  router.get("/push/config", (_req, res) => {
    const body: PushConfigResponse = { publicKey: publicKey() };
    res.json(body);
  });

  router.post(
    "/push/subscriptions",
    asyncHandler(async (req, res) => {
      const body = pushSubscribeSchema.parse(req.body);
      await saveSubscription(req.userId!, body, req.get("user-agent") ?? null);
      res.status(201).json({ ok: true });
    }),
  );

  router.delete(
    "/push/subscriptions",
    asyncHandler(async (req, res) => {
      const body = pushUnsubscribeSchema.parse(req.body);
      await deleteSubscription(req.userId!, body.endpoint);
      res.status(204).end();
    }),
  );

  /**
   * Send a notification to the caller's own devices. This is the deploy check for
   * the VAPID wiring — it proves the Secret reached the pod and the keypair is
   * accepted by the push service, without needing a game to exist yet.
   */
  router.post(
    "/push/test",
    asyncHandler(async (req, res) => {
      if (!pushEnabled()) {
        throw new HttpError(503, "push_disabled", "no VAPID keys configured");
      }
      const body = testPushSchema.parse(req.body ?? {});
      res.json(await sendToUser(req.userId!, { ...body, tag: "push-test" }));
    }),
  );

  return router;
}
