import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="card card--notice">
      <h1>Nothing here</h1>
      <p>That address does not match a game.</p>
      <Link to="/">Back to the hub</Link>
    </div>
  );
}
