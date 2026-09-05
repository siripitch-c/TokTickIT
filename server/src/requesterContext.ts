import type { Request, Response } from "express";

// Issue #13 — server-side Development Requester context (api-spec.md §1).
//
// Every Requester-scoped endpoint reads its caller identity from the
// `X-Requester-Id` header. This is the Lab 2 testing mechanism (BR-04), NOT
// authentication: the value is client-supplied and unverified. Ownership
// checks (BR-11) are still enforced against it server-side so that the
// mechanism swaps cleanly for a real verified identity in Lab 3 (BR-40)
// without moving the checks themselves.

export const REQUESTER_HEADER = "x-requester-id";

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

/** Returns the caller's Requester id, or null when the header is absent or unusable. */
export function readRequesterId(req: Request): number | null {
  const raw = req.header(REQUESTER_HEADER);
  return raw === undefined ? null : readId(raw);
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
