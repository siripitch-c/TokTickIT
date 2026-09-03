import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { TICKET_NUMBER_PATTERN } from "../../src/ticketNumber.js";

// tests.md API-CREATE-01..10; specification.md BR-01..03, BR-10, BR-19..24;
// api-spec.md §4 (POST /api/tickets).
// Requires a migrated + seeded test database (see README §Testing).

const prisma = getPrisma();

let requesterId = 0;
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

const post = (body: unknown, id: number | null = requesterId) => {
  const req = request(app).post("/api/tickets");
  if (id !== null) req.set("X-Requester-Id", String(id));
  return req.send(body as object);
};

beforeAll(async () => {
  // Dedicated throwaway Requesters so these tests never pollute the ticket
  // lists of the seeded demo identities.
  const owner = await prisma.requester.upsert({
    where: { email: "create-ticket.owner@test.invalid" },
    update: { isActive: true },
    create: { name: "Create Ticket Owner", email: "create-ticket.owner@test.invalid" },
  });
  const other = await prisma.requester.upsert({
    where: { email: "create-ticket.other@test.invalid" },
    update: { isActive: true },
    create: { name: "Create Ticket Other", email: "create-ticket.other@test.invalid" },
  });
  requesterId = owner.id;
  otherRequesterId = other.id;

  await prisma.requester.upsert({
    where: { email: "create-ticket.inactive@test.invalid" },
    update: { isActive: false },
    create: {
      name: "Create Ticket Inactive",
      email: "create-ticket.inactive@test.invalid",
      isActive: false,
    },
  });

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
  const inactive = await prisma.requester.findUnique({
    where: { email: "create-ticket.inactive@test.invalid" },
  });
  const ids = [requesterId, otherRequesterId, ...(inactive ? [inactive.id] : [])];
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  await prisma.requester.deleteMany({ where: { id: { in: ids } } });
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

  it("API-CREATE-02: a new Ticket defaults to currentStatus NEW with itPriority unset (BR-02)", async () => {
    const response = await post(validBody());

    expect(response.status).toBe(201);
    expect(response.body.data.currentStatus).toBe("NEW");
    expect(response.body.data.itPriority).toBeNull();
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
    expect(ticket.itPriority).toBeNull();
    expect(new Date(ticket.createdAt).getFullYear()).toBeGreaterThan(1999);
  });

  it("API-CREATE-04: no endpoint accepts a requesterId change after creation (BR-10)", async () => {
    const created = await post(validBody());
    const id = created.body.data.id;

    for (const method of ["put", "patch"] as const) {
      const response = await request(app)
        [method](`/api/tickets/${id}`)
        .set("X-Requester-Id", String(requesterId))
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

  it("API-CREATE-11: an X-Requester-Id that names nobody is rejected, not answered with a 500", async () => {
    const before = await prisma.ticket.count();

    const response = await post(validBody(), 999999);

    // A client sending an id that does not exist is bad input, not an
    // unexpected server fault — api-spec.md reserves 500 for the latter.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("API-CREATE-12: an inactive Requester cannot create a Ticket (BR-05, BR-35, BR-11)", async () => {
    const inactive = await prisma.requester.findUniqueOrThrow({
      where: { email: "create-ticket.inactive@test.invalid" },
    });
    const before = await prisma.ticket.count();

    const response = await post(validBody(), inactive.id);

    // The selector can never offer this identity, and BR-11 does not allow
    // that to be the only place the rule is enforced.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("rejects a missing or unusable X-Requester-Id header with 400 (api-spec.md §1)", async () => {
    expect((await post(validBody(), null)).status).toBe(400);

    const notANumber = await request(app)
      .post("/api/tickets")
      .set("X-Requester-Id", "abc")
      .send(validBody());
    expect(notANumber.status).toBe(400);
    expect(notANumber.body.error.code).toBe("VALIDATION_ERROR");
  });
});
