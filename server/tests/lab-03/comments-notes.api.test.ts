import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-COMMENT-01..07 and API-NOTE-01..07; specification.md FR-19,
// FR-20, BR-04, BR-16, BR-20..BR-24, AC-04, AC-14, AC-15; api-spec.md §5, §8.
//
// The Internal Notes cases are the ones this sprint's security claim rests on:
// the handout names Internal Notes explicitly among the things whose existence
// must not leak. So they check not only that a Requester is refused, but that
// the refusal is indistinguishable from asking about a Ticket that does not
// exist, and that nothing a Requester can read anywhere carries a trace.

const prisma = getPrisma();

const REQUESTER = "thread.requester@test.invalid";
const OTHER = "thread.other@test.invalid";
const STAFF = "thread.staff@test.invalid";
const ADMIN = "thread.admin@test.invalid";
const EMAILS = [REQUESTER, OTHER, STAFF, ADMIN];

const NUMBER_PREFIX = "TKT-2091-";
const NEVER_EXISTED = 2_147_483_600;
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
// Only ever written into an Internal Note, and by an author who never comments
// in this file, so finding either anywhere a Requester can read is a leak.
const SECRET = "QZX32-INTERNAL-ONLY";
const NOTE_AUTHOR = "Thread Admin";

let requesterId = 0;
let otherId = 0;
let staffId = 0;
let adminId = 0;
let requesterCookie = "";
let otherCookie = "";
let staffCookie = "";
let adminCookie = "";
let categoryId = 0;
let relatedSystemId = 0;
let sequence = 0;

