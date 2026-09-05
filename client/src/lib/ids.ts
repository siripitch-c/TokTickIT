// The same bound the server applies (server/src/requesterContext.ts): every id
// column is a 32-bit signed integer, so a value outside that range could never
// name a row. Checking it here means a bad URL becomes "not found" without a
// request, rather than a round trip that can only end the same way.
export const MAX_ID = 2_147_483_647;

/** Parses a route/query id, or null when it could not name a row. */
export function readId(value: unknown): number | null {
  const id = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}
