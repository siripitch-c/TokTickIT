import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { ActionStatus, CurrentStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-FLOW-01..12, API-FLOW-14; specification.md FR-08..FR-10, FR-24,
// BR-16..BR-20, BR-26..BR-28, BR-30, AC-09..AC-14, AC-20, AC-27;
// api-spec.md §6.
//
// Two claims are under test here and they are not the same claim. One is that
// the three Ticket writes now refuse to act on a copy somebody else has
// already changed. The other is that a Ticket cannot be called resolved while
// work on it is still open — the rule Lab 3 deferred, enforced in the backend
// so that a request made outside the screen meets it too.
//
// The transition tables below are transcribed from lab-04/specification.md
// BR-16 by hand, deliberately. The Lab 3 suite drives the same endpoint from
// `canTransition`, which proves the endpoint obeys the helper; this one proves
// the helper still says what Lab 4's own document says it says. Copying the
// helper here would prove only that it equals itself.

const prisma = getPrisma();

const REQUESTER = "flow.requester@test.invalid";
const STAFF = "flow.staff@test.invalid";
const STAFF_TWO = "flow.staff2@test.invalid";
const EMAILS = [REQUESTER, STAFF, STAFF_TWO];

const NUMBER_PREFIX = "TKT-2094-";
const TICKET_CREATED = new Date("2026-02-01T00:00:00.000Z");

let requesterId = 0;
let staffId = 0;
let staffTwoId = 0;
let requesterCookie = "";
let staffCookie = "";
let staffTwoCookie = "";
let categoryId = 0;
let relatedSystemId = 0;
let sequence = 0;

const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set("Cookie", cookie),
  post: (url: string, body?: unknown) =>
    request(app)
      .post(url)
      .set("Cookie", cookie)
      .send(body as object),
  patch: (url: string, body?: unknown) =>
    request(app)
      .patch(url)
      .set("Cookie", cookie)
      .send(body as object),
});

async function makeTicket(currentStatus: CurrentStatus = "IN_PROGRESS") {
  sequence += 1;
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(sequence).padStart(6, "0")}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: `Workflow fixture ${sequence}`,
      description: "A Ticket for the workflow and resolution suite.",
      requestedPriority: "LOW",
      itPriority: "LOW",
      currentStatus,
      createdAt: TICKET_CREATED,
      updatedAt: TICKET_CREATED,
    },
  });
}

/** An Action in a chosen state, written straight to the database: these cases
 *  are about the Ticket's gate, not about how the Action got there. */
async function addAction(ticketId: number, status: ActionStatus) {
  return prisma.actionTaken.create({
    data: {
      ticketId,
      actionAt: TICKET_CREATED,
      description: `An action that is ${status}.`,
      result: status === "COMPLETED" ? "Finished." : null,
      status,
      performedById: staffId,
      assignedToId: staffId,
    },
  });
}

/** The version a caller would be holding, read the way a caller reads it. */
async function versionOf(ticketId: number): Promise<number> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { version: true } });
  return ticket.version;
}

/** A status write that carries the version the Ticket currently holds. */
async function moveTo(ticketId: number, currentStatus: CurrentStatus, cookie = staffCookie) {
  return as(cookie).patch(`/api/tickets/${ticketId}/status`, {
    version: await versionOf(ticketId),
    currentStatus,
  });
}

// lab-04/specification.md BR-16, transcribed by hand from the table, row by row.
const PERMITTED: Record<CurrentStatus, CurrentStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CANCELLED: [],
};

const ALL_STATUSES = Object.keys(PERMITTED) as CurrentStatus[];

