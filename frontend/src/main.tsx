import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/register";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    {/*
      The router owns the app-origin paths (`/`, `/landfall`, `/profile`), which
      is why the SPA is served from every non-/static path by the backend: a deep
      link is a real top-level navigation, so the auth sidecar gets to run the
      login redirect before React ever boots.
    */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

registerServiceWorker();
