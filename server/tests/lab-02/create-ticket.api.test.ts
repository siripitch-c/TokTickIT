import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";
import { TICKET_NUMBER_PATTERN } from "../../src/ticketNumber.js";

// tests.md API-CREATE-01..10; specification.md BR-01..03, BR-10, BR-19..24;
// api-spec.md §4 (POST /api/tickets).
// Requires a migrated + seeded test database (see README §Testing).
//
// Lab 3, Issue #30 — this suite is also part of the evidence for
// `docs/lab-03/tests.md` MIG-08: every Lab 2 Requester endpoint still behaves
// as `docs/lab-02/api-spec.md` describes once identity comes from the session,
// the one deliberate change being that a missing identity is now 401 rather
// than 400 (BR-44, AC-08).

const prisma = getPrisma();

let requesterId = 0;
let ownerCookie = "";
let otherRequesterId = 0;
let categoryId = 0;
let relatedSystemId = 0;

const validBody = () => ({
  categoryId,
  relatedSystemId,
  summary: "VPN drops every few minutes",
  description: "The VPN client disconnects roughly every five minutes on campus Wi-Fi.",
  requestedPriority: "MEDIUM",
});

// Lab 3, Issue #30: identity is a session cookie (api-spec.md §1).
const post = (body: unknown, cookie: string | null = ownerCookie) => {
  const req = request(app).post("/api/tickets");
  if (cookie !== null) req.set("Cookie", cookie);
  return req.send(body as object);
};

