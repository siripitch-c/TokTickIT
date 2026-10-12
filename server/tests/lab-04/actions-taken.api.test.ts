import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-ACTION-01..22; specification.md FR-01..FR-07, BR-01..BR-15,
// BR-26, BR-28, BR-29; api-spec.md §5.
//
// Everything here goes through the real endpoints with a real session cookie:
// the claims this sprint makes about who may write the work log are only worth
// something if the gate itself is what refuses.

const prisma = getPrisma();

const REQUESTER = "action.requester@test.invalid";
const OTHER_REQUESTER = "action.other@test.invalid";
const STAFF = "action.staff@test.invalid";
const STAFF_TWO = "action.staff2@test.invalid";
const ADMIN = "action.admin@test.invalid";
const RETIRED = "action.retired@test.invalid";
const EMAILS = [REQUESTER, OTHER_REQUESTER, STAFF, STAFF_TWO, ADMIN, RETIRED];

const NUMBER_PREFIX = "TKT-2093-";
const NEVER_EXISTED = 2_147_483_600;
const TICKET_CREATED = new Date("2026-02-01T00:00:00.000Z");

let requesterId = 0;
let otherRequesterId = 0;
let staffId = 0;
let staffTwoId = 0;
let adminId = 0;
let retiredId = 0;
let requesterCookie = "";
let otherCookie = "";
let staffCookie = "";
let staffTwoCookie = "";
let adminCookie = "";
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
  delete: (url: string) => request(app).delete(url).set("Cookie", cookie),
});

