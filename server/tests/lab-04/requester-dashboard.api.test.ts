import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { CurrentStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { OPEN_STATUSES } from "../../src/dashboardMetrics.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-DASHR-01..09; specification.md FR-17..FR-20,
// BR-22, BR-23, AC-19..AC-22; api-spec.md §7.
//
// One claim runs through all of this: a Requester sees their own work and
// nobody else's, and the server decides that from the session rather than from
// anything the caller can type. The second Requester below exists only to be
// absent from every answer.

const prisma = getPrisma();

const MINE = "dashr.mine@test.invalid";
const THEIRS = "dashr.theirs@test.invalid";
const EMPTY = "dashr.empty@test.invalid";
const STAFF = "dashr.staff@test.invalid";
const ADMIN = "dashr.admin@test.invalid";
const EMAILS = [MINE, THEIRS, EMPTY, STAFF, ADMIN];

const NUMBER_PREFIX = "TKT-2096-";

let mineId = 0;
let theirsId = 0;
let mineCookie = "";
let theirsCookie = "";
let emptyCookie = "";
let staffCookie = "";
let adminCookie = "";
let categoryId = 0;
let relatedSystemId = 0;
let sequence = 0;

interface Dashboard {
  metrics: { openTickets: number; waitingForMe: number; resolvedAwaitingConfirmation: number };
  attention: Row[];
  recentlyUpdated: Row[];
  recentlyResolved: Row[];
}

interface Row {
  id: number;
  ticketNumber: string;
  summary: string;
  currentStatus: CurrentStatus;
  requestedPriority: string;
  updatedAt: string;
}

const get = (cookie: string, url = "/api/dashboard/requester") =>
  request(app).get(url).set("Cookie", cookie);

async function dashboard(cookie = mineCookie, url?: string): Promise<Dashboard> {
  const res = await get(cookie, url);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Dashboard;
}

async function makeTicket(
  requesterId: number,
  currentStatus: CurrentStatus = "OPEN",
  minutesAgo = 0,
) {
  sequence += 1;
  const when = new Date(Date.now() - minutesAgo * 60_000);
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(sequence).padStart(6, "0")}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: `Requester dashboard fixture ${sequence}`,
      description: "A Ticket for the requester dashboard suite.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus,
      createdAt: when,
      updatedAt: when,
      resolvedAt: currentStatus === "RESOLVED" ? when : null,
    },
  });
}

beforeAll(async () => {
  mineId = (await upsertTestUser({ email: MINE, name: "Dashr Mine" })).id;
  theirsId = (await upsertTestUser({ email: THEIRS, name: "Dashr Theirs" })).id;
  await upsertTestUser({ email: EMPTY, name: "Dashr Empty" });
  await upsertTestUser({ email: STAFF, name: "Dashr Staff", role: "IT_STAFF" });
  await upsertTestUser({ email: ADMIN, name: "Dashr Admin", role: "ADMINISTRATOR" });

  mineCookie = await signIn(MINE);
  theirsCookie = await signIn(THEIRS);
  emptyCookie = await signIn(EMPTY);
  staffCookie = await signIn(STAFF);
  adminCookie = await signIn(ADMIN);

  categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;

  await removeFixtures();
});

async function removeFixtures() {
  await prisma.ticket.deleteMany({ where: { ticketNumber: { startsWith: NUMBER_PREFIX } } });
}

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

describe("Whose data it is", () => {
  it("API-DASHR-01 / AC-19, BR-22: every count and every row belongs to the caller, and the other Requester appears nowhere", async () => {
    const mine = await makeTicket(mineId, "WAITING_FOR_REQUESTER");
    const theirs = await makeTicket(theirsId, "WAITING_FOR_REQUESTER");
    await makeTicket(theirsId, "RESOLVED");

    const body = await dashboard(mineCookie);
    const everyId = [...body.attention, ...body.recentlyUpdated, ...body.recentlyResolved].map((r) => r.id);

    expect(everyId).toContain(mine.id);
    expect(everyId).not.toContain(theirs.id);

    // Counted as well as listed: the other Requester's two Tickets must not
    // reach the numbers either.
    expect(body.metrics.waitingForMe).toBe(
      await prisma.ticket.count({ where: { requesterId: mineId, currentStatus: "WAITING_FOR_REQUESTER" } }),
    );

    // The same request, from the other side, is the other person's dashboard.
    const theirBody = await dashboard(theirsCookie);
    const theirIds = [...theirBody.attention, ...theirBody.recentlyUpdated].map((r) => r.id);
    expect(theirIds).toContain(theirs.id);
    expect(theirIds).not.toContain(mine.id);
  });

  it("API-DASHR-02 / AC-20, FR-20: a requesterId in the query string is ignored, not refused", async () => {
    const mine = await makeTicket(mineId, "OPEN");
    const theirs = await makeTicket(theirsId, "OPEN");

    // Asking for somebody else answers with your own data. A 403 would confirm
    // that the person asked about exists, which is the thing not to say.
    const body = await dashboard(mineCookie, `/api/dashboard/requester?requesterId=${theirsId}`);
    const ids = body.recentlyUpdated.map((r) => r.id);

    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(body.metrics.openTickets).toBe(
      await prisma.ticket.count({ where: { requesterId: mineId, currentStatus: { in: [...OPEN_STATUSES] } } }),
    );
  });
});

