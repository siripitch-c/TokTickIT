import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import AppShell from "./components/AppShell.js";
import ForbiddenState from "./components/ForbiddenState.js";
import ChangePassword from "./pages/ChangePassword.js";
import CreateTicket from "./pages/CreateTicket.js";
import Login from "./pages/Login.js";
import MyTickets from "./pages/MyTickets.js";
import StaffTicketQueue from "./pages/StaffTicketQueue.js";
import TicketDetail from "./pages/TicketDetail.js";
import UserManagement from "./pages/UserManagement.js";
import { AuthUser, Role } from "./api.js";
import { LANDING } from "./lib/landing.js";
import { UseAuthSession, useAuthSession } from "./lib/useAuthSession.js";

// Lab 3, Issue #30 — routing under a real identity.
//
// The Lab 2 guard sent anyone without a selected Requester to the selector.
// This one has three gates to apply in the order api-spec.md §3 fixes, and
// they are deliberately the same order the server uses: signed in, past the
// mandatory password change, then holding the right role. The client's version
// is feedback — every one of these routes is refused by the API as well
// (FR-08), which is what makes hiding a destination a convenience rather than
// the control.

export function AppRoutes() {
  const session = useAuthSession();

  if (session.status === "checking") {
    return (
      <div className="zg-page">
        <div data-testid="zg-state-loading" className="zg-state--loading">
          Loading&hellip;
        </div>
      </div>
    );
  }

  // BR-13 keeps "nobody is signed in" and "the server did not answer" apart,
  // and so does this: an outage shows a failure a person can retry, not a
  // login screen implying they were signed out.
  if (session.status === "unavailable") {
    return (
      <div className="zg-page">
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We could not reach the server. Please try again.</p>
          <button type="button" className="zg-btn--secondary" onClick={session.refresh}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (session.status === "signed-out") {
    return (
      <Routes>
        <Route path="/login" element={<Login onSignedIn={session.adopt} />} />
        {/* Every other URL, typed or bookmarked, lands on Login. */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // BR-02, AC-02: an account on an initial password reaches exactly one screen
  // until it saves a new one. There is no navigation and no other route — a
  // typed URL comes straight back here, and the server refuses those endpoints
  // regardless (403 PASSWORD_CHANGE_REQUIRED).
  if (session.status === "must-change-password") {
    return (
      <Routes>
        {/* ui-spec.md §5: the shell renders, without navigation items. It is
            not a full-page screen like Login, because this user *is* signed in
            and must keep the one action BR-02 leaves them — Log Out. */}
        <Route
          element={<AppShell user={session.user} onSignedOut={session.clear} navigation={false} />}
        >
          <Route
            path="/change-password"
            element={<ChangePassword mandatory onChanged={session.adopt} />}
          />
          <Route path="*" element={<Navigate to="/change-password" replace />} />
        </Route>
      </Routes>
    );
  }

  const user = session.user;
  const landing = LANDING[user.role].path;

  return (
    <Routes>
      {/* Already signed in: Login has nothing left to offer. */}
      <Route path="/login" element={<Navigate to={landing} replace />} />

      <Route element={<AppShell user={user} onSignedOut={session.clear} />}>
        <Route
          path="/change-password"
          element={<VoluntaryChangePassword session={session} landing={landing} />}
        />

        <Route element={<RoleGuard user={user} allow={["IT_STAFF", "ADMINISTRATOR"]} />}>
          <Route path="/staff/tickets" element={<StaffTicketQueue />} />
        </Route>

        <Route element={<RoleGuard user={user} allow={["ADMINISTRATOR"]} />}>
          <Route path="/admin/users" element={<UserManagement onOwnAccountChanged={session.adopt} />} />
        </Route>

        <Route element={<RoleGuard user={user} allow={["REQUESTER"]} />}>
          <Route path="/my-tickets" element={<MyTickets />} />
          <Route path="/tickets/new" element={<CreateTicket />} />
        </Route>

        {/* ui-spec.md §8: one Ticket Detail route for every role — where the
            queue's rows lead — and one screen that adapts to the role (§8.3).
            BR-38: reachable by direct URL as well as from a list, and the
            server re-checks access either way: 404 for another Requester's
            ticket (BR-16). */}
        <Route path="/tickets/:id" element={<TicketDetail />} />
      </Route>

      <Route path="*" element={<Navigate to={landing} replace />} />
    </Routes>
  );
}

/**
 * ui-spec.md §5 — the voluntary route into Change Password.
 *
 * Same screen and same endpoint as the mandatory one; what differs is that
 * navigation stays, a Cancel button exists, and there is no banner.
 */
function VoluntaryChangePassword({
  session,
  landing,
}: {
  session: UseAuthSession;
  landing: string;
}) {
  const navigate = useNavigate();
  return (
    <ChangePassword
      mandatory={false}
      onChanged={(updated: AuthUser) => {
        session.adopt(updated);
        navigate(landing, { replace: true });
      }}
      onCancel={() => navigate(-1)}
    />
  );
}

/**
 * FR-09, AC-07 — a role never renders a destination it may not use.
 *
 * Another role's URL renders the forbidden state (ui-spec.md §2.4 and §7.4,
 * tests.md E2E-04). Issue #30 redirected to the person's own landing screen
 * instead, which departed from that contract: a silent redirect leaves somebody
 * who followed a link wondering where it went, while the refusal says what
 * happened and offers the way back. The API refuses the same request anyway
 * (FR-08) — this is what the person sees, not what protects the data.
 */
function RoleGuard({ user, allow }: { user: AuthUser; allow: Role[] }) {
  if (!allow.includes(user.role)) {
    return <ForbiddenState role={user.role} />;
  }
  // The context has to be passed on, not just the children: every `Outlet`
  // sets the context its own descendants read, so a bare one here would
  // replace the shell's user with `undefined` and every screen below would
  // read nothing from `useOutletContext`.
  return <Outlet context={user} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
