import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { ActionStatus, CurrentStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { OPEN_STATUSES, resolvedWindowStart } from "../../src/dashboardMetrics.js";
import { CURRENT_STATUSES } from "../../src/statusTransitions.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-DASHS-01..10; specification.md FR-12..FR-16, BR-21, BR-23,
// BR-24, BR-25, AC-15..AC-18, AC-22; api-spec.md §7.
//
// The database this runs against holds the seed and every other suite's
// fixtures, so a count here is never a number anybody can write down in
// advance. Two honest ways to assert one remain, and both are used below: run
// the same question through Prisma and compare (BR-24 is exactly the claim that
// those two agree), or take a reading, change one thing, and check that the
// number moved by one.

const prisma = getPrisma();

const STAFF = "dash.staff@test.invalid";
const STAFF_TWO = "dash.staff2@test.invalid";
const ADMIN = "dash.admin@test.invalid";
const REQUESTER = "dash.requester@test.invalid";
const EMAILS = [STAFF, STAFF_TWO, ADMIN, REQUESTER];

const NUMBER_PREFIX = "TKT-2095-";

let staffId = 0;
let staffTwoId = 0;
let staffCookie = "";
let adminCookie = "";
let requesterCookie = "";
let requesterId = 0;
let categoryId = 0;
let relatedSystemId = 0;
let sequence = 0;

const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set("Cookie", cookie),
});

interface Dashboard {
  metrics: {
    unassigned: number;
    assignedToMe: number;
    myOpenActions: number;
    waitingForRequester: number;
    highItPriority: number;
    resolvedLast7Days: number;
    byStatus: Record<CurrentStatus, number>;
  };
  administratorMetrics?: { activeUsers: number; inactiveUsers: number };
  recentlyUpdated: { id: number; currentStatus: CurrentStatus; itPriority: string | null; updatedAt: string }[];
  needsAttention: { id: number; currentStatus: CurrentStatus; itPriority: string | null; updatedAt: string }[];
}

async function dashboard(cookie = staffCookie): Promise<Dashboard> {
  const res = await as(cookie).get("/api/dashboard/staff");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Dashboard;
}

async function makeTicket(overrides: {
  currentStatus?: CurrentStatus;
  ownerId?: number | null;
  itPriority?: "LOW" | "MEDIUM" | "HIGH";
  updatedAt?: Date;
  resolvedAt?: Date | null;
} = {}) {
  sequence += 1;
  const when = overrides.updatedAt ?? new Date();
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(sequence).padStart(6, "0")}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: `Dashboard fixture ${sequence}`,
      description: "A Ticket for the staff dashboard suite.",
      requestedPriority: "LOW",
      itPriority: overrides.itPriority ?? "LOW",
      currentStatus: overrides.currentStatus ?? "OPEN",
      ownerId: overrides.ownerId ?? null,
      createdAt: when,
      updatedAt: when,
      resolvedAt: overrides.resolvedAt ?? null,
    },
  });
}

async function addAction(ticketId: number, assignedToId: number, status: ActionStatus) {
  return prisma.actionTaken.create({
    data: {
      ticketId,
      actionAt: new Date(),
      description: `A dashboard fixture action that is ${status}.`,
      result: status === "COMPLETED" ? "Finished." : null,
      status,
      performedById: assignedToId,
      assignedToId,
    },
  });
}

beforeAll(async () => {
  staffId = (await upsertTestUser({ email: STAFF, name: "Dash Staff", role: "IT_STAFF" })).id;
  staffTwoId = (await upsertTestUser({ email: STAFF_TWO, name: "Dash Staff Two", role: "IT_STAFF" })).id;
  await upsertTestUser({ email: ADMIN, name: "Dash Admin", role: "ADMINISTRATOR" });
  requesterId = (await upsertTestUser({ email: REQUESTER, name: "Dash Requester" })).id;

  staffCookie = await signIn(STAFF);
  adminCookie = await signIn(ADMIN);
  requesterCookie = await signIn(REQUESTER);

  categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;

  await removeFixtures();
});

async function removeFixtures() {
  const tickets = { ticketNumber: { startsWith: NUMBER_PREFIX } };
  await prisma.actionTaken.deleteMany({ where: { ticket: tickets } });
  await prisma.ticket.deleteMany({ where: tickets });
}

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

