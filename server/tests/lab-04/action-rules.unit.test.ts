import { describe, expect, it } from "vitest";
import type { ActionStatus } from "@prisma/client";
import {
  canChangeActionStatus,
  completionNeedsResult,
  isFinalActionStatus,
  openActionCount,
  readActionAt,
  readDescription,
  resolveFollowUp,
} from "../../src/actionRules.js";

// tests.md UNIT-01..UNIT-05; specification.md BR-05, BR-06, BR-07, BR-09,
// BR-10, BR-18.
//
// Pure logic, no database. The status matrix is sixteen pairs and the date rule
// has four edges; asserting them here costs milliseconds, where the API suite
// would need a request each. The API suite then proves the endpoints consult
// these rules rather than re-deriving them.

const STATUSES: readonly ActionStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

// specification.md BR-05, written out again here so a reader checks the code
// against the document rather than against itself.
const ALLOWED: Record<ActionStatus, readonly ActionStatus[]> = {
  PLANNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

describe("UNIT-01 — the Action status matrix (BR-05)", () => {
  it("allows exactly the moves the specification lists, and refuses all sixteen others", () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const expected = from === to || ALLOWED[from].includes(to);
        expect(canChangeActionStatus(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("treats Completed and Cancelled as final, so nothing leaves them", () => {
    for (const from of ["COMPLETED", "CANCELLED"] as const) {
      for (const to of STATUSES.filter((s) => s !== from)) {
        expect(canChangeActionStatus(from, to), `${from} -> ${to}`).toBe(false);
      }
      expect(isFinalActionStatus(from)).toBe(true);
    }
    expect(STATUSES.filter(isFinalActionStatus)).toEqual(["COMPLETED", "CANCELLED"]);
  });
});

describe("UNIT-02 — completing needs a result (BR-06)", () => {
  it("refuses a completion whose result is missing, empty or only whitespace", () => {
    for (const result of [undefined, null, "", "   ", "\n\t"]) {
      expect(completionNeedsResult("COMPLETED", result), JSON.stringify(result)).toBe(true);
    }
  });

  it("accepts a completion with a real result, and never blocks an open Action", () => {
    expect(completionNeedsResult("COMPLETED", "Projector shows the image again.")).toBe(false);
    for (const status of ["PLANNED", "IN_PROGRESS", "CANCELLED"] as const) {
      expect(completionNeedsResult(status, null), status).toBe(false);
    }
  });
});

describe("UNIT-03 — the follow-up dependency (BR-07)", () => {
  it("requires a note of at least five characters when follow-up is required", () => {
    expect(resolveFollowUp(true, undefined, null)).toEqual({ ok: false });
    expect(resolveFollowUp(true, null, null)).toEqual({ ok: false });
    expect(resolveFollowUp(true, "   ", null)).toEqual({ ok: false });
    expect(resolveFollowUp(true, "four", null)).toEqual({ ok: false });
    expect(resolveFollowUp(true, "x".repeat(1001), null)).toEqual({ ok: false });
    expect(resolveFollowUp(true, "  Chase the network team on Friday.  ", null)).toEqual({
      ok: true,
      note: "Chase the network team on Friday.",
    });
  });

  it("keeps the stored note when an update only flips other fields", () => {
    expect(resolveFollowUp(true, undefined, "Chase the network team on Friday.")).toEqual({
      ok: true,
      note: "Chase the network team on Friday.",
    });
  });

  it("clears the note when follow-up is turned off, rather than hiding it on the row", () => {
    expect(resolveFollowUp(false, "Chase the network team on Friday.", "Chase the network team on Friday.")).toEqual({
      ok: true,
      note: null,
    });
    expect(resolveFollowUp(false, undefined, "An old note nobody would see again.")).toEqual({ ok: true, note: null });
  });
});

describe("UNIT-04 — the action date bounds (BR-09, BR-10)", () => {
  const ticketCreated = new Date("2026-03-01T09:00:00.000Z");
  const now = new Date("2026-03-05T09:00:00.000Z");

  it("defaults to now when no date is supplied", () => {
    for (const value of [undefined, null, ""]) {
      expect(readActionAt(value, ticketCreated, now)).toEqual(now);
    }
  });

  it("accepts a date between the Ticket's creation and now", () => {
    const when = new Date("2026-03-03T14:30:00.000Z");
    expect(readActionAt(when.toISOString(), ticketCreated, now)).toEqual(when);
    // The boundaries themselves are valid: an action recorded the instant the
    // Ticket was raised, or right now, are both real.
    expect(readActionAt(ticketCreated.toISOString(), ticketCreated, now)).toEqual(ticketCreated);
    expect(readActionAt(now.toISOString(), ticketCreated, now)).toEqual(now);
  });

  it("refuses the future beyond the clock tolerance, anything before the Ticket, and nonsense", () => {
    const tooLate = new Date(now.getTime() + 5 * 60_000).toISOString();
    const tooEarly = new Date(ticketCreated.getTime() - 1).toISOString();
    for (const value of [tooLate, tooEarly, "not-a-date", 1_767_225_600_000]) {
      expect(readActionAt(value, ticketCreated, now), String(value)).toBeNull();
    }
    // A client clock slightly ahead is tolerated rather than rejected.
    const slightlyAhead = new Date(now.getTime() + 30_000).toISOString();
    expect(readActionAt(slightlyAhead, ticketCreated, now)).not.toBeNull();
  });

  it("holds the description to 5-2000 characters and stores it trimmed", () => {
    expect(readDescription("  Replaced the cable.  ")).toBe("Replaced the cable.");
    expect(readDescription("four")).toBeNull();
    expect(readDescription("x".repeat(2001))).toBeNull();
    expect(readDescription(42)).toBeNull();
  });
});

describe("UNIT-05 — the resolution gate's predicate (BR-18)", () => {
  it("counts only Planned and In Progress Actions as blocking", () => {
    expect(openActionCount(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])).toBe(2);
    expect(openActionCount(["COMPLETED", "CANCELLED"])).toBe(0);
  });

  it("lets a Ticket with no Actions through, which is every Ticket from Labs 2 and 3", () => {
    expect(openActionCount([])).toBe(0);
  });
});