async function makeTicket(owner: number = requesterId) {
  sequence += 1;
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(sequence).padStart(6, "0")}`,
      requesterId: owner,
      categoryId,
      relatedSystemId,
      summary: `Action fixture ${sequence}`,
      description: "A Ticket for the Actions Taken suite.",
      requestedPriority: "LOW",
      itPriority: "LOW",
      createdAt: TICKET_CREATED,
      updatedAt: TICKET_CREATED,
    },
  });
}

/** A valid create body, so each test states only what it is actually about. */
function validAction(overrides: Record<string, unknown> = {}) {
  return {
    description: "Replaced the HDMI cable at the lectern and retested.",
    followUpRequired: false,
    ...overrides,
  };
}

async function createAction(ticketId: number, overrides: Record<string, unknown> = {}, cookie = staffCookie) {
  const res = await as(cookie).post(`/api/tickets/${ticketId}/actions`, validAction(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: number; version: number; status: string };
}

beforeAll(async () => {
  requesterId = (await upsertTestUser({ email: REQUESTER, name: "Action Requester" })).id;
  otherRequesterId = (await upsertTestUser({ email: OTHER_REQUESTER, name: "Action Other" })).id;
  staffId = (await upsertTestUser({ email: STAFF, name: "Action Staff", role: "IT_STAFF" })).id;
  staffTwoId = (await upsertTestUser({ email: STAFF_TWO, name: "Action Staff Two", role: "IT_STAFF" })).id;
  adminId = (await upsertTestUser({ email: ADMIN, name: "Action Admin", role: "ADMINISTRATOR" })).id;
  retiredId = (await upsertTestUser({ email: RETIRED, name: "Action Retired", role: "IT_STAFF", isActive: false })).id;

  requesterCookie = await signIn(REQUESTER);
  otherCookie = await signIn(OTHER_REQUESTER);
  staffCookie = await signIn(STAFF);
  staffTwoCookie = await signIn(STAFF_TWO);
  adminCookie = await signIn(ADMIN);

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

describe("Creating an Action Taken", () => {
  it("API-ACTION-01 / AC-01, BR-01, BR-08: a valid Action is stored under its Ticket with the caller as performer, and no refusal in this suite leaks internals", async () => {
    const ticket = await makeTicket();

    const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/actions`, {
      description: "  Replaced the HDMI cable at the lectern and retested.  ",
      result: "Projector shows the laptop image again.",
      status: "COMPLETED",
      followUpRequired: false,
      attachmentNotes: "See lectern-after.jpg on the ticket.",
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ticketId: ticket.id,
      description: "Replaced the HDMI cable at the lectern and retested.",
      result: "Projector shows the laptop image again.",
      status: "COMPLETED",
      followUpRequired: false,
      followUpNote: null,
      attachmentNotes: "See lectern-after.jpg on the ticket.",
      performedBy: { id: staffId, name: "Action Staff", role: "IT_STAFF" },
      assignedTo: { id: staffId, role: "IT_STAFF" },
      version: 1,
    });
    // BR-07, api-spec.md §4: the actor summary is id, name and role — never an
    // email address, and never a password field.
    expect(Object.keys(res.body.data.performedBy).sort()).toEqual(["id", "name", "role"]);
  });

  it("API-ACTION-02 / AC-02, BR-03: a performedById in the body is ignored", async () => {
    const ticket = await makeTicket();

    const res = await as(staffCookie).post(
      `/api/tickets/${ticket.id}/actions`,
      validAction({ performedById: adminId, performedBy: { id: adminId } }),
    );

    expect(res.status).toBe(201);
    expect(res.body.data.performedBy.id).toBe(staffId);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.performedById).toBe(staffId);
  });

  it("API-ACTION-03 / BR-10, BR-29: description length is enforced server-side", async () => {
    const ticket = await makeTicket();

    for (const description of ["four", "x".repeat(2001)]) {
      const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/actions`, {
        description,
        followUpRequired: false,
      });
      expect(res.status, description.length.toString()).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "description" });
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("API-ACTION-04 / AC-03, BR-07: follow-up without a usable note is refused", async () => {
    const ticket = await makeTicket();

    for (const body of [
      validAction({ followUpRequired: true }),
      validAction({ followUpRequired: true, followUpNote: "   " }),
      validAction({ followUpRequired: true, followUpNote: "four" }),
    ]) {
      const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/actions`, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "followUpNote" });
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("API-ACTION-05 / BR-07: turning follow-up off clears the note rather than hiding it", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id, {
      followUpRequired: true,
      followUpNote: "Check again after the weekend lecture.",
    });

    const res = await as(staffCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      followUpRequired: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ followUpRequired: false, followUpNote: null });
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.followUpNote).toBeNull();
  });

  it("API-ACTION-06 / AC-04, BR-04: an inactive account cannot be the assignee, and the Action keeps the one it had", async () => {
    const ticket = await makeTicket();

    const created = await as(staffCookie).post(
      `/api/tickets/${ticket.id}/actions`,
      validAction({ assignedToId: retiredId }),
    );
    expect(created.status).toBe(400);
    expect(created.body.error).toMatchObject({ code: "INVALID_ASSIGNEE", field: "assignedToId" });

    const action = await createAction(ticket.id, { assignedToId: staffTwoId });
    const reassigned = await as(staffCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      assignedToId: retiredId,
    });
    expect(reassigned.status).toBe(400);
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.assignedToId).toBe(staffTwoId);
    expect(stored.version).toBe(1);
  });

  it("API-ACTION-07 / BR-04: a Requester cannot be the assignee", async () => {
    const ticket = await makeTicket();

    const res = await as(staffCookie).post(
      `/api/tickets/${ticket.id}/actions`,
      validAction({ assignedToId: requesterId }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "INVALID_ASSIGNEE", field: "assignedToId" });
  });

  it("API-ACTION-08 / BR-04: an account deactivated after assignment keeps the Action, which stays readable", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id, { assignedToId: staffTwoId });

    // Lab 3 BR-26 keeps a Ticket with its owner when the account is switched
    // off; an Action is the same record of who was responsible.
    await prisma.user.update({ where: { id: staffTwoId }, data: { isActive: false } });
    try {
      const res = await as(staffCookie).get(`/api/tickets/${ticket.id}/actions`);
      expect(res.status).toBe(200);
      expect(res.body.data.find((a: { id: number }) => a.id === action.id).assignedTo.id).toBe(staffTwoId);
    } finally {
      await prisma.user.update({ where: { id: staffTwoId }, data: { isActive: true } });
      staffTwoCookie = await signIn(STAFF_TWO);
    }
  });

  it("API-ACTION-09 / BR-09: an action date in the future, or before the Ticket existed, is refused", async () => {
    const ticket = await makeTicket();

    for (const actionAt of [
      new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      new Date(TICKET_CREATED.getTime() - 1000).toISOString(),
      "not-a-date",
    ]) {
      const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/actions`, validAction({ actionAt }));
      expect(res.status, actionAt).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "actionAt" });
    }
  });

  it("API-ACTION-20 / BR-12: creating an Action leaves the Ticket's status alone", async () => {
    const ticket = await makeTicket();
    await createAction(ticket.id, { status: "IN_PROGRESS" });

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.currentStatus).toBe("NEW");
  });

  it("BR-05, api-spec.md §5: a new Action cannot start cancelled", async () => {
    const ticket = await makeTicket();

    const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/actions`, validAction({ status: "CANCELLED" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ field: "status" });
  });
});

