import { describe, it, expect } from "vitest";
import { formatTicketNumber, TICKET_NUMBER_PATTERN } from "../../src/ticketNumber.js";

// tests.md UNIT-01, specification.md BR-01.
// Pure formatting logic only — no database, no I/O. The atomic sequence step
// that feeds this formatter is covered by API-CREATE-08 instead, since it is
// a database-level guarantee rather than a pure function.

describe("formatTicketNumber (UNIT-01, BR-01)", () => {
  it("produces the TKT-YYYY-NNNNNN format for several sample sequence numbers", () => {
    expect(formatTicketNumber(2026, 1)).toBe("TKT-2026-000001");
    expect(formatTicketNumber(2026, 118)).toBe("TKT-2026-000118");
    expect(formatTicketNumber(2026, 999999)).toBe("TKT-2026-999999");
    expect(formatTicketNumber(2027, 42)).toBe("TKT-2027-000042");
  });

  it("zero-pads the sequence to exactly 6 digits and keeps the year at 4", () => {
    for (const seq of [1, 9, 10, 99, 100, 12345, 654321]) {
      const value = formatTicketNumber(2026, seq);
      expect(value).toMatch(TICKET_NUMBER_PATTERN);
      expect(value.split("-")[1]).toHaveLength(4);
      expect(value.split("-")[2]).toHaveLength(6);
    }
  });

  it("does not truncate a sequence that has outgrown 6 digits", () => {
    // Beyond the padding width the number must stay correct rather than be
    // silently cut down to a colliding value — uniqueness (BR-01) outranks
    // the cosmetic fixed width.
    expect(formatTicketNumber(2026, 1000000)).toBe("TKT-2026-1000000");
  });

  it("rejects sequence values that could never be a real ticket", () => {
    expect(() => formatTicketNumber(2026, 0)).toThrow();
    expect(() => formatTicketNumber(2026, -1)).toThrow();
    expect(() => formatTicketNumber(2026, 1.5)).toThrow();
  });
});
