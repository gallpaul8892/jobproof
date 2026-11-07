import { Link } from "react-router";
import { useDocumentTitle } from "../components/ui";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <main className="fullpage" id="main">
      <section className="panel narrow">
        <h1>Page not found</h1>
        <p>There is nothing at this address.</p>
        <Link className="btn btn-primary" to="/">
          Go to the dashboard
        </Link>
      </section>
    </main>
  );
}
