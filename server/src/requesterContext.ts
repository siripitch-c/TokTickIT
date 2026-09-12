import type { Response } from "express";

// Issue #13 — request parsing and the api-spec.md §1 error envelope.
//
// This file began as the Lab 2 Development Requester context: it read the
// caller identity out of the `X-Requester-Id` header. Lab 3, Issue #30 moved
// identity to the session (BR-03), so the header reader and its constant were
// removed rather than left behind — an unused way to name a caller is exactly
// the thing somebody reaches for later by mistake. What stays is the part that
// was never about identity: id parsing and the error envelope.

// Every id column in the schema is a Prisma `Int`, i.e. a 32-bit signed
// integer. Anything larger is not a row that could exist, and handing it to
// Prisma raises rather than returning "not found" — so out-of-range values are
// rejected at the edge and answered as bad input, not as a server fault.
export const MAX_ID = 2_147_483_647;

/** Parses a path/body id, or null when it could not name a row. */
export function readId(value: unknown): number | null {
  const id = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

/** Writes the api-spec.md §1 error envelope. `field` is omitted when not body-specific. */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  field?: string,
): void {
  res.status(status).json({ error: field ? { code, message, field } : { code, message } });
}

/** The generic, detail-free 500 required by api-spec.md §6 — never leaks a DB string. */
export function sendInternalError(res: Response): void {
  sendError(res, 500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
}
