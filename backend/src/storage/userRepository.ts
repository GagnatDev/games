import { sql } from "kysely";
import type { JsonObject, MeResponse, ProfileUpdate } from "@games/shared";
import { db } from "../db/kysely.js";
import { toJson } from "../db/schema.js";

export type AppUser = {
  id: string;
  authSub: string;
  email: string | null;
  displayName: string | null;
  appRole: string | null;
  profile: JsonObject;
  createdAt: Date;
};

type Row = {
  id: string;
  auth_sub: string;
  email: string | null;
  display_name: string | null;
  app_role: string | null;
  profile: JsonObject;
  created_at: Date;
};

/**
 * Just-in-time provisioning: the auth service owns identity, this app owns its
 * player rows, and `auth_sub` is the only link. A single upsert means the very
 * first request of a brand-new player already has a `users.id` to scope by, with
 * no signup step and no race between concurrent first requests.
 *
 * A display name the player has set is never overwritten by the auth service's
 * value, and a null email from the sidecar never wipes a stored one.
 */
export async function upsertByAuthSub(input: {
  authSub: string;
  email: string | null;
  role: string | null;
}): Promise<AppUser> {
  const fallbackName = input.email?.split("@")[0] ?? null;

  const result = await sql<Row>`
    INSERT INTO users (auth_sub, email, display_name, app_role)
    VALUES (${input.authSub}, ${input.email}, ${fallbackName}, ${input.role})
    ON CONFLICT (auth_sub) DO UPDATE SET
      email        = COALESCE(EXCLUDED.email, users.email),
      display_name = COALESCE(users.display_name, EXCLUDED.display_name),
      app_role     = COALESCE(EXCLUDED.app_role, users.app_role),
      updated_at   = now()
    RETURNING id, auth_sub, email, display_name, app_role, profile, created_at
  `.execute(db);

  const row = result.rows[0];
  if (!row) throw new Error("failed to provision user row");
  return toAppUser(row);
}

export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<AppUser> {
  const row = await db
    .updateTable("users")
    .set({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.profile !== undefined ? { profile: toJson(patch.profile) } : {}),
      updated_at: new Date(),
    })
    .where("id", "=", userId)
    .returning([
      "id",
      "auth_sub",
      "email",
      "display_name",
      "app_role",
      "profile",
      "created_at",
    ])
    .executeTakeFirst();

  if (!row) throw new Error("user not found");
  return toAppUser(row as Row);
}

export function toMeResponse(user: AppUser): MeResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.appRole,
    profile: user.profile,
    createdAt: user.createdAt.toISOString(),
  };
}

function toAppUser(row: Row): AppUser {
  return {
    id: row.id,
    authSub: row.auth_sub,
    email: row.email,
    displayName: row.display_name,
    appRole: row.app_role,
    profile: row.profile ?? {},
    createdAt: row.created_at,
  };
}
