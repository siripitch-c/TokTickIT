import type { CurrentStatus } from "../api.js";

// Lab 3 specification.md BR-31, mirrored from the server for one purpose only:
// choosing which moves the status select offers (ui-spec.md §8.2), so an
// impossible move is never put in front of anyone. The server's copy is the
// rule — it answers 409 for anything outside it (AC-13) — and UI-DETAIL-05
// pins this copy to the specification so the two cannot quietly drift apart.
const PERMITTED: Record<CurrentStatus, CurrentStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CANCELLED: [],
};

/** The statuses a Ticket may move to from `from`, in BR-31's column order. */
export function allowedTransitions(from: CurrentStatus): CurrentStatus[] {
  return PERMITTED[from];
}

/**
 * BR-33 — the two moves that are effectively terminal, and the consequence the
 * confirmation names. ui-spec.md §8.2: the dialog says what will happen rather
 * than asking "Are you sure?".
 */
export const CONFIRMATION: Partial<Record<CurrentStatus, string>> = {
  CLOSED: "A closed ticket can only be reopened.",
  CANCELLED: "Cancelled tickets cannot be reopened.",
};