describe("Completing, cancelling and editing", () => {
  it("API-ACTION-10 / AC-05, BR-05, BR-26: completing with a result moves the status and raises the version", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    const res = await as(staffCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      status: "COMPLETED",
      result: "Projector shows the laptop image again.",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "COMPLETED", version: action.version + 1 });
  });

  it("API-ACTION-11 / BR-06: completing with no result is refused", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    const res = await as(staffCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      status: "COMPLETED",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "result" });
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.status).toBe("PLANNED");
    expect(stored.version).toBe(1);
  });

  it("API-ACTION-12 / AC-06: a Completed or Cancelled Action refuses every further change", async () => {
    const ticket = await makeTicket();

    for (const final of ["COMPLETED", "CANCELLED"] as const) {
      const action = await createAction(ticket.id);
      const closed = await as(staffCookie).patch(`/api/actions/${action.id}`, {
        version: action.version,
        status: final,
        ...(final === "COMPLETED" ? { result: "Done." } : {}),
      });
      expect(closed.status).toBe(200);

      const again = await as(staffCookie).patch(`/api/actions/${action.id}`, {
        version: closed.body.data.version,
        description: "Trying to rewrite a finished action.",
      });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({ code: "ACTION_FINAL" });
      const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
      expect(stored.description).toBe("Replaced the HDMI cable at the lectern and retested.");
    }
  });

  it("API-ACTION-13 / BR-05: a transition the matrix forbids is a conflict", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id, { status: "IN_PROGRESS" });

    const res = await as(staffCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      status: "PLANNED",
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_ACTION_TRANSITION", field: "status" });
  });

  it("API-ACTION-21 / AC-13, BR-26: the second writer holding the old version is refused and the first write survives", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    const first = await as(staffCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      description: "The first writer's description.",
    });
    expect(first.status).toBe(200);

    const second = await as(staffTwoCookie).patch(`/api/actions/${action.id}`, {
      version: action.version,
      description: "The second writer's description.",
    });

    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "STALE_UPDATE", field: "version" });
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.description).toBe("The first writer's description.");
    expect(stored.version).toBe(2);
  });

  it("API-ACTION-22 / AC-14, BR-28: a write with no version is rejected", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    for (const body of [{ description: "No version at all." }, { version: "2", description: "A string version." }]) {
      const res = await as(staffCookie).patch(`/api/actions/${action.id}`, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VERSION_REQUIRED", field: "version" });
    }
    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored.version).toBe(1);
  });

  it("API-ACTION-19 / BR-13: there is no way to delete an Action", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    const res = await as(adminCookie).delete(`/api/actions/${action.id}`);

    expect([404, 405]).toContain(res.status);
    expect(await prisma.actionTaken.count({ where: { id: action.id } })).toBe(1);
  });
});

