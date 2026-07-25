# Adding a game

Four files, no database migration, no new API route. The platform's generic
gameplay API already covers saves, progression, events and leaderboards — see
[data-model.md](data-model.md).

Assume the new game is `harbourmaster`, reachable at
`https://games.homectl.no/harbourmaster`.

## 1. Register it in the catalogue

`shared/src/catalogue.ts` is the source of truth for what games exist:

```ts
export const HARBOURMASTER_ID = "harbourmaster";

export const GAMES: readonly GameDefinition[] = [
  // ...
  {
    id: HARBOURMASTER_ID,          // the URL slug; stable forever, saves key off it
    title: "Harbourmaster",
    tagline: "Berth them all before the tide turns.",
    status: "shell",               // shell | alpha | beta | live
    stateVersion: 1,
    config: {},                    // static, game-owned tuning
  },
];
```

The backend upserts this into the `games` table at boot, so the row appears on the
next deploy. Nothing to insert by hand.

## 2. Write the game's own state schema

`frontend/src/games/harbourmaster/state.ts`. The database stores `state` as opaque
jsonb; this is the only place that knows its shape:

```ts
export const STATE_VERSION = 1;

export const harbourmasterStateSchema = z.object({
  version: z.literal(STATE_VERSION),
  // ...whatever the game needs
});
```

Bumping `STATE_VERSION` plus migrating old saves in this file is the whole
migration story for game state. Never reset a save you cannot parse — report it.

## 3. Add the component

`frontend/src/games/harbourmaster/index.tsx`, with a **default export**. Everything
under this directory ends up in the game's own chunk, so it can bring its own
dependencies and its own CSS without any other game paying for them.

Talk to the API through `api` from `frontend/src/api/client`:

```ts
const save = await api.get<SaveResponse>(`/api/games/${HARBOURMASTER_ID}/saves/default`);
await api.put(`/api/games/${HARBOURMASTER_ID}/saves/default`, {
  state,
  stateVersion: STATE_VERSION,
  expectedRevision: save.revision,   // 409 instead of clobbering another device
});
```

`api` classifies an expired session for you (401 or redirect → one guarded
re-login navigation), so treat only real `ApiError`s as failures. A `404` from a
save slot just means "never started".

## 4. Wire the lazy loader

`frontend/src/games/registry.ts`:

```ts
const loaders: Record<string, GameComponent> = {
  [LANDFALL_ID]: lazy(() => import("./landfall/index")),
  [HARBOURMASTER_ID]: lazy(() => import("./harbourmaster/index")),
};
```

Keep the path literal and the import lazy. A static import — or a templated
`import(\`./games/${id}\`)` — collapses the code splitting;
`frontend/scripts/check-chunks.mjs` fails the build if a game has no chunk of its
own.

## 5. Verify

```bash
pnpm build          # includes the per-game chunk check
pnpm test
pnpm test:e2e
```

The route is live at `/harbourmaster` with no routing change — `GameHost` resolves
`:gameId` through the registry.

## A worked example

`frontend/src/games/2048/` is this procedure carried out end to end: rules in
`engine.ts` (pure, unit-tested), the save document and its transitions in
`state.ts`, input and API traffic in `index.tsx`, and its own `styles.css` riding
along in the same chunk. It also shows the platform's other three surfaces in
use — `progress` for lifetime stats, `scores` for a leaderboard, `events` for a
run's milestones — and `e2e/src/2048.spec.ts` seeds a known board through
`PUT /saves/default` rather than reaching into the database.

## Notes

- **Notifications.** `POST /api/push/test` sends to the caller's devices. For real
  pushes, call `sendToUser(userId, { title, body, url: "/harbourmaster" })` from a
  backend job; a `url` inside the app opens the right screen on click.
- **Leaderboards.** `POST /api/games/<id>/scores` with a `board` name. The `GET`
  returns each player's best score on that board, ranked, with display names.
- **Internal routing.** The route is mounted as `:gameId/*`, so a game may keep its
  own nested routes.
- **Offline.** The service worker precaches the chunk but deliberately does not
  handle navigations — read [pwa.md](pwa.md) before designing anything offline.
