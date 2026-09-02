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
        <div className="zg-icon-badge" aria-hidden="true" />
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