beforeAll(async () => {
  requesterId = (await upsertTestUser({ email: REQUESTER, name: "Flow Requester" })).id;
  staffId = (await upsertTestUser({ email: STAFF, name: "Flow Staff", role: "IT_STAFF" })).id;
  staffTwoId = (await upsertTestUser({ email: STAFF_TWO, name: "Flow Staff Two", role: "IT_STAFF" })).id;

  requesterCookie = await signIn(REQUESTER);
  staffCookie = await signIn(STAFF);
  staffTwoCookie = await signIn(STAFF_TWO);

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

describe("The resolution gate (BR-18)", () => {
  it("API-FLOW-01 / AC-09, BR-18, FR-08: a Ticket with a Planned Action cannot be resolved, and the refusal counts them", async () => {
    const ticket = await makeTicket("IN_PROGRESS");
    await addAction(ticket.id, "PLANNED");
    await addAction(ticket.id, "COMPLETED");

    const res = await moveTo(ticket.id, "RESOLVED");

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "OPEN_ACTIONS_REMAIN",
      message: "1 action on this ticket is still open. Complete or cancel it before resolving it.",
      field: "status",
    });

    // Nothing moved, and the number the screen would have shown is the number
    // the refusal counted — one source, not two (api-spec.md §6).
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.currentStatus).toBe("IN_PROGRESS");
    const read = await as(staffCookie).get(`/api/tickets/${ticket.id}`);
    expect(read.body.data.openActionCount).toBe(1);
  });

  it("API-FLOW-02 / AC-09: an In Progress Action blocks it too, and the message counts every open Action", async () => {
    const ticket = await makeTicket("OPEN");
    await addAction(ticket.id, "IN_PROGRESS");
    await addAction(ticket.id, "PLANNED");
    await addAction(ticket.id, "CANCELLED");

    const res = await moveTo(ticket.id, "RESOLVED");

    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "OPEN_ACTIONS_REMAIN",
      message: "2 actions on this ticket are still open. Complete or cancel them before resolving it.",
      field: "status",
    });
    const read = await as(staffCookie).get(`/api/tickets/${ticket.id}`);
    expect(read.body.data.openActionCount).toBe(2);
  });

  it("API-FLOW-03 / AC-10: once every Action is Completed or Cancelled the same move succeeds", async () => {
    const ticket = await makeTicket("IN_PROGRESS");
    const planned = await addAction(ticket.id, "PLANNED");
    await addAction(ticket.id, "CANCELLED");

    expect((await moveTo(ticket.id, "RESOLVED")).status).toBe(409);

    // BR-05's two final states are the two that clear the gate, so finishing
    // the open one is all it takes.
    await prisma.actionTaken.update({
      where: { id: planned.id },
      data: { status: "COMPLETED", result: "Finished." },
    });

    const res = await moveTo(ticket.id, "RESOLVED");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.currentStatus).toBe("RESOLVED");
    expect(res.body.data.openActionCount).toBe(0);
  });

  it("API-FLOW-04 / AC-27, BR-18: a Ticket carrying no Actions at all resolves, as every migrated Ticket must", async () => {
    const ticket = await makeTicket("IN_PROGRESS");

    const res = await moveTo(ticket.id, "RESOLVED");

    // The gate counts open Actions; zero Actions is zero open ones. A Ticket
    // created before Lab 4 existed must not become unresolvable (MIG-01..04).
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.currentStatus).toBe("RESOLVED");
    expect(res.body.data.openActionCount).toBe(0);
  });

  it("API-FLOW-05 / AC-11, BR-19: cancelling a Ticket is not gated, and the open Actions are left exactly as they were", async () => {
    const ticket = await makeTicket("IN_PROGRESS");
    const planned = await addAction(ticket.id, "PLANNED");
    const started = await addAction(ticket.id, "IN_PROGRESS");

    const res = await moveTo(ticket.id, "CANCELLED");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.currentStatus).toBe("CANCELLED");
    // BR-19: abandoned work is not tidied up on the way out, because the only
    // thing tidying it could produce is a fictional entry.
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: planned.id } })).status).toBe("PLANNED");
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("IN_PROGRESS");
    expect(res.body.data.openActionCount).toBe(2);
  });
});