beforeAll(async () => {
  // Dedicated throwaway Requesters so these tests never pollute the ticket
  // lists of the seeded demo identities.
  const owner = await upsertTestUser({ email: "create-ticket.owner@test.invalid", name: "Create Ticket Owner" });
  const other = await upsertTestUser({ email: "create-ticket.other@test.invalid", name: "Create Ticket Other" });
  requesterId = owner.id;
  otherRequesterId = other.id;
  ownerCookie = await signIn(owner.email);

  await upsertTestUser({ email: "create-ticket.inactive@test.invalid", name: "Create Ticket Inactive", isActive: false });

  const category = await prisma.category.findFirst({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirst({ where: { isActive: true } });
  if (!category || !relatedSystem) throw new Error("Seed data missing — run npm run prisma:seed");
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const inactive = await prisma.user.findUnique({
    where: { email: "create-ticket.inactive@test.invalid" },
  });
  const ids = [requesterId, otherRequesterId, ...(inactive ? [inactive.id] : [])];
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("POST /api/tickets", () => {
  it("API-CREATE-01: a valid body creates one persisted Ticket with a unique number", async () => {
    const response = await post(validBody());

    expect(response.status).toBe(201);
    const ticket = response.body.data;
    expect(ticket.ticketNumber).toMatch(TICKET_NUMBER_PATTERN);
    expect(ticket.summary).toBe("VPN drops every few minutes");
    expect(ticket.attachments).toEqual([]);

    const saved = await prisma.ticket.findUnique({ where: { id: ticket.id } });
    expect(saved).not.toBeNull();
    expect(saved!.ticketNumber).toBe(ticket.ticketNumber);
    expect(saved!.requesterId).toBe(requesterId);
  });

  it("API-CREATE-02: a new Ticket defaults to currentStatus NEW, with IT Priority starting as the Requested Priority (BR-02, Lab 3 BR-29)", async () => {
    const response = await post(validBody());

    expect(response.status).toBe(201);
    expect(response.body.data.currentStatus).toBe("NEW");
    // Lab 3, Issue #32 — deliberately updated, per the Definition of Done's
    // allowance for Lab 2 tests that change with a recorded reason. Lab 2 left
    // IT Priority unset; lab-03 specification.md BR-29 initialises it from the
    // Requested Priority, so a new Ticket reaches the staff queue already
    // sortable by it. The Requester still cannot choose it (API-CREATE-03).
    expect(response.body.data.itPriority).toBe(validBody().requestedPriority);
    // Lab 3 BR-27: and it starts unassigned.
    expect(response.body.data.ownerId).toBeNull();
    expect(response.body.data.owner).toBeNull();
  });

  it("API-CREATE-03: client-supplied system fields are ignored, not trusted (BR-03, BR-10)", async () => {
    const response = await post({
      ...validBody(),
      requesterId: otherRequesterId,
      ticketNumber: "TKT-1999-000001",
      currentStatus: "NEW",
      itPriority: "HIGH",
      createdAt: "1999-01-01T00:00:00.000Z",
      updatedAt: "1999-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(201);
    const ticket = response.body.data;
    // Ownership comes from the header (BR-10), never from the body.
    expect(ticket.requesterId).toBe(requesterId);
    expect(ticket.ticketNumber).not.toBe("TKT-1999-000001");
    // Lab 3, Issue #32: IT Priority now starts as the Requested Priority
    // (BR-29), and the body's "HIGH" is still ignored rather than trusted.
    expect(ticket.itPriority).toBe("MEDIUM");
    expect(new Date(ticket.createdAt).getFullYear()).toBeGreaterThan(1999);
  });

  it("API-CREATE-04: no endpoint accepts a requesterId change after creation (BR-10)", async () => {
    const created = await post(validBody());
    const id = created.body.data.id;

    for (const method of ["put", "patch"] as const) {
      const response = await request(app)
        [method](`/api/tickets/${id}`)
        .set("Cookie", ownerCookie)
        .send({ requesterId: otherRequesterId });
      expect(response.status).toBe(404);
    }

    const saved = await prisma.ticket.findUnique({ where: { id } });
    expect(saved!.requesterId).toBe(requesterId);
  });

  it("API-CREATE-05: Summary boundaries 4/5/150/151 and whitespace-only (BR-19)", async () => {
    const tooShort = await post({ ...validBody(), summary: "a".repeat(4) });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.code).toBe("VALIDATION_ERROR");
    expect(tooShort.body.error.field).toBe("summary");

    expect((await post({ ...validBody(), summary: "a".repeat(5) })).status).toBe(201);
    expect((await post({ ...validBody(), summary: "a".repeat(150) })).status).toBe(201);
    expect((await post({ ...validBody(), summary: "a".repeat(151) })).status).toBe(400);

    // Trimming happens before the length check, so padded values are measured
    // on their real content (BR-19).
    const padded = await post({ ...validBody(), summary: `   ${"a".repeat(150)}   ` });
    expect(padded.status).toBe(201);
    expect(padded.body.data.summary).toBe("a".repeat(150));

    const whitespaceOnly = await post({ ...validBody(), summary: "        " });
    expect(whitespaceOnly.status).toBe(400);
    expect(whitespaceOnly.body.error.field).toBe("summary");

    const missing = await post({ ...validBody(), summary: undefined });
    expect(missing.status).toBe(400);
    expect(missing.body.error.field).toBe("summary");
  });

  it("API-CREATE-06: Description boundaries 9/10/2000/2001 (BR-20)", async () => {
    const tooShort = await post({ ...validBody(), description: "a".repeat(9) });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.field).toBe("description");

    expect((await post({ ...validBody(), description: "a".repeat(10) })).status).toBe(201);
    expect((await post({ ...validBody(), description: "a".repeat(2000) })).status).toBe(201);

    const tooLong = await post({ ...validBody(), description: "a".repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.field).toBe("description");
  });

  it("API-CREATE-07: each invalid reference/enum field fails independently (BR-21)", async () => {
    const missingCategory = await post({ ...validBody(), categoryId: undefined });
    expect(missingCategory.status).toBe(400);
    expect(missingCategory.body.error.code).toBe("INVALID_CATEGORY");

    const unknownCategory = await post({ ...validBody(), categoryId: 999999 });
    expect(unknownCategory.status).toBe(400);
    expect(unknownCategory.body.error.code).toBe("INVALID_CATEGORY");

    const missingSystem = await post({ ...validBody(), relatedSystemId: undefined });
    expect(missingSystem.status).toBe(400);
    expect(missingSystem.body.error.code).toBe("INVALID_RELATED_SYSTEM");

    const unknownSystem = await post({ ...validBody(), relatedSystemId: 999999 });
    expect(unknownSystem.status).toBe(400);
    expect(unknownSystem.body.error.code).toBe("INVALID_RELATED_SYSTEM");

    for (const value of [undefined, "URGENT", "low"]) {
      const response = await post({ ...validBody(), requestedPriority: value });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.field).toBe("requestedPriority");
    }

    // An inactive Category must be rejected the same way an unknown one is.
    const category = await prisma.category.create({
      data: { name: `Retired category ${Date.now()}`, isActive: false },
    });
    try {
      const response = await post({ ...validBody(), categoryId: category.id });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_CATEGORY");
    } finally {
      await prisma.category.delete({ where: { id: category.id } });
    }
  });

  it("API-CREATE-08: 20 concurrent creations all get distinct Ticket Numbers (BR-01)", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => post(validBody())),
    );

    for (const response of responses) expect(response.status).toBe(201);
    const numbers = responses.map((r) => r.body.data.ticketNumber as string);
    expect(new Set(numbers).size).toBe(20);
    for (const number of numbers) expect(number).toMatch(TICKET_NUMBER_PATTERN);
  });

  it("API-CREATE-09: identical rapid submissions are NOT deduped server-side (BR-22 is a UI control)", async () => {
    const body = validBody();
    const [first, second] = await Promise.all([post(body), post(body)]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Documents the accepted scope boundary in tests.md §8: Lab 2 has no
    // server-side idempotency key. Duplicate-click prevention lives in the UI
    // (UI-CREATE-07); what the server guarantees here is only that the two
    // tickets are separate rows with separate numbers.
    expect(first.body.data.id).not.toBe(second.body.data.id);
    expect(first.body.data.ticketNumber).not.toBe(second.body.data.ticketNumber);
  });

  it("API-CREATE-10: a database failure returns a safe 500 and persists no partial Ticket (BR-24)", async () => {
    const before = await prisma.ticket.count({ where: { requesterId } });
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("simulated database failure"));

    const response = await post({ ...validBody(), summary: "Simulated failure ticket" });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("simulated database failure");

    expect(await prisma.ticket.count({ where: { requesterId } })).toBe(before);
    expect(await prisma.ticket.findFirst({ where: { summary: "Simulated failure ticket" } })).toBeNull();
  });

  it("API-CREATE-11 / MIG-07: an unusable identity is refused, never answered with a 500", async () => {
    // Rewritten for Lab 3. The Lab 2 version sent an `X-Requester-Id` naming
    // nobody and expected 400; a client can no longer name anybody at all, so
    // the equivalent failure is a session that does not resolve. What carries
    // over is the point: bad identity is handled, and is never a server fault.
    const before = await prisma.ticket.count();

    for (const cookie of ["tt_session=deadbeef", "tt_session=", "tt_session=999999"]) {
      const response = await request(app).post("/api/tickets").set("Cookie", cookie).send(validBody());
      expect(response.status, cookie).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }

    expect(await prisma.ticket.count()).toBe(before);
  });

  it("API-CREATE-12 / BR-01, BR-12: a deactivated Requester cannot create a Ticket, even holding a session", async () => {
    // Stronger than the Lab 2 version, which only proved an inactive id was
    // refused. Here the account signs in while active, is then deactivated,
    // and the session it already holds stops working on the next request.
    const victim = await upsertTestUser({
      email: "create-ticket.deactivated@test.invalid",
      name: "Create Ticket Deactivated",
    });
    const cookie = await signIn(victim.email);
    const before = await prisma.ticket.count();

    expect((await post(validBody(), cookie)).status).toBe(201);

    await prisma.user.update({ where: { id: victim.id }, data: { isActive: false } });

    const afterDeactivation = await post(validBody(), cookie);
    expect(afterDeactivation.status).toBe(401);
    expect(await prisma.ticket.count()).toBe(before + 1);

    // An inactive account cannot sign in again either (BR-01).
    await expect(signIn(victim.email)).rejects.toThrow();

    await prisma.ticket.deleteMany({ where: { requesterId: victim.id } });
    await prisma.user.delete({ where: { id: victim.id } });
  });

  it("API-CREATE-13: ids outside the 32-bit Int range are bad input, not a 500", async () => {
    const before = await prisma.ticket.count();
    // Number.isInteger(1e21) is true, so a naive check lets these through to
    // Prisma, which raises on an Int column rather than returning "no row".
    const outOfRange = [1e21, Number.MAX_SAFE_INTEGER, 2_147_483_648];

    for (const value of outOfRange) {
      const category = await post({ ...validBody(), categoryId: value });
      expect(category.status, `categoryId ${value}`).toBe(400);
      expect(category.body.error.code).toBe("INVALID_CATEGORY");

      const system = await post({ ...validBody(), relatedSystemId: value });
      expect(system.status, `relatedSystemId ${value}`).toBe(400);
      expect(system.body.error.code).toBe("INVALID_RELATED_SYSTEM");

    }

    // The largest id the column can actually hold is still parsed, and simply
    // finds nothing.
    const atLimit = await post({ ...validBody(), categoryId: 2_147_483_647 });
    expect(atLimit.status).toBe(400);
    expect(atLimit.body.error.code).toBe("INVALID_CATEGORY");

    expect(await prisma.ticket.count()).toBe(before);
  });

  it("MIG-07 / AC-25: no session is 401, and the Lab 2 header opens nothing", async () => {
    const noSession = await post(validBody(), null);
    expect(noSession.status).toBe(401);
    expect(noSession.body.error.code).toBe("UNAUTHENTICATED");

    const headerOnly = await request(app)
      .post("/api/tickets")
      .set("X-Requester-Id", String(requesterId))
      .send(validBody());
    expect(headerOnly.status).toBe(401);
  });
});
