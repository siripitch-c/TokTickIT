import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md PERF-01, PERF-02; specification.md BR-33, AC-26.
//
// The budget is a smoke test, not a benchmark. BR-33 says so itself: 500 ms on
// seeded data exists "to catch an accidental N+1 or a missing index, not to
// benchmark the machine". Each dashboard runs six or seven queries in one
// `Promise.all`; if one of them ever becomes a query per row, this is what
// notices, because nothing else in the suite would - the answers stay correct,
// they just stop arriving.
//
// Measured server-side: the clock runs around the supertest call, so it covers
// routing, authorization, every query and the JSON, and nothing of a browser.

const prisma = getPrisma();

const STAFF = "perf.staff@test.invalid";
const REQUESTER = "perf.requester@test.invalid";
const EMAILS = [STAFF, REQUESTER];

const NUMBER_PREFIX = "TKT-2097-";

/** BR-33's budget, in milliseconds. */
const BUDGET_MS = 500;

/** tests.md: "measured server-side over 5 runs". */
const RUNS = 5;

/**
 * Enough of the Requester's own Tickets that their six queries have real rows
 * to filter, count and order rather than an empty table. The staff dashboard
 * needs no help: it counts across every Ticket the seeded database holds.
 */
const OWN_TICKETS = 60;

let staffCookie = "";
let requesterCookie = "";
let ticketTotal = 0;

async function removeFixtures() {
  await prisma.ticket.deleteMany({ where: { ticketNumber: { startsWith: NUMBER_PREFIX } } });
}

beforeAll(async () => {
  const staff = await upsertTestUser({ email: STAFF, name: "Perf Staff", role: "IT_STAFF" });
  const requester = await upsertTestUser({ email: REQUESTER, name: "Perf Requester" });
  staffCookie = await signIn(STAFF);
  requesterCookie = await signIn(REQUESTER);
  void staff;

  const categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  const relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;

  await removeFixtures();

  // A spread of statuses, so every count and both lists have something to do.
  const statuses = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED"] as const;
  await prisma.ticket.createMany({
    data: Array.from({ length: OWN_TICKETS }, (_, i) => {
      const currentStatus = statuses[i % statuses.length];
      const when = new Date(Date.now() - i * 3_600_000);
      return {
        ticketNumber: `${NUMBER_PREFIX}${String(i + 1).padStart(6, "0")}`,
        requesterId: requester.id,
        categoryId,
        relatedSystemId,
        summary: `Performance fixture ${i + 1}`,
        description: "A Ticket raised so the dashboard queries have rows to read.",
        requestedPriority: "MEDIUM" as const,
        itPriority: "MEDIUM" as const,
        currentStatus,
        createdAt: when,
        updatedAt: when,
        resolvedAt: currentStatus === "RESOLVED" ? when : null,
      };
    }),
  });

  ticketTotal = await prisma.ticket.count();
}, 60_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

/**
 * One warm-up call, then `RUNS` timed ones. The warm-up is excluded on purpose
 * and not hidden: the first request of a process pays for the connection pool
 * and the query plan, which is a real cost but not the one BR-33 is about.
 */
async function timeEndpoint(url: string, cookie: string): Promise<number[]> {
  const warmUp = await request(app).get(url).set("Cookie", cookie);
  expect(warmUp.status, `${url} warm-up: ${JSON.stringify(warmUp.body)}`).toBe(200);

  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    const res = await request(app).get(url).set("Cookie", cookie);
    samples.push(performance.now() - started);
    expect(res.status, `${url} run ${i + 1}`).toBe(200);
  }
  return samples;
}

function report(url: string, samples: number[]): string {
  const ms = samples.map((n) => `${n.toFixed(0)}ms`).join(", ");
  return `${url} over ${samples.length} runs against ${ticketTotal} Tickets: ${ms}`;
}

/**
 * The measurement is printed, not only asserted. Report figure 3.8 is the
 * output of this suite, and "2 passed" says nothing about how close to the
 * budget the product actually is - a run at 480ms and a run at 12ms both read
 * as a tick. Written to stdout rather than through `console.log` so that the
 * `--silent` the other suites are run with does not swallow it.
 */
function announce(url: string, samples: number[]): void {
  const worst = Math.max(...samples).toFixed(0);
  process.stdout.write(`    ${report(url, samples)}  (worst ${worst}ms of ${BUDGET_MS}ms)\n`);
}

describe("Dashboard response budget", () => {
  it(
    "PERF-01 / BR-33, AC-26: the staff dashboard answers inside the budget on seeded data",
    async () => {
      const samples = await timeEndpoint("/api/dashboard/staff", staffCookie);
      announce("/api/dashboard/staff", samples);
      // Every run, not the average: an average hides the one that took a second.
      expect(Math.max(...samples), report("/api/dashboard/staff", samples)).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  it(
    "PERF-02 / BR-33, AC-26: the Requester dashboard answers inside the same budget",
    async () => {
      const samples = await timeEndpoint("/api/dashboard/requester", requesterCookie);
      announce("/api/dashboard/requester", samples);
      expect(Math.max(...samples), report("/api/dashboard/requester", samples)).toBeLessThan(BUDGET_MS);
    },
    30_000,
  );

  it("PERF-01, PERF-02 / BR-33: the measurement ran against a populated database, not an empty one", async () => {
    // The guard on the guard. Both cases above would pass in microseconds
    // against an empty table while proving nothing, which is the way a
    // performance smoke test most easily becomes decorative.
    expect(ticketTotal).toBeGreaterThan(OWN_TICKETS);

    const body = (await request(app).get("/api/dashboard/requester").set("Cookie", requesterCookie)).body;
    expect(body.metrics.openTickets).toBeGreaterThan(0);
    expect(body.recentlyUpdated.length).toBeGreaterThan(0);
  });
});
