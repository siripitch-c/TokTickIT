import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS, isExpired, sessionExpiry } from "../../src/auth.js";

// tests.md UNIT-04. Pure arithmetic, no database and no clock mocking — both
// functions take the moment to measure from, which is exactly so that this can
// be tested without waiting eight hours or freezing time.

describe("session lifetime", () => {
  it("UNIT-04 / BR-11: a session expires eight hours after it is issued", () => {
    expect(SESSION_TTL_MS).toBe(8 * 60 * 60 * 1000);

    const issued = new Date("2026-09-12T09:00:00.000Z");
    expect(sessionExpiry(issued).toISOString()).toBe("2026-09-12T17:00:00.000Z");
  });

  it("UNIT-04 / BR-11: valid up to the boundary, expired at it and after", () => {
    const issued = new Date("2026-09-12T09:00:00.000Z");
    const expiresAt = sessionExpiry(issued);

    const oneSecondBefore = new Date(expiresAt.getTime() - 1000);
    const atTheBoundary = new Date(expiresAt.getTime());
    const oneSecondAfter = new Date(expiresAt.getTime() + 1000);

    expect(isExpired(expiresAt, oneSecondBefore)).toBe(false);
    // The boundary counts as expired rather than valid: a session whose last
    // valid instant has arrived should not be usable for one more request.
    expect(isExpired(expiresAt, atTheBoundary)).toBe(true);
    expect(isExpired(expiresAt, oneSecondAfter)).toBe(true);
  });

  it("UNIT-04 / BR-11: a session issued right now is not already expired", () => {
    expect(isExpired(sessionExpiry())).toBe(false);
  });
});
