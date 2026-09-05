import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import RequesterSelection from "./components/RequesterSelection.js";
import AppShell from "./components/AppShell.js";
import CreateTicket from "./pages/CreateTicket.js";
import MyTickets from "./pages/MyTickets.js";
import TicketDetail from "./pages/TicketDetail.js";
import { UseRequesterSession, useRequesterSession } from "./lib/useRequesterSession.js";

// Issue #13 — routing and the Requester route guard.
//
// ui-spec.md §4 requires the "no Requester selected" redirect to live once at
// the routing level rather than being repeated inside each screen, so
// RequesterGuard is the single place that decides between the selector and the
// application shell (tests.md E2E-02). Routes are real URLs, not view state,
// because Ticket Detail is reachable by direct link in #15 (BR-38).

const DEFAULT_ROUTE = "/my-tickets";

export function AppRoutes() {
  const session = useRequesterSession();

  if (session.status === "checking") {
    return (
      <div className="zg-page">
        <div data-testid="zg-state-loading" className="zg-state--loading">
          Loading&hellip;
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/select-requester" element={<SelectRequesterRoute session={session} />} />
      <Route element={<RequesterGuard session={session} />}>
        <Route path={DEFAULT_ROUTE} element={<MyTickets />} />
        <Route path="/tickets/new" element={<CreateTicket />} />
        {/* BR-38: reachable by direct URL as well as from the list; the guard
            above and the server both re-check ownership either way. */}
        <Route path="/tickets/:id" element={<TicketDetail />} />
      </Route>
      {/* Anything else (including "/") lands on the Requester's own list. */}
      <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
    </Routes>
  );
}

// Renders the selector, or bounces straight back out when a Requester is
// already chosen — returning to whichever route asked for the selection.
function SelectRequesterRoute({ session }: { session: UseRequesterSession }) {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (session.status === "ready") {
    return <Navigate to={from ?? DEFAULT_ROUTE} replace />;
  }
  return <RequesterSelection onContinue={session.refresh} />;
}

// AC-02/BR-04: a screen that needs a Requester never renders without one. The
// requested route is remembered so the Requester resumes where they aimed.
function RequesterGuard({ session }: { session: UseRequesterSession }) {
  const location = useLocation();

  if (session.status !== "ready") {
    return (
      <Navigate
        to="/select-requester"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <AppShell requester={session.requester} onChangeRequester={session.changeRequester} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