async function makeTicket(owner: number = requesterId) {
  sequence += 1;
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(sequence).padStart(6, "0")}`,
      requesterId: owner,
      categoryId,
      relatedSystemId,
      summary: `Thread fixture ${sequence}`,
      description: "A Ticket for the thread suite.",
      requestedPriority: "LOW",
      itPriority: "LOW",
      updatedAt: LONG_AGO,
    },
  });
}

const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set("Cookie", cookie),
  post: (url: string, body?: unknown) =>
    request(app)
      .post(url)
      .set("Cookie", cookie)
      .send(body as object),
});

const ENTRY_KEYS = ["author", "body", "createdAt", "id", "ticketId"];

beforeAll(async () => {
  requesterId = (await upsertTestUser({ email: REQUESTER, name: "Thread Requester" })).id;
  otherId = (await upsertTestUser({ email: OTHER, name: "Thread Other" })).id;
  staffId = (await upsertTestUser({ email: STAFF, name: "Thread Staff", role: "IT_STAFF" })).id;
  adminId = (await upsertTestUser({ email: ADMIN, name: NOTE_AUTHOR, role: "ADMINISTRATOR" })).id;

  requesterCookie = await signIn(REQUESTER);
  otherCookie = await signIn(OTHER);
  staffCookie = await signIn(STAFF);
  adminCookie = await signIn(ADMIN);

  categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;

  await removeFixtures();
});

async function removeFixtures() {
  const tickets = { ticketNumber: { startsWith: NUMBER_PREFIX } };
  await prisma.publicComment.deleteMany({ where: { ticket: tickets } });
  await prisma.internalNote.deleteMany({ where: { ticket: tickets } });
  await prisma.ticket.deleteMany({ where: tickets });
}

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

describe("Public Comments", () => {
  it("API-COMMENT-01 / AC-14, BR-04, BR-22: a Requester's comment carries a server-made author and time, and staff and Administrators read it", async () => {
    const ticket = await makeTicket();
    const before = Date.now();

    const res = await as(requesterCookie).post(`/api/tickets/${ticket.id}/comments`, {
      body: "  The laptop still restarts after the update.  ",
    });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data).sort()).toEqual(ENTRY_KEYS);
    expect(res.body.data).toMatchObject({
      ticketId: ticket.id,
      // BR-23: stored trimmed.
      body: "The laptop still restarts after the update.",
      author: { id: requesterId, name: "Thread Requester", role: "REQUESTER" },
    });
    const createdAt = new Date(res.body.data.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);

    for (const cookie of [staffCookie, adminCookie]) {
      const thread = await as(cookie).get(`/api/tickets/${ticket.id}/comments`);
      expect(thread.status).toBe(200);
      expect(thread.body.data).toEqual([res.body.data]);
    }

    // A comment is activity everyone on the Ticket can see, so it moves Last
    // Updated and the Ticket rises in the queue.
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it("API-COMMENT-02 / BR-04: staff comment on any Ticket, and its Requester reads the reply", async () => {
    const ticket = await makeTicket();

    const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/comments`, {
      body: "Please restart in safe mode and tell us what you see.",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.author).toEqual({ id: staffId, name: "Thread Staff", role: "IT_STAFF" });

    const thread = await as(requesterCookie).get(`/api/tickets/${ticket.id}/comments`);
    expect(thread.body.data).toEqual([res.body.data]);
  });

  it("API-COMMENT-03 / BR-16: another Requester's Ticket is a Ticket that does not exist, for reading and for writing", async () => {
    const theirs = await makeTicket(otherId);

    const post = await as(requesterCookie).post(`/api/tickets/${theirs.id}/comments`, { body: "Hello?" });
    const postAbsent = await as(requesterCookie).post(`/api/tickets/${NEVER_EXISTED}/comments`, { body: "Hello?" });
    expect(post.status).toBe(404);
    expect(post.body).toEqual(postAbsent.body);
    expect(post.body.error.code).toBe("TICKET_NOT_FOUND");

    const read = await as(requesterCookie).get(`/api/tickets/${theirs.id}/comments`);
    const readAbsent = await as(requesterCookie).get(`/api/tickets/${NEVER_EXISTED}/comments`);
    expect(read.status).toBe(404);
    expect(read.body).toEqual(readAbsent.body);

    expect(await prisma.publicComment.count({ where: { ticketId: theirs.id } })).toBe(0);
  });

  it("API-COMMENT-03 / BR-16: access is checked before the body, so an invalid body cannot probe for a Ticket", async () => {
    const theirs = await makeTicket(otherId);

    const res = await as(requesterCookie).post(`/api/tickets/${theirs.id}/comments`, { body: "" });

    expect(res.status).toBe(404);
  });

  it("API-COMMENT-04 / BR-23, BR-42: an empty, whitespace-only, over-long, missing or non-text body is refused on that field", async () => {
    const ticket = await makeTicket();

    for (const body of [{ body: "" }, { body: "   " }, { body: "\n\t  " }, { body: "x".repeat(2001) }, {}, { body: 42 }, { body: null }]) {
      const res = await as(requesterCookie).post(`/api/tickets/${ticket.id}/comments`, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "body" });
    }

    expect(await prisma.publicComment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("API-COMMENT-05 / BR-23: one character and two thousand characters are both accepted, measured after trimming", async () => {
    const ticket = await makeTicket();

    const shortest = await as(requesterCookie).post(`/api/tickets/${ticket.id}/comments`, { body: " x " });
    expect(shortest.status).toBe(201);
    expect(shortest.body.data.body).toBe("x");

    const longest = await as(requesterCookie).post(`/api/tickets/${ticket.id}/comments`, { body: "y".repeat(2000) });
    expect(longest.status).toBe(201);
    expect(longest.body.data.body).toHaveLength(2000);
  });

  it("API-COMMENT-06 / BR-22: an author, time or Ticket sent by the client is ignored, not trusted", async () => {
    const ticket = await makeTicket();

    const res = await as(requesterCookie).post(`/api/tickets/${ticket.id}/comments`, {
      body: "The real comment.",
      author: { id: otherId, name: "Somebody Else", role: "IT_STAFF" },
      authorId: otherId,
      createdAt: "1999-01-01T00:00:00.000Z",
      ticketId: NEVER_EXISTED,
      id: 1,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.author.id).toBe(requesterId);
    expect(res.body.data.ticketId).toBe(ticket.id);
    expect(new Date(res.body.data.createdAt).getFullYear()).toBeGreaterThan(1999);

    const stored = await prisma.publicComment.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.authorId).toBe(requesterId);
  });

  it("API-COMMENT-07 / BR-22: a thread reads oldest first, whatever order the rows were written in", async () => {
    const ticket = await makeTicket();
    const at = (time: string) => new Date(`2026-05-01T${time}:00.000Z`);

    // Written latest first; two share a timestamp, and the earlier id wins the tie.
    await prisma.publicComment.create({ data: { ticketId: ticket.id, authorId: staffId, body: "third", createdAt: at("10:00") } });
    await prisma.publicComment.create({ data: { ticketId: ticket.id, authorId: requesterId, body: "first", createdAt: at("09:00") } });
    await prisma.publicComment.create({ data: { ticketId: ticket.id, authorId: staffId, body: "second", createdAt: at("09:00") } });

    const thread = await as(requesterCookie).get(`/api/tickets/${ticket.id}/comments`);

    expect(thread.body.data.map((c: { body: string }) => c.body)).toEqual(["first", "second", "third"]);
  });
});

