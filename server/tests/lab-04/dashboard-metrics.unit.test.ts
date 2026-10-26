import { describe, expect, it } from "vitest";
import { BANGKOK_OFFSET_MS, resolvedWindowStart, startOfDaysAgoBangkok } from "../../src/dashboardMetrics.js";

// tests.md UNIT-06; specification.md BR-25.
//
// The whole point of BR-25 is that the answer must not depend on where the
// server thinks it is. Every assertion below therefore names an absolute
// instant and an absolute expected answer; none of them reads a local date
// part, and neither does the function under test — which is what makes the
// rule hold on a laptop in Bangkok and on a container running UTC alike.

/** 00:00 Bangkok on the given date, expressed as the UTC instant it really is. */
const bangkokMidnight = (iso: string) => new Date(`${iso}T00:00:00.000+07:00`);

describe("UNIT-06 / BR-25: the seven-day window begins at midnight in Bangkok", () => {
  it("starts seven Bangkok days back, today included", () => {
    // 09:00 on 15 October in Bangkok.
    const now = new Date("2026-10-15T02:00:00.000Z");

    // Seven days counted inclusively: the 15th back to the 9th.
    expect(resolvedWindowStart(now).toISOString()).toBe(bangkokMidnight("2026-10-09").toISOString());
  });

  it("does not move during a Bangkok day, however late in it", () => {
    const morning = new Date("2026-10-15T02:00:00.000Z"); // 09:00 Bangkok
    const night = new Date("2026-10-15T16:59:59.999Z"); // 23:59:59 Bangkok, same day

    expect(resolvedWindowStart(night).toISOString()).toBe(resolvedWindowStart(morning).toISOString());
  });

  it("moves when Bangkok's day turns, not when UTC's does", () => {
    // These two instants straddle midnight UTC and are the same Bangkok day
    // (06:00 and 08:00 on the 16th), so the window must be identical. A
    // boundary computed in UTC would move between them, which is the mistake
    // BR-25 exists to prevent.
    const beforeUtcMidnight = new Date("2026-10-15T23:00:00.000Z");
    const afterUtcMidnight = new Date("2026-10-16T01:00:00.000Z");
    expect(resolvedWindowStart(beforeUtcMidnight).toISOString()).toBe(
      resolvedWindowStart(afterUtcMidnight).toISOString(),
    );

    // And it does move across Bangkok's own midnight: 23:59 on the 15th and
    // 00:01 on the 16th, Bangkok time, are one minute apart and a day apart.
    const lastMinuteOf15th = new Date("2026-10-15T16:59:00.000Z");
    const firstMinuteOf16th = new Date("2026-10-15T17:01:00.000Z");
    expect(resolvedWindowStart(lastMinuteOf15th).toISOString()).toBe(
      bangkokMidnight("2026-10-09").toISOString(),
    );
    expect(resolvedWindowStart(firstMinuteOf16th).toISOString()).toBe(
      bangkokMidnight("2026-10-10").toISOString(),
    );
  });

  it("a Ticket resolved six Bangkok days ago is inside the window and one resolved eight days ago is outside", () => {
    const now = new Date("2026-10-15T02:00:00.000Z");
    const since = resolvedWindowStart(now);

    const sixDaysAgo = new Date("2026-10-09T03:00:00.000Z"); // 10:00 Bangkok on the 9th
    const eightDaysAgo = new Date("2026-10-07T03:00:00.000Z"); // 10:00 Bangkok on the 7th

    expect(sixDaysAgo.getTime()).toBeGreaterThanOrEqual(since.getTime());
    expect(eightDaysAgo.getTime()).toBeLessThan(since.getTime());

    // The edge itself: 00:00 Bangkok on the 9th is in, and the millisecond
    // before it is out. A metric whose edge nobody has written down is a metric
    // that drifts the first time somebody rewrites the query.
    expect(bangkokMidnight("2026-10-09").getTime()).toBe(since.getTime());
    expect(bangkokMidnight("2026-10-09").getTime() - 1).toBeLessThan(since.getTime());
  });

  it("is a fixed seven-hour offset, because Thailand has never observed daylight saving", () => {
    expect(BANGKOK_OFFSET_MS).toBe(7 * 60 * 60 * 1000);

    // Midwinter and midsummer behave identically, which is the property that
    // makes the constant above safe. A timezone with daylight saving would
    // need a lookup, and this test would be the one to fail.
    for (const iso of ["2026-01-15T02:00:00.000Z", "2026-07-15T02:00:00.000Z"]) {
      const now = new Date(iso);
      const start = resolvedWindowStart(now);
      expect(start.getTime() % (24 * 60 * 60 * 1000)).toBe((24 - 7) * 60 * 60 * 1000);
    }
  });

  it("generalises: one day is today alone", () => {
    const now = new Date("2026-10-15T02:00:00.000Z");
    expect(startOfDaysAgoBangkok(1, now).toISOString()).toBe(bangkokMidnight("2026-10-15").toISOString());
  });
});
