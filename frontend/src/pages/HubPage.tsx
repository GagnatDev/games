import { Link } from "react-router-dom";
import type { GameSummary } from "@games/shared";
import { useApi } from "../hooks/useApi";

const STATUS_LABEL: Record<string, string> = {
  shell: "in development",
  alpha: "alpha",
  beta: "beta",
  live: "playable",
};

export function HubPage() {
  const { data, error, loading } = useApi<GameSummary[]>("/api/games");

  return (
    <section className="stack">
      <header className="page-head">
        <h1>Games</h1>
        <p className="muted">
          Each game lives at its own address and loads on its own — nothing else
          comes down with it.
        </p>
      </header>

      {loading && <p className="muted">Loading the catalogue…</p>}
      {error && <p className="error">Could not load the catalogue: {error}</p>}

      <ul className="grid" role="list">
        {(data ?? []).map((game) => (
          <li key={game.id}>
            <Link to={`/${game.id}`} className="card card--game">
              <span className={`pill pill--${game.status}`}>
                {STATUS_LABEL[game.status] ?? game.status}
              </span>
              <h2>{game.title}</h2>
              <p>{game.tagline}</p>
              <p className="muted small">
                {game.lastPlayedAt
                  ? `Last played ${new Date(game.lastPlayedAt).toLocaleDateString()}`
                  : "Not started"}
              </p>
              <code className="muted small">games.homectl.no/{game.id}</code>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
