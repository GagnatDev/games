// Throwaway VAPID keypair for local development.
//
// Production keys are Terraform-managed (`vapid = true` in homectl-infra writes
// `games-vapid-secrets`); never generate those by hand, and never commit a pair —
// rotating VAPID keys invalidates every existing browser subscription.
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`# Append to your gitignored .env
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:dev@homectl.no`);
