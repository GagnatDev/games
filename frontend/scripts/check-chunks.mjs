// Guard the code-splitting promise: every game in the catalogue must build into
// its own chunk, so opening one game never downloads another's code.
//
// Runs as the last step of `pnpm --filter @games/frontend build`, which means CI
// fails if someone imports a game statically from the shell.
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_IDS } from "@games/shared";

const assetsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "assets",
);

const files = await readdir(assetsDir);
const missing = GAME_IDS.filter(
  (id) => !files.some((file) => file.startsWith(`game-${id}-`) && file.endsWith(".js")),
);

if (missing.length > 0) {
  console.error(
    `Missing per-game chunk(s): ${missing.join(", ")}\n` +
      `Each game must be reached through a lazy import in src/games/registry.ts.\n` +
      `Built assets: ${files.filter((f) => f.endsWith(".js")).join(", ")}`,
  );
  process.exit(1);
}

const entry = files.find((f) => f.startsWith("index-") && f.endsWith(".js"));
console.log(
  `chunk check ok — ${GAME_IDS.length} game chunk(s), entry ${entry ?? "(unknown)"}`,
);
