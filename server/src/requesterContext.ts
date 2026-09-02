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

/** Returns the caller's Requester id, or null when the header is absent or unusable. */
export function readRequesterId(req: Request): number | null {
  const raw = req.header(REQUESTER_HEADER);
  if (raw === undefined) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
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
