import { Link, NavLink, Outlet } from "react-router-dom";
import { UpdateBanner } from "./UpdateBanner";

export function Layout() {
  return (
    <div className="app">
      <header className="app__bar">
        <Link to="/" className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          <span>games</span>
          <span className="app__brand-host">.homectl.no</span>
        </Link>
        <nav className="app__nav">
          <NavLink to="/" end>
            Hub
          </NavLink>
          <NavLink to="/profile">Profile</NavLink>
        </nav>
      </header>

      <UpdateBanner />

      <main className="app__main">
        <Outlet />
      </main>

      <footer className="app__footer">
        <span>
          Signed in through <code>auth.homectl.no</code>
        </span>
        {/*
          A real form POST, not a link: /auth/logout is a POST route on the auth
          sidecar. It clears the session cookie and redirects to '/'. (In
          AUTH_MODE=dev there is no sidecar, so this 404s — expected.)
        */}
        <form method="post" action="/auth/logout">
          <button type="submit" className="link-button" data-testid="logout">
            Sign out
          </button>
        </form>
      </footer>
    </div>
  );
}