describe("Internal Notes", () => {
  it("API-NOTE-01 / AC-15, BR-04: staff add an Internal Note and read it back, with a server-made author and time", async () => {
    const ticket = await makeTicket();

    const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/notes`, {
      body: "  Waiting on the vendor before replying.  ",
      authorId: requesterId,
      createdAt: "1999-01-01T00:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data).sort()).toEqual(ENTRY_KEYS);
    expect(res.body.data).toMatchObject({
      ticketId: ticket.id,
      body: "Waiting on the vendor before replying.",
      author: { id: staffId, name: "Thread Staff", role: "IT_STAFF" },
    });
    expect(new Date(res.body.data.createdAt).getFullYear()).toBeGreaterThan(1999);

    const thread = await as(staffCookie).get(`/api/tickets/${ticket.id}/notes`);
    expect(thread.status).toBe(200);
    expect(thread.body.data).toEqual([res.body.data]);

    const absent = await as(staffCookie).get(`/api/tickets/${NEVER_EXISTED}/notes`);
    expect(absent.status).toBe(404);
    expect(absent.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("API-NOTE-02 / AC-04, BR-20: a Requester asking for notes on their own Ticket gets exactly what a missing Ticket gets", async () => {
    const ticket = await makeTicket();
    await prisma.internalNote.create({ data: { ticketId: ticket.id, authorId: adminId, body: SECRET } });

    const own = await as(requesterCookie).get(`/api/tickets/${ticket.id}/notes`);
    const noSuchTicket = await as(requesterCookie).get(`/api/tickets/${NEVER_EXISTED}/notes`);
    const noSuchTicketDetail = await as(requesterCookie).get(`/api/tickets/${NEVER_EXISTED}`);

    expect(own.status).toBe(404);
    // Not 403 — that would confirm the Ticket. Not `data: []` — that would
    // confirm the endpoint. The same bytes as a Ticket that never existed.
    expect(own.body).toEqual(noSuchTicket.body);
    expect(own.body).toEqual(noSuchTicketDetail.body);
    expect(own.body).not.toHaveProperty("data");
    expect(JSON.stringify(own.body)).not.toContain(SECRET);
  });

  it("API-NOTE-03 / AC-04, BR-20: a Requester posting a note gets the same 404, even with a body that would fail validation", async () => {
    const own = await makeTicket();
    const theirs = await makeTicket(otherId);
    const expected = (await as(requesterCookie).get(`/api/tickets/${NEVER_EXISTED}`)).body;

    for (const [label, ticketId, body] of [
      ["own ticket, valid body", own.id, { body: "Can I see this?" }],
      ["own ticket, empty body", own.id, { body: "" }],
      ["another Requester's ticket", theirs.id, { body: "Can I see this?" }],
    ] as const) {
      const res = await as(requesterCookie).post(`/api/tickets/${ticketId}/notes`, body);
      // A 400 for the empty body would tell a Requester there was something to
      // validate — which is to say, that the endpoint exists for them.
      expect(res.status, label).toBe(404);
      expect(res.body, label).toEqual(expected);
    }

    expect(await prisma.internalNote.count({ where: { ticketId: { in: [own.id, theirs.id] } } })).toBe(0);
  });

  it("API-NOTE-04 / AC-15, BR-20: nothing a Requester can read about a Ticket carries a trace of its notes", async () => {
    const ticket = await makeTicket();
    await as(staffCookie).post(`/api/tickets/${ticket.id}/comments`, { body: "A public reply the Requester may read." });
    const beforeNote = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    const note = await as(adminCookie).post(`/api/tickets/${ticket.id}/notes`, { body: `${SECRET}: vendor quoted a price.` });
    expect(note.status).toBe(201);

    // A note does not move Last Updated: the Requester sees that timestamp, and
    // a change with nothing visible behind it would itself be the leak.
    const afterNote = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(afterNote.updatedAt.getTime()).toBe(beforeNote.updatedAt.getTime());

    const responses = {
      "GET /api/tickets/:id": await as(requesterCookie).get(`/api/tickets/${ticket.id}`),
      "GET /api/tickets": await as(requesterCookie).get(`/api/tickets?search=${encodeURIComponent(ticket.summary)}&pageSize=50`),
      "GET comments": await as(requesterCookie).get(`/api/tickets/${ticket.id}/comments`),
      "POST comments": await as(requesterCookie).post(`/api/tickets/${ticket.id}/comments`, { body: "Thanks for the update." }),
      "POST appears-resolved": await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`),
    };

    for (const [name, res] of Object.entries(responses)) {
      expect(res.status, name).toBeLessThan(300);
      const text = JSON.stringify(res.body);
      expect(text, `${name}: note body`).not.toContain(SECRET);
      expect(text, `${name}: note author`).not.toContain(NOTE_AUTHOR);
      expect(text, `${name}: a notes field or count`).not.toMatch(/note/i);
    }
    // The list really did contain the Ticket, so its silence means something.
    expect(responses["GET /api/tickets"].body.data.map((t: { id: number }) => t.id)).toEqual([ticket.id]);
  });

  it("API-NOTE-05 / BR-23: note bodies have the comment bounds and the same field", async () => {
    const ticket = await makeTicket();

    for (const body of [{ body: "" }, { body: "  " }, { body: "x".repeat(2001) }, {}, { body: 7 }]) {
      const res = await as(staffCookie).post(`/api/tickets/${ticket.id}/notes`, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "body" });
    }

    expect((await as(staffCookie).post(`/api/tickets/${ticket.id}/notes`, { body: "x" })).status).toBe(201);
    expect((await as(staffCookie).post(`/api/tickets/${ticket.id}/notes`, { body: "y".repeat(2000) })).status).toBe(201);
  });

  it("API-NOTE-06 / BR-04: an Administrator reads and writes notes, including a staff member's", async () => {
    const ticket = await makeTicket();
    const byStaff = await as(staffCookie).post(`/api/tickets/${ticket.id}/notes`, { body: "Checked the logs." });

    const byAdmin = await as(adminCookie).post(`/api/tickets/${ticket.id}/notes`, { body: "Approved the replacement." });
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.body.data.author).toEqual({ id: adminId, name: NOTE_AUTHOR, role: "ADMINISTRATOR" });

    const thread = await as(adminCookie).get(`/api/tickets/${ticket.id}/notes`);
    expect(thread.status).toBe(200);
    expect(thread.body.data).toEqual([byStaff.body.data, byAdmin.body.data]);
  });

  it("API-NOTE-07 / BR-21: comments and notes are append-only — no edit or delete route exists", async () => {
    const ticket = await makeTicket();
    const comment = await as(staffCookie).post(`/api/tickets/${ticket.id}/comments`, { body: "Original comment." });
    const note = await as(staffCookie).post(`/api/tickets/${ticket.id}/notes`, { body: "Original note." });

    const paths = [
      `/api/tickets/${ticket.id}/comments/${comment.body.data.id}`,
      `/api/tickets/${ticket.id}/notes/${note.body.data.id}`,
      `/api/tickets/${ticket.id}/comments`,
      `/api/tickets/${ticket.id}/notes`,
    ];
    for (const url of paths) {
      for (const method of ["patch", "put", "delete"] as const) {
        const res = await request(app)[method](url).set("Cookie", staffCookie).send({ body: "Rewritten." });
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
        expect(res.body.error.code, `${method.toUpperCase()} ${url}`).toBe("NOT_FOUND");
      }
    }

    const storedComment = await prisma.publicComment.findUniqueOrThrow({ where: { id: comment.body.data.id } });
    const storedNote = await prisma.internalNote.findUniqueOrThrow({ where: { id: note.body.data.id } });
    expect(storedComment.body).toBe("Original comment.");
    expect(storedNote.body).toBe("Original note.");
  });
});
