import type { PushConfigResponse } from "@games/shared";
import { api } from "../api/client";

/**
 * Web Push enrolment.
 *
 * The VAPID public key is fetched from the API rather than baked into the bundle:
 * it comes from the Terraform-managed `games-vapid-secrets` Secret at runtime, so
 * a build-time `VITE_` variable would freeze whatever value happened to exist when
 * the image was built. A `null` key means the deployment has no VAPID secret and
 * push is simply unavailable.
 */

export type PushState =
  | { status: "unsupported" }
  | { status: "unconfigured" }
  | { status: "denied" }
  | { status: "off" }
  | { status: "on"; endpoint: string };

export async function readPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { status: "unsupported" };
  }

  const { publicKey } = await api.get<PushConfigResponse>("/api/push/config");
  if (!publicKey) return { status: "unconfigured" };

  if (Notification.permission === "denied") return { status: "denied" };

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing ? { status: "on", endpoint: existing.endpoint } : { status: "off" };
}

export async function enablePush(): Promise<PushState> {
  const { publicKey } = await api.get<PushConfigResponse>("/api/push/config");
  if (!publicKey) return { status: "unconfigured" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("the browser returned an incomplete push subscription");
  }

  await api.post("/api/push/subscriptions", {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });

  return { status: "on", endpoint: json.endpoint };
}

export async function disablePush(): Promise<PushState> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return { status: "off" };

  const { endpoint } = subscription;
  await subscription.unsubscribe();
  await api.del("/api/push/subscriptions", { endpoint });
  return { status: "off" };
}

/** Send a notification to this player's own devices — the VAPID smoke test. */
export async function sendTestPush(): Promise<{ sent: number }> {
  return await api.post<{ sent: number }>("/api/push/test", {
    title: "games.homectl.no",
    body: "Web Push is wired up.",
    url: "/",
  });
}

/**
 * VAPID keys are URL-safe base64; PushManager wants raw bytes.
 *
 * Backed by an explicit ArrayBuffer so the result is a `Uint8Array<ArrayBuffer>`
 * — `BufferSource` does not accept the `ArrayBufferLike` a bare `new Uint8Array`
 * is typed as.
 */
function urlBase64ToUint8Array(base64UrlSafe: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64UrlSafe.length % 4)) % 4);
  const base64 = (base64UrlSafe + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
