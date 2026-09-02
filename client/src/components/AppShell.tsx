import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Requester } from "../api.js";

// ui-spec.md §3 — Application Shell.
// Rendered as the layout route around every Requester-scoped screen, so the
// header, navigation, and Change Requester action exist in exactly one place
// (My Tickets and Ticket Detail inherit it unchanged in #14/#15).

interface Props {
  requester: Requester;
  onChangeRequester: () => void;
}

const NAV_ITEMS = [
  { to: "/my-tickets", label: "My Tickets" },
  { to: "/tickets/new", label: "Create Ticket" },
];

export default function AppShell({ requester, onChangeRequester }: Props) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="zg-header-requester">
          <span data-testid="current-requester-name">{requester.name}</span>
          <button type="button" className="zg-btn--tertiary zg-btn--on-header" onClick={onChangeRequester}>
            Change Requester
          </button>
        </div>

        {/* Mobile (<768px): the nav collapses behind a hamburger (ui-spec.md §3). */}
        <button
          type="button"
          className="zg-hamburger"
          aria-label="Open navigation menu"
          aria-expanded={mobileNavOpen}
          aria-controls="zg-mobile-nav"
          title="Open navigation menu"
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          <span aria-hidden="true">&#9776;</span>
        </button>
      </header>

      {mobileNavOpen && (
        <div id="zg-mobile-nav" className="zg-mobile-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={navClass}
              onClick={() => setMobileNavOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <span className="zg-mobile-nav-requester">{requester.name}</span>
          <button
            type="button"
            className="zg-btn--tertiary"
            onClick={() => {
              setMobileNavOpen(false);
              onChangeRequester();
            }}
          >
            Change Requester
          </button>
        </div>
      )}

      <main className="zg-main">
        {/* Every Requester-scoped screen reads the current identity from here. */}
        <Outlet context={requester} />
      </main>
    </div>
  );
}
