import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { GameHost } from "./components/GameHost";
import { NotFound } from "./components/NotFound";
import { SessionLost } from "./components/SessionLost";
import { HubPage } from "./pages/HubPage";
import { ProfilePage } from "./pages/ProfilePage";
import { onSessionLost, sessionGivenUp } from "./auth/session";
import { startSessionWatch } from "./auth/watch";

export function App() {
  const [lost, setLost] = useState(sessionGivenUp);

  useEffect(() => onSessionLost(setLost), []);
  useEffect(() => startSessionWatch(), []);

  // Rendered outside the authenticated views: this screen carries the update
  // prompt too, so a client that cannot log in can still apply a waiting service
  // worker (otherwise a broken build is unreachable and unfixable).
  if (lost) return <SessionLost />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HubPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* Each game owns its subtree, so it can route internally. */}
        <Route path=":gameId/*" element={<GameHost />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
