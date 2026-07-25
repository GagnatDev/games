import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  DEFAULT_SLOT,
  boardSchema,
  eventsWriteSchema,
  findGame,
  progressWriteSchema,
  saveWriteSchema,
  scoreWriteSchema,
  slotSchema,
} from "@games/shared";
import { HttpError, asyncHandler, notFound } from "../middleware/errors.js";
import {
  appendEvents,
  deleteSave,
  getProgress,
  getSave,
  leaderboard,
  listEvents,
  listGamesForUser,
  listSaves,
  recordScore,
  writeProgress,
  writeSave,
} from "../storage/gameRepository.js";

const limitSchema = z.coerce.number().int().positive().max(200).default(50);

/**
 * The generic gameplay API. Every route is envelope-only: it knows about a
 * player, a game, a slot and a revision, and passes each game's own documents
 * through to jsonb untouched. A new game needs no route here.
 */
export function gamesRouter(): Router {
  const router = Router();

  router.get(
    "/games",
    asyncHandler(async (req, res) => {
      res.json(await listGamesForUser(req.userId!));
    }),
  );

  // mergeParams so the nested handlers still see :gameId from the mount path.
  const game = Router({ mergeParams: true });
  router.use("/games/:gameId", requireKnownGame, game);

  // ── Saves ────────────────────────────────────────────────────────────────
  game.get(
    "/saves",
    asyncHandler(async (req, res) => {
      res.json(await listSaves(req.userId!, gameId(req)));
    }),
  );

  game.get(
    "/saves/:slot",
    asyncHandler(async (req, res) => {
      const save = await getSave(req.userId!, gameId(req), slot(req));
      if (!save) throw notFound("save_not_found");
      res.json(save);
    }),
  );

  game.put(
    "/saves/:slot",
    asyncHandler(async (req, res) => {
      const body = saveWriteSchema.parse(req.body);
      const result = await writeSave(req.userId!, gameId(req), slot(req), body);

      if (!result.ok) {
        // The client read an older revision; hand back ours so it can merge.
        res.status(409).json({
          error: "revision_conflict",
          message: "the save moved on since you read it",
          ...(result.currentRevision !== null
            ? { currentRevision: result.currentRevision }
            : {}),
        });
        return;
      }

      res.json(result.save);
    }),
  );

  game.delete(
    "/saves/:slot",
    asyncHandler(async (req, res) => {
      const deleted = await deleteSave(req.userId!, gameId(req), slot(req));
      if (!deleted) throw notFound("save_not_found");
      res.status(204).end();
    }),
  );

  // ── Progression ──────────────────────────────────────────────────────────
  game.get(
    "/progress",
    asyncHandler(async (req, res) => {
      res.json(await getProgress(req.userId!, gameId(req)));
    }),
  );

  // PUT replaces the documents, PATCH shallow-merges them (jsonb `||`).
  game.put(
    "/progress",
    asyncHandler(async (req, res) => {
      const body = progressWriteSchema.parse(req.body);
      res.json(await writeProgress(req.userId!, gameId(req), body, "replace"));
    }),
  );

  game.patch(
    "/progress",
    asyncHandler(async (req, res) => {
      const body = progressWriteSchema.parse(req.body);
      res.json(await writeProgress(req.userId!, gameId(req), body, "merge"));
    }),
  );

  // ── Events ───────────────────────────────────────────────────────────────
  game.post(
    "/events",
    asyncHandler(async (req, res) => {
      const body = eventsWriteSchema.parse(req.body);
      const appended = await appendEvents(req.userId!, gameId(req), body);
      res.status(201).json({ appended });
    }),
  );

  game.get(
    "/events",
    asyncHandler(async (req, res) => {
      const limit = limitSchema.parse(req.query["limit"]);
      res.json(await listEvents(req.userId!, gameId(req), limit));
    }),
  );

  // ── Scores ───────────────────────────────────────────────────────────────
  game.post(
    "/scores",
    asyncHandler(async (req, res) => {
      const body = scoreWriteSchema.parse(req.body);
      await recordScore(req.userId!, gameId(req), body);
      res.status(201).json({ ok: true });
    }),
  );

  game.get(
    "/scores",
    asyncHandler(async (req, res) => {
      const board = boardSchema.default("default").parse(req.query["board"]);
      const limit = limitSchema.parse(req.query["limit"]);
      res.json(await leaderboard(gameId(req), board, limit));
    }),
  );

  return router;
}

/**
 * 404 unless the id is in the code-owned catalogue. Keeps a typo'd slug from
 * silently creating orphan rows, and keeps the FK from being the error surface.
 */
function requireKnownGame(req: Request, _res: Response, next: NextFunction): void {
  const id = req.params["gameId"];
  if (!id || !findGame(id)) {
    next(new HttpError(404, "unknown_game", `no game with id '${id ?? ""}'`));
    return;
  }
  next();
}

function gameId(req: Request): string {
  return req.params["gameId"]!;
}

function slot(req: Request): string {
  return slotSchema.default(DEFAULT_SLOT).parse(req.params["slot"]);
}
