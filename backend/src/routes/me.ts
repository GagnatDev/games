import { Router } from "express";
import { profileUpdateSchema, type SessionResponse } from "@games/shared";
import { asyncHandler } from "../middleware/errors.js";
import { toMeResponse, updateProfile } from "../storage/userRepository.js";

export function meRouter(): Router {
  const router = Router();

  /**
   * Cheap session probe. The PWA calls it on focus so an expired session becomes
   * a deliberate re-login instead of a mid-action failure (see docs/pwa.md).
   */
  router.get("/session", (req, res) => {
    const body: SessionResponse = {
      authenticated: true,
      userId: req.userId!,
      role: req.appUser?.appRole ?? null,
    };
    res.json(body);
  });

  router.get("/me", (req, res) => {
    res.json(toMeResponse(req.appUser!));
  });

  router.patch(
    "/me",
    asyncHandler(async (req, res) => {
      const patch = profileUpdateSchema.parse(req.body);
      const user = await updateProfile(req.userId!, patch);
      res.json(toMeResponse(user));
    }),
  );

  return router;
}
