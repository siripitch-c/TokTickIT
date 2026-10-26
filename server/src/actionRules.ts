import type { ActionStatus } from "@prisma/client";

// Lab 4, Issue #46 — the rules of an Action Taken, with no I/O.
//
// Separated from `actionRoutes.ts` so the matrix and the three validators can
// be asserted directly (tests.md UNIT-01..UNIT-05) rather than through a
// request each. The route module holds the plumbing; this holds the decisions.

export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 2000;
export const TEXT_MAX = 2000;
export const FOLLOW_UP_MIN = 5;
export const FOLLOW_UP_MAX = 1000;

/** A client clock a few seconds ahead of the server is a clock problem, not a user error. */
export const FUTURE_TOLERANCE_MS = 60_000;

// specification.md BR-05. Completed and Cancelled are final: an Action is never
// reopened, because the honest record of a job that restarted is a new Action.
const ACTION_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  PLANNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canChangeActionStatus(from: ActionStatus, to: ActionStatus): boolean {
  return from === to || ACTION_TRANSITIONS[from].includes(to);
}

export function isFinalActionStatus(status: ActionStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/**
 * BR-06: a result is what "completed" means. An Action may be saved without one
 * while it is still open, but not finished without one.
 */
export function completionNeedsResult(status: ActionStatus, result: string | null | undefined): boolean {
  return status === "COMPLETED" && (result === null || result === undefined || result.trim().length === 0);
}

/**
 * BR-18's predicate, which is also BR-05 read from the other side: the Actions
 * that block a Ticket from being resolved are the ones that are not final.
 */
export function openActionCount(statuses: readonly ActionStatus[]): number {
  return statuses.filter((status) => !isFinalActionStatus(status)).length;
}

/**
 * BR-07: the follow-up note exists only while follow-up is required. Turning
 * the flag off clears the note rather than leaving it on the row where nobody
 * would see it again.
 *
 * `note` is `undefined` when the caller did not mention it, so an update that
 * only flips the flag keeps whatever note the row already had.
 */
export function resolveFollowUp(
  required: boolean,
  note: string | null | undefined,
  current: string | null,
): { ok: true; note: string | null } | { ok: false } {
  if (!required) return { ok: true, note: null };
  const text = note === undefined ? current : note;
  if (text === null || text === undefined) return { ok: false };
  const trimmed = text.trim();
  if (trimmed.length < FOLLOW_UP_MIN || trimmed.length > FOLLOW_UP_MAX) return { ok: false };
  return { ok: true, note: trimmed };
}

/**
 * BR-09: supplied by the person recording the action, defaults to now, never in
 * the future, and never before the Ticket existed. A log that claims an action
 * before the problem was reported is wrong by construction.
 */
export function readActionAt(value: unknown, ticketCreatedAt: Date, now: Date = new Date()): Date | null {
  if (value === undefined || value === null || value === "") return now;
  if (typeof value !== "string") return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;
  if (when.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return null;
  if (when.getTime() < ticketCreatedAt.getTime()) return null;
  return when;
}

/** BR-10: 5–2000 characters, stored trimmed. */
export function readDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= DESCRIPTION_MIN && text.length <= DESCRIPTION_MAX ? text : null;
}
