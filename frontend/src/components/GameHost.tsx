import { Suspense } from "react";
import { useParams } from "react-router-dom";
import { loadGame } from "../games/registry";
import { NotFound } from "./NotFound";

/**
 * Mounts the chunk for `/:gameId`.
 *
 * Everything above this component is the shell; everything below arrives in the
 * game's own chunk, fetched on first navigation and then served from the
 * service-worker precache.
 */
export function GameHost() {
  const { gameId } = useParams();
  const game = gameId ? loadGame(gameId) : undefined;

  if (!game) return <NotFound />;

  const Game = game.component;

  return (
    <Suspense fallback={<GameLoading title={game.title} />}>
      <Game />
    </Suspense>
  );
}

function GameLoading({ title }: { title: string }) {
  return (
    <div className="card card--notice" aria-live="polite">
      <p className="muted">Loading {title}…</p>
    </div>
  );
}
