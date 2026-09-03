import { useEffect, useState } from "react";
import { fetchRequesters, Requester } from "../api.js";
import { setSelectedRequesterId } from "../lib/requesterContext.js";

// ui-spec.md §4 — Development Requester Selection Screen.
// BR-04: this selector is a Lab 2 testing mechanism, not authentication.
type ScreenState = "loading" | "empty" | "error" | "populated";

interface Props {
  // Called once the Requester picks a value and presses Continue (BR-06).
  onContinue: (requesterId: number) => void;
}

export default function RequesterSelection({ onContinue }: Props) {
  const [state, setState] = useState<ScreenState>("loading");
  const [requesters, setRequesters] = useState<Requester[]>([]);
  const [selectedId, setSelectedId] = useState<number | "">("");

  async function load() {
    setState("loading");
    try {
      const data = await fetchRequesters();
      if (data.length === 0) {
        setState("empty"); // BR-09
      } else {
        setRequesters(data);
        setState("populated");
      }
    } catch {
      setState("error"); // BR-08
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleContinue() {
    if (selectedId === "") return;
    setSelectedRequesterId(Number(selectedId));
    onContinue(Number(selectedId));
  }

  return (
    <div className="zg-page" style={{ background: "var(--zg-bg)" }}>
      <div className="zg-card" style={{ maxWidth: 480, margin: "0 auto" }}>
        <div className="zg-icon-badge" aria-hidden="true">
          {/* ui-spec.md §4: person + gear glyph. Inline SVG rather than an
              emoji so it inherits the Zen Green token colour and stays crisp. */}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="7" r="3.2" />
            <path d="M2.5 19.5c0-3.2 2.9-5.2 6.5-5.2 1.2 0 2.3.2 3.2.6" />
            <circle cx="17.5" cy="16.5" r="2.4" />
            <path d="M17.5 12.6v1.1M17.5 19.3v1.1M13.6 16.5h1.1M20.3 16.5h1.1M14.7 13.7l.8.8M19.5 18.5l.8.8M20.3 13.7l-.8.8M15.5 18.5l-.8.8" />
          </svg>
        </div>
        <h1 className="zg-text-xl">Select Development Requester</h1>
        <p className="zg-text-sm zg-text-muted">
          Choose a development requester to simulate the current requester
          context for Lab 2. This is for testing only and is not a login
          screen.
        </p>

        {state === "loading" && (
          <div data-testid="zg-state-loading" className="zg-state--loading">
            <div className="zg-skeleton-bar" />
          </div>
        )}

        {state === "empty" && (
          <div data-testid="zg-state-empty" className="zg-state--empty" role="status">
            No active development requesters are available. Please contact an
            administrator.
          </div>
        )}

        {state === "error" && (
          <div data-testid="zg-state-error" className="zg-state--error" role="alert">
            <p>We couldn't load the list of Development Requesters.</p>
            <button type="button" className="zg-btn--secondary" onClick={load}>
              Retry
            </button>
          </div>
        )}

        {state === "populated" && (
          <>
            <label htmlFor="requester-select" className="zg-field-label">
              Development Requester *
            </label>
            <select
              id="requester-select"
              className="zg-field--editable"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="" disabled>
                Choose a Requester
              </option>
              {requesters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <div className="zg-callout--info" role="status">
              Only active development requesters are shown.
            </div>
          </>
        )}

        <div className="zg-callout--neutral" role="note">
          <strong>Authentication coming in Lab 3</strong> — In Lab 3, this
          selection will be replaced with secure authentication so you can
          access the system with your own account.
        </div>

        <div className="zg-actions-row">
          <button
            type="button"
            className="zg-btn--primary"
            disabled={state !== "populated" || selectedId === ""}
            onClick={handleContinue}
          >
            Continue &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}