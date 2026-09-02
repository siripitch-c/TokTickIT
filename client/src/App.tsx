import { useEffect, useState } from "react";
import { fetchRequesters, Requester } from "./api.js";
import {
  clearSelectedRequesterId,
  getSelectedRequesterId,
} from "./lib/requesterContext.js";
import RequesterSelection from "./components/RequesterSelection.js";

// Issue #12 — Data model foundation & Requester context
//
// This replaces the Lab 1 "Check System" demo page. The Development
// Requester selector (ui-spec.md §4) is now the real entry point of the
// app: on mount we try to restore a previously-selected Requester from
// sessionStorage (BR-06); if there is none, or the stored id no longer
// resolves to an active Requester, we show RequesterSelection. Once a
// Requester is active, a minimal app shell displays their name and a
// "Change Requester" action (BR-07) that clears the stored selection and
// returns to the selector. The full header/nav bar from ui-spec.md §3
// (My Tickets / Create Ticket links) is intentionally deferred to the
// issues that actually implement those screens (#13/#14/#15) rather than
// linking to routes that do not exist yet.
type AppState =
  | { status: "checking" }
  | { status: "needs-selection" }
  | { status: "ready"; requester: Requester };

export default function App() {
  const [state, setState] = useState<AppState>({ status: "checking" });

  useEffect(() => {
    restoreSession();
  }, []);

  // BR-06: try to resume the previously-selected Requester from
  // sessionStorage. Re-fetches the active-Requester list rather than
  // trusting a cached name, so a Requester who became inactive since the
  // last visit is caught and sent back to the selector instead of being
  // shown as a stale "ready" shell.
  async function restoreSession() {
    const id = getSelectedRequesterId();
    if (id === null) {
      setState({ status: "needs-selection" });
      return;
    }

    try {
      const requesters = await fetchRequesters();
      const match = requesters.find((r) => r.id === id);
      if (match) {
        setState({ status: "ready", requester: match });
      } else {
        // Stored id no longer resolves to an active Requester (e.g. the
        // seeded testing account was deactivated) — do not get stuck on a
        // broken shell; fall back to a clean re-selection.
        clearSelectedRequesterId();
        setState({ status: "needs-selection" });
      }
    } catch {
      // Safe fallback: if we can't verify the stored id right now, don't
      // show a shell we can't back up. Selecting again is always possible.
      clearSelectedRequesterId();
      setState({ status: "needs-selection" });
    }
  }

  // RequesterSelection has already written the id to sessionStorage
  // (BR-06) before calling this; re-resolving through the same path keeps
  // a single source of truth for "who is the current Requester".
  function handleContinue() {
    setState({ status: "checking" });
    restoreSession();
  }

  // BR-07: clear the stored selection and return to the selector so no
  // stale Requester context can remain visible.
  function handleChangeRequester() {
    clearSelectedRequesterId();
    setState({ status: "needs-selection" });
  }

  if (state.status === "checking") {
    return (
      <div className="zg-page" style={{ background: "var(--zg-bg)" }}>
        <div data-testid="zg-state-loading" className="zg-state--loading">
          Loading…
        </div>
      </div>
    );
  }

  if (state.status === "needs-selection") {
    return <RequesterSelection onContinue={handleContinue} />;
  }

  return (
    <div className="zg-page" style={{ background: "var(--zg-bg)" }}>
      <header
        className="zg-header"
        style={{ background: "var(--zg-primary)", color: "#fff" }}
      >
        <span className="zg-header-title">TokTickIT</span>
        <div className="zg-header-requester">
          <span data-testid="current-requester-name">
            {state.requester.name}
          </span>
          <button
            type="button"
            className="zg-btn--tertiary"
            onClick={handleChangeRequester}
          >
            Change Requester
          </button>
        </div>
      </header>

      <main className="zg-card" style={{ maxWidth: 720, margin: "24px auto" }}>
        <p className="zg-text-sm zg-text-muted">
          You're viewing TokTickIT as{" "}
          <strong>{state.requester.name}</strong>. Create Ticket, My Tickets,
          and Ticket Detail will be implemented in upcoming issues (#13–#15).
        </p>
      </main>
    </div>
  );
}