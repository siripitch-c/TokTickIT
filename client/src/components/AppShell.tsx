import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AuthUser, Role, logout } from "../api.js";

// ui-spec.md §3 — Application Shell, under a real identity.
//
// Lab 2 showed the selected Requester's name and a Change Requester button
// inline. Lab 2 §3 recorded why the disclosure was deferred — "the disclosure
// returns in Lab 3, when a real account menu has more than two things in it" —
// and it now has exactly that: Change Password and Log Out.

interface Props {
  user: AuthUser;
  onSignedOut: () => void;
  /**
   * ui-spec.md §5: during a mandatory password change the shell renders
   * "without navigation items and without a way to reach any other route".
   * The shell itself still renders — that is what keeps Log Out reachable,
   * which BR-02 and api-spec.md §4 deliberately leave available to a user who
   * has not changed their password yet.
   */
  navigation?: boolean;
}

interface NavItem {
  to: string;
  label: string;
}

// FR-09, AC-07: a destination the role may not use is not rendered at all —
// not disabled, not greyed. The server refuses each of them too (FR-08), so
// this list is what a person sees, never what protects the data.
const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  REQUESTER: [
    { to: "/my-tickets", label: "My Tickets" },
    { to: "/tickets/new", label: "Create Ticket" },
  ],
  IT_STAFF: [{ to: "/staff/tickets", label: "Ticket Queue" }],
  // ui-spec.md §3 lists User Management first for the Administrator and the
  // Queue second, so account management reads as their job and the queue as
  // somewhere they go deliberately.
  ADMINISTRATOR: [
    { to: "/admin/users", label: "User Management" },
    { to: "/staff/tickets", label: "Ticket Queue" },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

export default function AppShell({ user, onSignedOut, navigation = true }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const navItems = navigation ? NAV_BY_ROLE[user.role] : [];

  // A disclosure that stays open after a click elsewhere covers the screen it
  // is sitting on; closing on an outside click is what makes it a menu rather
  // than a panel.
  useEffect(() => {
    if (!profileOpen) return;
    const close = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  async function signOut() {
    setProfileOpen(false);
    setMobileNavOpen(false);
    // The cookie is destroyed by the endpoint; this drops the local user.
    // `logout` never throws — a session that was already gone and an API that
    // cannot be reached both end the same way for the person clicking.
    await logout();
    onSignedOut();
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? "zg-nav-item zg-nav-item--active" : "zg-nav-item";

  return (
    <div className="zg-page">
      <header className="zg-header">
        <span className="zg-header-title">
          <span className="zg-header-glyph" aria-hidden="true">
            &#9201;
          </span>
          TokTickIT
        </span>

        <nav className="zg-header-nav" aria-label="Main">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="zg-header-requester" ref={profileRef}>
          <span data-testid="current-user-name">{user.name}</span>
          <span data-testid="current-user-role" className="zg-badge zg-badge--role">
            {ROLE_LABEL[user.role]}
          </span>

          <button
            type="button"
            className="zg-btn--tertiary zg-btn--on-header"
            aria-expanded={profileOpen}
            aria-controls="zg-profile-menu"
            onClick={() => setProfileOpen((open) => !open)}
          >
            Profile <span aria-hidden="true">&#9662;</span>
          </button>

          {profileOpen && (
            <div id="zg-profile-menu" className="zg-profile-menu" role="menu">
              {/* Omitted while locked to the screen it leads to. */}
              {navigation && (
                <button
                  type="button"
                  role="menuitem"
                  className="zg-btn--tertiary"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate("/change-password");
                  }}
                >
                  Change Password
                </button>
              )}
              <button type="button" role="menuitem" className="zg-btn--tertiary" onClick={signOut}>
                Log Out
              </button>
            </div>
          )}
        </div>

        {/* Mobile (<768px): the nav collapses behind a hamburger (ui-spec.md §3). */}
        <button
          type="button"
          className="zg-hamburger"
          aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileNavOpen}
          aria-controls="zg-mobile-nav"
          title={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <span aria-hidden="true">&#9776;</span>
        </button>
      </header>

      {mobileNavOpen && (
        <div id="zg-mobile-nav" className="zg-mobile-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={navClass}
              onClick={() => setMobileNavOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}

          {/* ui-spec.md §3: the role's items, then a divider, then who you are
              and what you can do about it. */}
          <hr className="zg-mobile-nav-divider" />
          <span className="zg-mobile-nav-requester">
            {user.name} · {ROLE_LABEL[user.role]}
          </span>
          {navigation && (
            <button
              type="button"
              className="zg-btn--tertiary"
              onClick={() => {
                setMobileNavOpen(false);
                navigate("/change-password");
              }}
            >
              Change Password
            </button>
          )}
          <button type="button" className="zg-btn--tertiary" onClick={signOut}>
            Log Out
          </button>
        </div>
      )}

      <main className="zg-main">
        {/* Every screen reads the signed-in user from here, the same way Lab 2
            screens read the selected Requester. */}
        <Outlet context={user} />
      </main>
    </div>
  );
}