describe("What the numbers and lists hold", () => {
  it("API-DASHR-03 / BR-22: the three counts match direct queries, and each list is capped and ordered newest first", async () => {
    // Seven of the caller's own, so both five-row lists are certainly full.
    for (let i = 0; i < 7; i += 1) await makeTicket(mineId, "OPEN", i);
    for (let i = 0; i < 6; i += 1) await makeTicket(mineId, "RESOLVED", i);

    const body = await dashboard(mineCookie);
    const own = { requesterId: mineId };

    expect(body.metrics.openTickets).toBe(
      await prisma.ticket.count({ where: { ...own, currentStatus: { in: [...OPEN_STATUSES] } } }),
    );
    expect(body.metrics.waitingForMe).toBe(
      await prisma.ticket.count({ where: { ...own, currentStatus: "WAITING_FOR_REQUESTER" } }),
    );
    expect(body.metrics.resolvedAwaitingConfirmation).toBe(
      await prisma.ticket.count({ where: { ...own, currentStatus: "RESOLVED" } }),
    );

    expect(body.recentlyUpdated).toHaveLength(5);
    expect(body.recentlyResolved).toHaveLength(5);

    for (const list of [body.recentlyUpdated, body.recentlyResolved]) {
      const times = list.map((r) => new Date(r.updatedAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    }

    // BR-23: a row carries what a row shows and nothing else. No IT Priority,
    // which a Requester never set, and no owner, which is not their business.
    for (const row of body.recentlyUpdated) {
      expect(Object.keys(row).sort()).toEqual([
        "currentStatus",
        "id",
        "requestedPriority",
        "summary",
        "ticketNumber",
        "updatedAt",
      ]);
    }
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it("API-DASHR-04 / FR-18: the attention list holds exactly the Tickets behind the second and third cards", async () => {
    const waiting = await makeTicket(mineId, "WAITING_FOR_REQUESTER");
    const resolved = await makeTicket(mineId, "RESOLVED");
    const open = await makeTicket(mineId, "OPEN");
    const closed = await makeTicket(mineId, "CLOSED");

    const body = await dashboard(mineCookie);
    const ids = body.attention.map((r) => r.id);

    expect(ids).toContain(waiting.id);
    expect(ids).toContain(resolved.id);
    // Nothing else belongs: an open Ticket is being worked on, and a closed one
    // is finished. Neither is waiting for the Requester to do anything.
    expect(ids).not.toContain(open.id);
    expect(ids).not.toContain(closed.id);

    // The reason a row is listed is its own status, which is why no separate
    // field carries it — two sources for one fact is one too many.
    for (const row of body.attention) {
      expect(["WAITING_FOR_REQUESTER", "RESOLVED"], `ticket ${row.id}`).toContain(row.currentStatus);
    }

    // Both cards' totals are reflected in the one list, as §5.1 describes it.
    const expected =
      body.metrics.waitingForMe + body.metrics.resolvedAwaitingConfirmation;
    expect(body.attention.length).toBe(Math.min(expected, 10));
  });

  it("API-DASHR-05 / BR-22: the attention panel keeps the ten most recent rows and stops there", async () => {
    // API-DASHR-04 asserts `Math.min(expected, 10)`, which says nothing about
    // the cap while `expected` is nine - and it was nine. A limit nothing
    // crosses is a limit nothing tests, which is Issue #47's lesson written
    // down again: the rule needs the case that reaches it, not only the one
    // that falls short.
    for (let i = 0; i < 5; i += 1) await makeTicket(mineId, "WAITING_FOR_REQUESTER", i + 1);

    const attentionWhere = {
      requesterId: mineId,
      currentStatus: { in: ["WAITING_FOR_REQUESTER", "RESOLVED"] as CurrentStatus[] },
    };
    expect(await prisma.ticket.count({ where: attentionWhere })).toBeGreaterThan(10);

    const body = await dashboard(mineCookie);
    expect(body.attention).toHaveLength(10);

    const times = body.attention.map((r) => new Date(r.updatedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // And they are the ten most recent, not an arbitrary ten. Compared by the
    // eleventh row's timestamp rather than by id, so two Tickets written in the
    // same millisecond cannot decide whether this passes.
    const ordered = await prisma.ticket.findMany({
      where: attentionWhere,
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    const cutoff = ordered[9]!.updatedAt.getTime();
    for (const row of body.attention) {
      expect(new Date(row.updatedAt).getTime(), `ticket ${row.id}`).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it("API-DASHR-06 / AC-21: a Requester with no Tickets receives zeros and empty arrays, not an error", async () => {
    const body = await dashboard(emptyCookie);

    expect(body.metrics).toEqual({ openTickets: 0, waitingForMe: 0, resolvedAwaitingConfirmation: 0 });
    expect(body.attention).toEqual([]);
    expect(body.recentlyUpdated).toEqual([]);
    expect(body.recentlyResolved).toEqual([]);
  });
});

describe("The drill-down", () => {
  it("API-DASHR-09 / AC-17, FR-19: each card's documented query returns exactly the number the card showed", async () => {
    // ui-spec.md section 5.3 links every card into My Tickets with a filter, and
    // that list accepted only `status=NEW` until Issue #50 - Lab 2's contract,
    // from when New was the only status a Ticket could have. Every card
    // therefore opened an unfiltered list, which is the disagreement AC-17
    // forbids, and nothing caught it because UI-DASHR-04 asserts the href and
    // not what the href opens. Found by the user pressing a card.
    await makeTicket(mineId, "WAITING_FOR_REQUESTER");
    await makeTicket(mineId, "RESOLVED");
    await makeTicket(mineId, "OPEN");
    await makeTicket(mineId, "CLOSED");
    await makeTicket(theirsId, "WAITING_FOR_REQUESTER");

    const body = await dashboard(mineCookie);
    const total = async (query: string) => {
      const res = await get(mineCookie, `/api/tickets?${query}&pageSize=100`);
      expect(res.status, query).toBe(200);
      return res.body.pagination.totalItems as number;
    };

    expect(await total("status=open")).toBe(body.metrics.openTickets);
    expect(await total("status=WAITING_FOR_REQUESTER")).toBe(body.metrics.waitingForMe);
    expect(await total("status=RESOLVED")).toBe(body.metrics.resolvedAwaitingConfirmation);

    // Still only the caller's own, however it is filtered (BR-23).
    const rows = (await get(mineCookie, "/api/tickets?status=WAITING_FOR_REQUESTER&pageSize=100")).body
      .data as { id: number }[];
    for (const row of rows) {
      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: row.id } });
      expect(stored.requesterId, `ticket ${row.id}`).toBe(mineId);
      expect(stored.currentStatus, `ticket ${row.id}`).toBe("WAITING_FOR_REQUESTER");
    }

    // Lenient like every other list parameter (Lab 2 BR-18): junk falls back
    // rather than failing, so a hand-edited address never breaks the screen.
    const everything = await total("status=");
    expect(await total("status=nonsense")).toBe(everything);
  });
});

describe("Who may ask", () => {
  it("API-DASHR-07 / AC-22: IT Staff and an Administrator are refused their own Requester dashboard", async () => {
    for (const [role, cookie] of [
      ["IT Staff", staffCookie],
      ["Administrator", adminCookie],
    ] as const) {
      const res = await get(cookie);
      expect(res.status, role).toBe(403);
      expect(res.body.error.code, role).toBe("FORBIDDEN");
      expect(res.body, role).not.toHaveProperty("metrics");
    }
  });

  it("API-DASHR-08 / BR-14: a caller with no session is refused before anything is counted", async () => {
    const res = await request(app).get("/api/dashboard/requester");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body).not.toHaveProperty("metrics");
  });
});