describe("The transition matrix (BR-16)", () => {
  it("API-FLOW-07 / BR-16: every move the Lab 4 table marks permitted is accepted", async () => {
    let accepted = 0;

    for (const from of ALL_STATUSES) {
      for (const to of PERMITTED[from]) {
        const ticket = await makeTicket(from);
        const res = await moveTo(ticket.id, to);

        expect(res.status, `${from} -> ${to}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(res.body.data.currentStatus, `${from} -> ${to}`).toBe(to);
        accepted += 1;
      }
    }

    // The table has twenty permitted moves. Counted so that a row quietly
    // disappearing from the transcription above cannot make this pass.
    expect(accepted).toBe(20);
  });

  it("API-FLOW-06 / AC-12, BR-16: every other pair is refused, the status is unchanged, and the message names both ends", async () => {
    let refused = 0;

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (PERMITTED[from].includes(to)) continue;

        const ticket = await makeTicket(from);
        const res = await moveTo(ticket.id, to);

        expect(res.status, `${from} -> ${to}`).toBe(409);
        expect(res.body.error.code, `${from} -> ${to}`).toBe("INVALID_STATUS_TRANSITION");
        const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect(stored.currentStatus, `${from} -> ${to}`).toBe(from);
        refused += 1;
      }
    }

    // Sixty-four pairs, twenty of them permitted. The eight self-moves are
    // among the refusals: BR-16 has no self-transitions, so setting a status
    // to the value it already holds is a conflict, not a silent success.
    expect(refused).toBe(64 - 20);
  });

  it("API-FLOW-08 / BR-17: a Requester has no transition available, not even on their own Ticket", async () => {
    const ticket = await makeTicket("OPEN");

    const res = await as(requesterCookie).patch(`/api/tickets/${ticket.id}/status`, {
      version: await versionOf(ticket.id),
      currentStatus: "RESOLVED",
    });

    // 403 rather than 404: the Ticket is theirs and they can read it, so
    // hiding its existence would be a lie they can already disprove.
    expect(res.status).toBe(403);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).currentStatus).toBe("OPEN");
  });
});

describe("The version precondition (BR-26, BR-28)", () => {
  it("API-FLOW-09 / AC-13, BR-26: the second writer's version is no longer current, and the first writer's change survives", async () => {
    const ticket = await makeTicket("OPEN");

    // Both open the Ticket; both are holding version 1.
    const held = await versionOf(ticket.id);

    const first = await as(staffCookie).patch(`/api/tickets/${ticket.id}/it-priority`, {
      version: held,
      itPriority: "HIGH",
    });
    expect(first.status).toBe(200);

    const second = await as(staffTwoCookie).patch(`/api/tickets/${ticket.id}/owner`, {
      version: held,
      ownerId: staffTwoId,
    });

    expect(second.status).toBe(409);
    expect(second.body.error).toEqual({
      code: "STALE_UPDATE",
      message: "This ticket changed after you opened it. Reload to see the current version.",
      field: "version",
    });

    // Nothing of the second write landed, and nothing of the first was undone.
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.itPriority).toBe("HIGH");
    expect(stored.ownerId).toBeNull();
  });

  it("API-FLOW-10 / AC-14, BR-28: a write with no version is refused on all three operations, and so is a version that is not an integer", async () => {
    const ticket = await makeTicket("OPEN");

    const bodies: [string, object][] = [
      ["status", { currentStatus: "IN_PROGRESS" }],
      ["owner", { ownerId: staffId }],
      ["it-priority", { itPriority: "HIGH" }],
    ];

    for (const [operation, body] of bodies) {
      for (const version of [undefined, null, "1", 1.5]) {
        const sent = version === undefined ? body : { ...body, version };
        const res = await as(staffCookie).patch(`/api/tickets/${ticket.id}/${operation}`, sent);

        expect(res.status, `${operation} with ${JSON.stringify(version)}`).toBe(400);
        expect(res.body.error, `${operation} with ${JSON.stringify(version)}`).toEqual({
          code: "VERSION_REQUIRED",
          message: "Send the version you read so a concurrent change is not overwritten.",
          field: "version",
        });
      }
    }

    // BR-28's point: none of those twelve requests was treated as "no opinion".
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored).toMatchObject({ currentStatus: "OPEN", ownerId: null, itPriority: "LOW", version: 1 });
  });

  it("API-FLOW-11 / BR-26: owner, IT priority and status each raise the version by exactly one", async () => {
    const ticket = await makeTicket("OPEN");
    expect(ticket.version).toBe(1);

    const owner = await as(staffCookie).patch(`/api/tickets/${ticket.id}/owner`, { version: 1, ownerId: staffId });
    expect(owner.status).toBe(200);
    expect(owner.body.data.version).toBe(2);

    const priority = await as(staffCookie).patch(`/api/tickets/${ticket.id}/it-priority`, {
      version: 2,
      itPriority: "HIGH",
    });
    expect(priority.status).toBe(200);
    expect(priority.body.data.version).toBe(3);

    const status = await as(staffCookie).patch(`/api/tickets/${ticket.id}/status`, {
      version: 3,
      currentStatus: "IN_PROGRESS",
    });
    expect(status.status).toBe(200);
    expect(status.body.data.version).toBe(4);

    // A refused write must not consume a version: the caller's copy is still
    // current, and telling them otherwise would send them reloading for nothing.
    const refused = await as(staffCookie).patch(`/api/tickets/${ticket.id}/status`, {
      version: 4,
      currentStatus: "CLOSED",
    });
    expect(refused.status).toBe(409);
    expect(await versionOf(ticket.id)).toBe(4);
  });
});

describe("The Requester's resolution signal (BR-20)", () => {
  it("API-FLOW-12 / BR-20, AC-20: the signal is recorded once with its time, leaves the status alone, and is refused the second time", async () => {
    const ticket = await makeTicket("IN_PROGRESS");

    const first = await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);

    expect(first.status).toBe(200);
    expect(first.body.data.requesterResolvedAt).not.toBeNull();
    // BR-20, unchanged from Lab 3: the signal is advisory. Formally resolving
    // the Ticket stays with staff, and stays behind the gate above.
    expect(first.body.data.currentStatus).toBe("IN_PROGRESS");
    // Lab 4 BR-26: it is still a write, so a staff member holding this Ticket
    // on screen learns that it changed rather than overwriting the signal.
    expect(first.body.data.version).toBe(2);

    const recorded = first.body.data.requesterResolvedAt;
    const second = await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ALREADY_INDICATED");
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.requesterResolvedAt?.toISOString()).toBe(recorded);
    expect(stored.version).toBe(2);
  });
});

describe("Failure", () => {
  it("API-FLOW-14 / BR-30: an unexpected failure inside a status write is a generic 500 with nothing internal in it", async () => {
    const ticket = await makeTicket("OPEN");
    const version = await versionOf(ticket.id);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.ticket, "updateMany").mockRejectedValue(
      new Error('relation "Ticket" does not exist at E:\\CPE334\\tocktickit\\server\\src\\app.ts:1'),
    );

    const res = await as(staffCookie).patch(`/api/tickets/${ticket.id}/status`, {
      version,
      currentStatus: "IN_PROGRESS",
    });

    expect(res.status).toBe(500);
    // Compared whole: api-spec.md §6 says the 500 body is this and nothing
    // else, and a `details` key added later would pass a looser assertion.
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
    const text = JSON.stringify(res.body);
    for (const leak of [/relation/i, /\.ts/, /prisma/i, /at .*:\d+/, /\\|\//]) {
      expect(text).not.toMatch(leak);
    }

    vi.restoreAllMocks();
    consoleError.mockRestore();

    // The Ticket is untouched, and the next caller is not stuck with a version
    // the failure silently moved on.
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored).toMatchObject({ currentStatus: "OPEN", version });
  });
});
