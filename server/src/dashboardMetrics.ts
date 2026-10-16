import type { CurrentStatus } from "@prisma/client";

// Lab 4, Issue #49 — the rules behind the dashboard numbers, with no I/O.
//
// Separated from `dashboardRoutes.ts` for the same reason `actionRules.ts` is
// separated from `actionRoutes.ts`: a date boundary is worth asserting directly
// (tests.md UNIT-06) rather than through a request, and a boundary that is only
// ever exercised through a request is a boundary nobody has really read.

/**
 * lab-04/specification.md BR-21: "open" means a Ticket that is still somebody's
 * problem — anything that is not Resolved, Closed or Cancelled. Five of the
 * eight statuses, written out rather than derived, so the list is visible to a
 * reader and a new status cannot join it by accident.
 */
export const OPEN_STATUSES: readonly CurrentStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "REOPENED",
];

/**
 * BR-25 — the service desk works in Bangkok, and "the last 7 days" has to mean
 * the same thing whatever timezone the server runs in.
 *
 * Asia/Bangkok is UTC+7 all year: Thailand has never observed daylight saving,
 * so the offset is a constant rather than something to look up per date. That
 * makes the arithmetic below exact, and it is why this is a fixed number rather
 * than an `Intl` lookup — an hour that never shifts needs no table.
 */
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant that begins the window for "resolved in the last N days", as a
 * UTC `Date` ready to compare against a stored timestamp.
 *
 * The window starts at **00:00 Bangkok**, N-1 days before the Bangkok day `now`
 * falls in, so "the last 7 days" is seven whole working days including today
 * rather than a rolling 168 hours. A Ticket resolved at 09:00 Bangkok seven
 * days ago therefore counts for the whole of that day, instead of dropping out
 * of the number at 09:00 today while the desk is looking at it.
 */
export function startOfDaysAgoBangkok(days: number, now: Date = new Date()): Date {
  const bangkokNow = now.getTime() + BANGKOK_OFFSET_MS;
  // Floor to the Bangkok day, in Bangkok's own frame, then step back.
  const startOfBangkokToday = Math.floor(bangkokNow / DAY_MS) * DAY_MS;
  const startOfWindow = startOfBangkokToday - (days - 1) * DAY_MS;
  return new Date(startOfWindow - BANGKOK_OFFSET_MS);
}

/** BR-21's one date-bounded metric: the last seven Bangkok days, today included. */
export function resolvedWindowStart(now: Date = new Date()): Date {
  return startOfDaysAgoBangkok(7, now);
}

/** BR-21: the by-status map carries every status, including the zeros. */
export function byStatusMap(
  counts: readonly { currentStatus: CurrentStatus; _count: { _all: number } }[],
  statuses: readonly CurrentStatus[],
): Record<CurrentStatus, number> {
  const map = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<CurrentStatus, number>;
  for (const row of counts) map[row.currentStatus] = row._count._all;
  return map;
}
