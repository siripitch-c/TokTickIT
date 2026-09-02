import { Link } from "react-router-dom";

// Placeholder for Issue #14 (My Tickets: list, search, filters, sorting,
// pagination, empty/no-results states). It exists now only because routing
// arrived with Issue #13 and /my-tickets is the app's default route — the
// shell must land somewhere real rather than on a dead link. Everything
// inside this component is replaced wholesale by #14.
export default function MyTickets() {
  return (
    <section className="zg-card">
      <h1 className="zg-text-xl">My Tickets</h1>
      <p className="zg-text-sm zg-text-muted">
        The ticket list, search, filters, sorting, and pagination arrive with
        Issue #14. You can create a ticket now.
      </p>
      <div className="zg-actions-row">
        <Link className="zg-btn--primary" to="/tickets/new">
          Create Ticket
        </Link>
      </div>
    </section>
  );
}
