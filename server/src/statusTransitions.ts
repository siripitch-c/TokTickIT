import type { CurrentStatus } from "@prisma/client";

// specification.md BR-30 and BR-31 — the Ticket statuses and the moves allowed
// between them.
//
// The one place the server decides whether a status change is permitted.
// `PATCH /api/tickets/:id/status` consults it and answers 409 for anything it
// refuses (AC-13); the client keeps its own copy only to choose which options
// to offer, and the server never trusts that choice.

/** BR-30, in the order the schema declares them and BR-31's columns list them. */
export const CURRENT_STATUSES: readonly CurrentStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
];

// BR-31. No row permits a move to its own status: the matrix has no
// self-transitions, so setting a status to its current value is a conflict
// rather than a silent no-op (api-spec.md §7).
const PERMITTED: Record<CurrentStatus, ReadonlySet<CurrentStatus>> = {
  NEW: new Set<CurrentStatus>(["OPEN", "IN_PROGRESS", "CANCELLED"]),
  OPEN: new Set<CurrentStatus>(["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"]),
  IN_PROGRESS: new Set<CurrentStatus>(["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"]),
  WAITING_FOR_REQUESTER: new Set<CurrentStatus>(["IN_PROGRESS", "RESOLVED", "CANCELLED"]),
  RESOLVED: new Set<CurrentStatus>(["CLOSED", "REOPENED"]),
  // Closed leads only back to Reopened, and Cancelled leads nowhere
  // (specification.md §11) — which is why BR-33 asks for confirmation on both.
  CLOSED: new Set<CurrentStatus>(["REOPENED"]),
  REOPENED: new Set<CurrentStatus>(["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"]),
  CANCELLED: new Set<CurrentStatus>(),
};

export function canTransition(from: CurrentStatus, to: CurrentStatus): boolean {
  return PERMITTED[from].has(to);
}

/** The statuses reachable from `from`, in BR-31's column order. */
export function allowedTransitions(from: CurrentStatus): CurrentStatus[] {
  return CURRENT_STATUSES.filter((to) => canTransition(from, to));
}

/** The words a person reads for each status — used in conflict messages (api-spec.md §7). */
export const STATUS_LABEL: Record<CurrentStatus, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};
