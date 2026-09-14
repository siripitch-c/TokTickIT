import { describe, expect, it } from "vitest";
import { CurrentStatus as SchemaStatuses } from "@prisma/client";
import type { CurrentStatus } from "@prisma/client";
import { CURRENT_STATUSES, allowedTransitions, canTransition } from "../../src/statusTransitions.js";

// tests.md UNIT-03; specification.md BR-30, BR-31.
//
// The expected matrix is written out again here from the table in
// specification.md BR-31, rather than read back from the implementation, so
// the test compares the code with the specification instead of with itself.
// Each row lists the "yes" cells of that table, left to right.
const BR_31: Record<CurrentStatus, CurrentStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CANCELLED: [],
};

const ALL = Object.keys(BR_31) as CurrentStatus[];

describe("Ticket status transitions", () => {
  it("UNIT-03 / BR-30: the helper knows exactly the eight statuses the schema declares, in order", () => {
    // A status added to the schema but not to the helper would be a status
    // nothing could ever move into or out of.
    expect([...CURRENT_STATUSES]).toEqual(Object.values(SchemaStatuses));
    expect([...CURRENT_STATUSES]).toEqual(ALL);
  });

  it("UNIT-03 / BR-31: every permitted cell is allowed", () => {
    let permitted = 0;
    for (const from of ALL) {
      for (const to of BR_31[from]) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
        permitted += 1;
      }
    }
    // Twenty "yes" cells in the table; a miscount here means the transcription
    // above drifted, not the code.
    expect(permitted).toBe(20);
  });

  it("UNIT-03 / BR-31: every other pair is rejected, including all eight self-transitions", () => {
    let rejected = 0;
    for (const from of ALL) {
      for (const to of ALL) {
        if (BR_31[from].includes(to)) continue;
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
        rejected += 1;
      }
      // No status may be set to itself (api-spec.md §7: a no-op is a 409).
      expect(canTransition(from, from), `${from} -> ${from}`).toBe(false);
    }
    expect(rejected).toBe(64 - 20);
  });

  it("UNIT-03 / BR-31: the options offered from each status are its permitted moves, in column order", () => {
    for (const from of ALL) {
      expect(allowedTransitions(from), from).toEqual(BR_31[from]);
    }
    // Cancelled is terminal; Closed leads only back to Reopened (§11).
    expect(allowedTransitions("CANCELLED")).toEqual([]);
    expect(allowedTransitions("CLOSED")).toEqual(["REOPENED"]);
  });
});