describe("Reading the log, and who may write to it", () => {
  it("API-ACTION-16 / FR-06: a Requester reads every Action on their own Ticket", async () => {
    const ticket = await makeTicket();
    await createAction(ticket.id, { description: "First action on this ticket." });
    await createAction(ticket.id, { description: "Second action on this ticket." }, adminCookie);

    const res = await as(requesterCookie).get(`/api/tickets/${ticket.id}/actions`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((a: { performedBy: { id: number } }) => a.performedBy.id)).toEqual([staffId, adminId]);
  });

  it("API-ACTION-17 / BR-11: the order is oldest action time first, with the id as the tie-break, and it is stable", async () => {
    const ticket = await makeTicket();
    const sameMoment = new Date("2026-03-01T10:00:00.000Z").toISOString();
    const later = new Date("2026-03-02T10:00:00.000Z").toISOString();

    const third = await createAction(ticket.id, { actionAt: later, description: "Written last, happened last." });
    const first = await createAction(ticket.id, { actionAt: sameMoment, description: "Same second, written first." });
    const second = await createAction(ticket.id, { actionAt: sameMoment, description: "Same second, written second." });

    const once = await as(staffCookie).get(`/api/tickets/${ticket.id}/actions`);
    const twice = await as(staffCookie).get(`/api/tickets/${ticket.id}/actions`);
    const ids = (res: { body: { data: { id: number }[] } }) => res.body.data.map((a) => a.id);

    expect(ids(once)).toEqual([first.id, second.id, third.id]);
    expect(ids(twice)).toEqual(ids(once));
  });

  it("API-ACTION-14 / AC-07, BR-14: a Requester cannot create, update, complete or cancel", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    const created = await as(requesterCookie).post(`/api/tickets/${ticket.id}/actions`, validAction());
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe("FORBIDDEN");

    for (const body of [
      { version: action.version, description: "A Requester editing the log." },
      { version: action.version, status: "COMPLETED", result: "Marked done by the wrong role." },
      { version: action.version, status: "CANCELLED" },
    ]) {
      const res = await as(requesterCookie).patch(`/api/actions/${action.id}`, body);
      expect(res.status).toBe(403);
    }

    const stored = await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } });
    expect(stored).toMatchObject({ status: "PLANNED", version: 1 });
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  it("API-ACTION-15 / AC-08, BR-15: another Requester's Ticket answers 404, and says nothing about it", async () => {
    const ticket = await makeTicket();
    await createAction(ticket.id, { description: "Nobody outside this ticket should see this." });

    const foreign = await as(otherCookie).get(`/api/tickets/${ticket.id}/actions`);
    const missing = await as(otherCookie).get(`/api/tickets/${NEVER_EXISTED}/actions`);

    expect(foreign.status).toBe(404);
    // Indistinguishable from a Ticket that never existed: the refusal must not
    // confirm that this one does.
    expect(foreign.body).toEqual(missing.body);
    expect(JSON.stringify(foreign.body)).not.toContain("Nobody outside");
  });

  it("API-ACTION-18 / BR-14: every endpoint refuses an unauthenticated caller", async () => {
    const ticket = await makeTicket();
    const action = await createAction(ticket.id);

    const list = await request(app).get(`/api/tickets/${ticket.id}/actions`);
    const create = await request(app).post(`/api/tickets/${ticket.id}/actions`).send(validAction());
    const update = await request(app).patch(`/api/actions/${action.id}`).send({ version: 1, description: "Nope." });

    for (const res of [list, create, update]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("API-ACTION-01 / BR-02, BR-14: an Administrator may write, and an Action may be performed by somebody other than the Ticket Owner", async () => {
    const ticket = await makeTicket();
    await prisma.ticket.update({ where: { id: ticket.id }, data: { ownerId: staffId } });

    const res = await as(adminCookie).post(
      `/api/tickets/${ticket.id}/actions`,
      validAction({ description: "An Administrator recording work on somebody else's ticket.", assignedToId: staffTwoId }),
    );

    expect(res.status).toBe(201);
    expect(res.body.data.performedBy.id).toBe(adminId);
    expect(res.body.data.assignedTo.id).toBe(staffTwoId);
    // BR-02: the Ticket's owner is untouched by the Action.
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBe(staffId);
  });
});
