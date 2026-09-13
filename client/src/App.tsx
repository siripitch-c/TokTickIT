import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import AppShell from "./components/AppShell.js";
import ChangePassword from "./pages/ChangePassword.js";
import CreateTicket from "./pages/CreateTicket.js";
import Login from "./pages/Login.js";
import MyTickets from "./pages/MyTickets.js";
import TicketDetail from "./pages/TicketDetail.js";
import { AuthUser, Role } from "./api.js";
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

// ui-spec.md §3: where each role lands, and the route that "/" resolves to.
const LANDING: Record<Role, string> = {
  REQUESTER: "/my-tickets",
  IT_STAFF: "/staff/tickets",
  ADMINISTRATOR: "/admin/users",
};

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
  const landing = LANDING[user.role];

  return (
    <Routes>
      {/* Already signed in: Login has nothing left to offer. */}
      <Route path="/login" element={<Navigate to={landing} replace />} />

      <Route element={<AppShell user={user} onSignedOut={session.clear} />}>
        <Route
          path="/change-password"
          element={<VoluntaryChangePassword session={session} landing={landing} />}
        />

        {/* ui-spec.md §3 fixes these two paths; only their elements are
            still missing. */}
        <Route element={<RoleGuard user={user} allow={["IT_STAFF", "ADMINISTRATOR"]} landing={landing} />}>
          <Route
            path="/staff/tickets"
            element={<ScreenNotYetBuilt screen="The IT Staff ticket queue" issue="Issue #31" />}
          />
        </Route>

        <Route element={<RoleGuard user={user} allow={["ADMINISTRATOR"]} landing={landing} />}>
          <Route
            path="/admin/users"
            element={<ScreenNotYetBuilt screen="User Management" issue="Issue #33" />}
          />
        </Route>

        <Route element={<RoleGuard user={user} allow={["REQUESTER"]} landing={landing} />}>
          <Route path="/my-tickets" element={<MyTickets />} />
          <Route path="/tickets/new" element={<CreateTicket />} />
          {/* BR-38: reachable by direct URL as well as from the list; the
              server re-checks ownership either way and answers 404 for
              somebody else's ticket (BR-16). */}
          <Route path="/tickets/:id" element={<TicketDetail />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={landing} replace />} />
    </Routes>
  );
}

/**
 * A landing route whose screen belongs to a later issue.
 *
 * ui-spec.md §3 gives all three roles a landing route, but the queue arrives
 * with Issue #31 and User Management with Issue #33. Without an element on
 * those paths a signed-in IT Staff member or Administrator lands on an
 * unmatched route, which the catch-all sends straight back to the landing they
 * came from: a blank page, with no shell and no way to log out.
 *
 * It exists to prevent that and for no other reason. Issues #31 and #33 delete
 * it by putting the real screen on the path it is already holding.
 */
function ScreenNotYetBuilt({ screen, issue }: { screen: string; issue: string }) {
  return (
    <div data-testid="zg-state-not-built" className="zg-state--empty">
      <p>{screen} is not part of this increment.</p>
      <p>It arrives with {issue}.</p>
    </div>
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
 * It redirects rather than showing the forbidden state: this fires only when
 * somebody types another role's URL, and their own landing screen is a more
 * useful answer than a refusal. The forbidden state belongs to a screen that
 * *did* render and then got a 403 from the API, which is the case that proves
 * the server is the control.
 */
function RoleGuard({
  user,
  allow,
  landing,
}: {
  user: AuthUser;
  allow: Role[];
  landing: string;
}) {
  const location = useLocation();

  if (!allow.includes(user.role)) {
    return <Navigate to={landing} replace state={{ blocked: location.pathname }} />;
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