describe("The shape of the answer", () => {
  it("API-DASHS-01 / AC-15, BR-21, BR-23: every metric is present, each an integer, and nothing beyond counts and short lists comes back", async () => {
    const body = await dashboard();

    expect(Object.keys(body).sort()).toEqual(["metrics", "needsAttention", "recentlyUpdated"]);
    expect(Object.keys(body.metrics).sort()).toEqual([
      "assignedToMe",
      "byStatus",
      "highItPriority",
      "myOpenActions",
      "resolvedLast7Days",
      "unassigned",
      "waitingForRequester",
    ]);
    for (const [name, value] of Object.entries(body.metrics)) {
      if (name === "byStatus") continue;
      expect(Number.isInteger(value), name).toBe(true);
      expect(value as number, name).toBeGreaterThanOrEqual(0);
    }

    // BR-23: short lists, and rows that carry only what a row shows. No
    // description, no requester, no attachments — and under no circumstances an
    // email address, which is the field a dashboard has no business carrying.
    for (const row of [...body.recentlyUpdated, ...body.needsAttention]) {
      expect(Object.keys(row).sort()).toEqual([
        "currentStatus",
        "id",
        "itPriority",
        "owner",
        "summary",
        "ticketNumber",
        "updatedAt",
      ]);
    }
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  it("API-DASHS-02 / AC-15, BR-24: every count equals the same question asked directly of the database", async () => {
    // The fixtures make each number non-zero, so an accidental `0 === 0` cannot
    // pass for agreement.
    const owned = await makeTicket({ ownerId: staffId, itPriority: "HIGH" });
    await makeTicket({ ownerId: null });
    await makeTicket({ currentStatus: "WAITING_FOR_REQUESTER" });
    await addAction(owned.id, staffId, "PLANNED");

    const body = await dashboard();
    const open = { currentStatus: { in: [...OPEN_STATUSES] } };

    expect(body.metrics.unassigned).toBe(await prisma.ticket.count({ where: { ...open, ownerId: null } }));
    expect(body.metrics.assignedToMe).toBe(await prisma.ticket.count({ where: { ...open, ownerId: staffId } }));
    expect(body.metrics.waitingForRequester).toBe(
      await prisma.ticket.count({ where: { currentStatus: "WAITING_FOR_REQUESTER" } }),
    );
    expect(body.metrics.highItPriority).toBe(
      await prisma.ticket.count({ where: { ...open, itPriority: "HIGH" } }),
    );
    expect(body.metrics.myOpenActions).toBe(
      await prisma.actionTaken.count({
        where: { assignedToId: staffId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      }),
    );
    expect(body.metrics.resolvedLast7Days).toBe(
      await prisma.ticket.count({
        where: { currentStatus: "RESOLVED", resolvedAt: { gte: resolvedWindowStart() } },
      }),
    );
    for (const status of CURRENT_STATUSES) {
      expect(body.metrics.byStatus[status], status).toBe(
        await prisma.ticket.count({ where: { currentStatus: status } }),
      );
    }
  });

  it("API-DASHS-05 / BR-21: the by-status map carries all eight statuses, zeros included", async () => {
    const body = await dashboard();

    expect(Object.keys(body.metrics.byStatus).sort()).toEqual([...CURRENT_STATUSES].sort());
    for (const status of CURRENT_STATUSES) {
      expect(Number.isInteger(body.metrics.byStatus[status]), status).toBe(true);
    }
    // A status with nothing in it is still a row. Cancelled fixtures are not
    // created here, so if the seed ever stopped carrying one this would be the
    // zero the strip must still render rather than drop.
    const absent = CURRENT_STATUSES.filter((s) => body.metrics.byStatus[s] === 0);
    for (const status of absent) expect(body.metrics.byStatus[status]).toBe(0);
  });
});

describe("What the numbers count", () => {
  it("API-DASHS-03 / BR-21: Resolved, Closed and Cancelled Tickets are outside every metric that claims to count open work", async () => {
    const before = await dashboard();

    // One Ticket in each terminal status, unassigned, High priority — which
    // would land in three different cards if "open" were not enforced.
    for (const currentStatus of ["RESOLVED", "CLOSED", "CANCELLED"] as CurrentStatus[]) {
      await makeTicket({ currentStatus, ownerId: null, itPriority: "HIGH" });
      await makeTicket({ currentStatus, ownerId: staffId, itPriority: "HIGH" });
    }

    const after = await dashboard();
    expect(after.metrics.unassigned).toBe(before.metrics.unassigned);
    expect(after.metrics.assignedToMe).toBe(before.metrics.assignedToMe);
    expect(after.metrics.highItPriority).toBe(before.metrics.highItPriority);

    // They are not invisible, though: by-status counts every Ticket there is,
    // which is what makes the strip a different question from the cards.
    expect(after.metrics.byStatus.RESOLVED).toBe(before.metrics.byStatus.RESOLVED + 2);
    expect(after.metrics.byStatus.CLOSED).toBe(before.metrics.byStatus.CLOSED + 2);
    expect(after.metrics.byStatus.CANCELLED).toBe(before.metrics.byStatus.CANCELLED + 2);
  });

  it("API-DASHS-04 / AC-16, FR-13: My open actions counts the caller's unfinished Actions, and nobody else's", async () => {
    const before = await dashboard();
    const ticket = await makeTicket({ ownerId: staffTwoId });

    await addAction(ticket.id, staffId, "PLANNED");
    await addAction(ticket.id, staffId, "IN_PROGRESS");
    // Finished work of the caller's, and open work of somebody else's: neither
    // is unfinished work of the caller's.
    await addAction(ticket.id, staffId, "COMPLETED");
    await addAction(ticket.id, staffId, "CANCELLED");
    await addAction(ticket.id, staffTwoId, "PLANNED");

    const after = await dashboard();
    expect(after.metrics.myOpenActions).toBe(before.metrics.myOpenActions + 2);

    // The card counts Actions, not Tickets: all five above sit on one Ticket,
    // and two of them are the caller's unfinished ones.
    const sameTicket = await prisma.actionTaken.count({
      where: { ticketId: ticket.id, assignedToId: staffId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
    });
    expect(sameTicket).toBe(2);
  });

  it("API-DASHS-06 / BR-25: a Ticket resolved six days ago counts and one resolved eight days ago does not", async () => {
    const before = await dashboard();
    const since = resolvedWindowStart();
    const DAY = 24 * 60 * 60 * 1000;

    await makeTicket({ currentStatus: "RESOLVED", resolvedAt: new Date(since.getTime() + 6 * DAY) });
    await makeTicket({ currentStatus: "RESOLVED", resolvedAt: new Date(since.getTime() - 2 * DAY) });
    // The edge itself belongs to the window: midnight Bangkok is inside it.
    await makeTicket({ currentStatus: "RESOLVED", resolvedAt: since });
    // And the millisecond before it is not.
    await makeTicket({ currentStatus: "RESOLVED", resolvedAt: new Date(since.getTime() - 1) });

    const after = await dashboard();
    expect(after.metrics.resolvedLast7Days).toBe(before.metrics.resolvedLast7Days + 2);

    // A Ticket that was resolved inside the window and has since been reopened
    // is somebody's problem again, so it leaves the number.
    const reopened = await makeTicket({
      currentStatus: "REOPENED",
      resolvedAt: new Date(since.getTime() + DAY),
    });
    expect((await dashboard()).metrics.resolvedLast7Days).toBe(before.metrics.resolvedLast7Days + 2);
    expect(reopened.resolvedAt).not.toBeNull();

    // And one resolved inside the window and then closed is not counted either,
    // for the reason BR-21 now states: the card opens the queue filtered to
    // Resolved, and a count that included closed Tickets would not match it.
    await makeTicket({ currentStatus: "CLOSED", resolvedAt: new Date(since.getTime() + DAY) });
    expect((await dashboard()).metrics.resolvedLast7Days).toBe(before.metrics.resolvedLast7Days + 2);
  });

  it("API-DASHS-07 / FR-14: both lists hold at most ten open Tickets, ordered as the dashboard reads them", async () => {
    // Twelve High-priority open Tickets, so both lists are certainly full.
    for (let i = 0; i < 12; i += 1) {
      await makeTicket({ itPriority: "HIGH", updatedAt: new Date(Date.now() - i * 60_000) });
    }

    const body = await dashboard();

    for (const [name, list] of [
      ["recentlyUpdated", body.recentlyUpdated],
      ["needsAttention", body.needsAttention],
    ] as const) {
      expect(list.length, name).toBe(10);
      for (const row of list) expect(OPEN_STATUSES, `${name}: ${row.currentStatus}`).toContain(row.currentStatus);
    }

    const updatedTimes = body.recentlyUpdated.map((r) => new Date(r.updatedAt).getTime());
    expect([...updatedTimes].sort((a, b) => b - a)).toEqual(updatedTimes);

    // Needs attention is the other way round, and High priority only: the
    // Ticket nobody has touched for longest is the one that needs somebody.
    const attentionTimes = body.needsAttention.map((r) => new Date(r.updatedAt).getTime());
    expect([...attentionTimes].sort((a, b) => a - b)).toEqual(attentionTimes);
    for (const row of body.needsAttention) expect(row.itPriority).toBe("HIGH");
  });
});

describe("The drill-down", () => {
  it("API-DASHS-11 / AC-17, FR-15: each card's documented query returns exactly the number the card showed", async () => {
    // The queue gained three parameters for this (api-spec.md §6 and §7).
    // Untested, they would be three ways for a card to open a list that does
    // not match it — and a dashboard that disagrees with its own drill-down is
    // worse than no dashboard, because it is believed.
    const owned = await makeTicket({ ownerId: staffId, itPriority: "HIGH" });
    await addAction(owned.id, staffId, "IN_PROGRESS");
    await makeTicket({ ownerId: null });
    await makeTicket({ currentStatus: "WAITING_FOR_REQUESTER" });
    await makeTicket({ currentStatus: "CLOSED", ownerId: null, itPriority: "HIGH" });

    const body = await dashboard();
    const total = async (query: string) => {
      const res = await as(staffCookie).get(`/api/staff/tickets?${query}&pageSize=100`);
      expect(res.status, query).toBe(200);
      return res.body.pagination.totalItems as number;
    };

    // ui-spec.md §4.5, card by card. `owner=me` is resolved to an id by the
    // screen before it asks, because the queue deliberately ignores `me`
    // (API-QUEUE-09) — the dashboard changes none of that.
    expect(await total("owner=unassigned&status=open")).toBe(body.metrics.unassigned);
    expect(await total(`owner=${staffId}&status=open`)).toBe(body.metrics.assignedToMe);
    expect(await total("status=WAITING_FOR_REQUESTER")).toBe(body.metrics.waitingForRequester);
    expect(await total("itPriority=HIGH&status=open")).toBe(body.metrics.highItPriority);
    for (const status of CURRENT_STATUSES) {
      expect(await total(`status=${status}`), status).toBe(body.metrics.byStatus[status]);
    }

    // My open actions is the one card whose number is not a Ticket count: it
    // counts Actions, and the queue it opens lists the Tickets those Actions
    // sit on. The two agree only when each Ticket carries one of them, so the
    // claim tested here is the one the interface actually makes - every Ticket
    // in that list has unfinished work of mine on it.
    const mine = await as(staffCookie).get("/api/staff/tickets?actionsAssignedTo=me&actionStatus=open&pageSize=100");
    expect(mine.status).toBe(200);
    const ids = (mine.body.data as { id: number }[]).map((t) => t.id);
    expect(ids).toContain(owned.id);
    for (const id of ids) {
      const open = await prisma.actionTaken.count({
        where: { ticketId: id, assignedToId: staffId, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      });
      expect(open, `ticket ${id}`).toBeGreaterThan(0);
    }
  });

  it("API-DASHS-11 / BR-40: the new queue parameters stay lenient, and `status=open` means the five open statuses", async () => {
    const openTotal = async (query: string) => {
      const res = await as(staffCookie).get(`/api/staff/tickets?${query}&pageSize=100`);
      expect(res.status, query).toBe(200);
      return res.body.pagination.totalItems as number;
    };

    const open = await openTotal("status=open");
    expect(open).toBe(await prisma.ticket.count({ where: { currentStatus: { in: [...OPEN_STATUSES] } } }));

    // Junk falls back to its default rather than failing the request, exactly
    // as every other queue parameter does.
    const everything = await openTotal("status=");
    expect(await openTotal("status=nonsense")).toBe(everything);
    expect(await openTotal("actionsAssignedTo=not-a-user")).toBe(everything);
    // An unknown action status falls back to "the unfinished ones", so the
    // filter still applies - the parameter that chose the person is the one
    // that decides whether to filter at all.
    expect(await openTotal("actionsAssignedTo=me&actionStatus=nonsense")).toBe(
      await openTotal("actionsAssignedTo=me&actionStatus=open"),
    );
    // And naming one status narrows it further.
    expect(await openTotal("actionsAssignedTo=me&actionStatus=COMPLETED")).toBe(
      await prisma.ticket.count({
        where: { actions: { some: { assignedToId: staffId, status: "COMPLETED" } } },
      }),
    );
  });
});

describe("Who may ask", () => {
  it("API-DASHS-08 / AC-18, FR-16: an Administrator receives the account counts and IT Staff receive no such key", async () => {
    const admin = await dashboard(adminCookie);

    expect(admin.administratorMetrics).toBeDefined();
    expect(admin.administratorMetrics!.activeUsers).toBe(await prisma.user.count({ where: { isActive: true } }));
    expect(admin.administratorMetrics!.inactiveUsers).toBe(
      await prisma.user.count({ where: { isActive: false } }),
    );

    // Absent, not null: a key that is always there and sometimes empty invites
    // a screen to render an empty "Accounts" heading for IT Staff.
    const staff = await dashboard(staffCookie);
    expect("administratorMetrics" in staff).toBe(false);

    // Everything else is the same dashboard for both.
    expect(Object.keys(admin.metrics).sort()).toEqual(Object.keys(staff.metrics).sort());
  });

  it("API-DASHS-09 / AC-22: a Requester is refused the staff dashboard", async () => {
    const res = await as(requesterCookie).get("/api/dashboard/staff");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body).not.toHaveProperty("metrics");
  });

  it("API-DASHS-10 / BR-14: a caller with no session is refused before anything is counted", async () => {
    const res = await request(app).get("/api/dashboard/staff");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body).not.toHaveProperty("metrics");
  });
});
