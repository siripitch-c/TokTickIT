// Issue #12 — client-side Development Requester context.
//
// BR-06: the selected Requester persists for the browser session (stored
// client-side) until "Change Requester" or the session/storage is cleared.
// Decision: sessionStorage, not localStorage — a session-scoped testing
// identity should not silently survive across browser restarts/days later,
// which better matches "for the browser session" in BR-06's wording and
// keeps BR-40's Lab 3 migration (real session/token) a closer conceptual
// swap-in than a long-lived localStorage value would be.

const STORAGE_KEY = "toktickit.selectedRequesterId";

export function getSelectedRequesterId(): number | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function setSelectedRequesterId(id: number): void {
  sessionStorage.setItem(STORAGE_KEY, String(id));
}

// BR-07: Change Requester must clear the previous selection so no stale
// context/data can remain visible before a new one is chosen.
export function clearSelectedRequesterId(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
