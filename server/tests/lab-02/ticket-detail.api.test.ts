import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-DETAIL-01..04; specification.md FR-09, BR-11, BR-12, BR-29, BR-38;
// api-spec.md §4 (GET /api/tickets/:id).
// Requires a migrated + seeded test database (see README §Testing).
//
// Lab 3, Issue #30 — this suite is also part of the evidence for
// `docs/lab-03/tests.md` MIG-08: every Lab 2 Requester endpoint still behaves
// as `docs/lab-02/api-spec.md` describes once identity comes from the session,
// the one deliberate change being that a missing identity is now 401 rather
// than 400 (BR-44, AC-08).

const prisma = getPrisma();

let ownerId = 0;
let otherId = 0;
let ownerCookie = "";
let otherCookie = "";
let ticketId = 0;
let foreignTicketId = 0;
let activeAttachmentId = 0;
let removedAttachmentId = 0;

// Lab 3, Issue #30: identity is a session cookie (api-spec.md §1).
const get = (id: number | string, cookie: string | null = ownerCookie) => {
  const req = request(app).get(`/api/tickets/${id}`);
  if (cookie !== null) req.set("Cookie", cookie);
  return req;
};

beforeAll(async () => {
  const owner = await upsertTestUser({ email: "detail.owner@test.invalid", name: "Detail Owner" });
  const other = await upsertTestUser({ email: "detail.other@test.invalid", name: "Detail Other" });
  ownerId = owner.id;
  otherId = other.id;
  ownerCookie = await signIn(owner.email);
  otherCookie = await signIn(other.email);

  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const system = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });

  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: [ownerId, otherId] } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: [ownerId, otherId] } } });

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber: "TKT-2095-000001",
      requesterId: ownerId,
      categoryId: category.id,
      relatedSystemId: system.id,
      summary: "Detail fixture ticket",
      description: "A ticket used by the Ticket Detail endpoint tests.",
      requestedPriority: "MEDIUM",
    },
  });
  ticketId = ticket.id;

  const foreign = await prisma.ticket.create({
    data: {
      ticketNumber: "TKT-2095-000002",
      requesterId: otherId,
      categoryId: category.id,
      relatedSystemId: system.id,
      summary: "Another Requester's ticket",
      description: "Owned by somebody else entirely.",
      requestedPriority: "LOW",
    },
  });
  foreignTicketId = foreign.id;

  const active = await prisma.attachment.create({
    data: {
      ticketId,
      originalFilename: "still-here.png",
      storedFilename: "detail-active.png",
      mimeType: "image/png",
      sizeBytes: 128,
    },
  });
  activeAttachmentId = active.id;

  const removed = await prisma.attachment.create({
    data: {
      ticketId,
      originalFilename: "taken-down.pdf",
      storedFilename: "detail-removed.pdf",
      mimeType: "application/pdf",
      sizeBytes: 256,
      removedAt: new Date("2026-05-01T00:00:00.000Z"),
      removedReason: "Uploaded the wrong document",
    },
  });
  removedAttachmentId = removed.id;
});

afterAll(async () => {
  const ids = [ownerId, otherId];
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("GET /api/tickets/:id", () => {
  it("API-DETAIL-01: the owner gets the full ticket with its attachments, removed ones included (BR-29)", async () => {
    const response = await get(ticketId);

    expect(response.status).toBe(200);
    const ticket = response.body.data;
    expect(ticket.id).toBe(ticketId);
    expect(ticket.ticketNumber).toBe("TKT-2095-000001");
    expect(ticket.summary).toBe("Detail fixture ticket");
    expect(ticket.requesterId).toBe(ownerId);
    expect(ticket.currentStatus).toBe("NEW");
    expect(ticket.itPriority).toBeNull();

    // BR-29: a soft-removed attachment keeps its metadata on the ticket; it is
    // the file that becomes unavailable, not the record of it.
    expect(ticket.attachments).toHaveLength(2);
    const byId = Object.fromEntries(
      (ticket.attachments as { id: number }[]).map((a) => [a.id, a]),
    ) as Record<number, Record<string, unknown>>;

    expect(byId[activeAttachmentId].removedAt).toBeNull();
    expect(byId[removedAttachmentId].removedAt).not.toBeNull();
    expect(byId[removedAttachmentId].removedReason).toBe("Uploaded the wrong document");

    // BR-32: the name on disk is internal and never leaves the server.
    for (const attachment of ticket.attachments as Record<string, unknown>[]) {
      expect(Object.keys(attachment).sort()).toEqual([
        "id",
        "mimeType",
        "originalFilename",
        "removedAt",
        "removedReason",
        "sizeBytes",
        "ticketId",
        "uploadedAt",
      ]);
    }
  });

  it("API-DETAIL-02 and API-DETAIL-03: another Requester's ticket and a nonexistent one answer identically (BR-12, AC-03)", async () => {
    const foreign = await get(foreignTicketId);
    const missing = await get(999999);

    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("TICKET_NOT_FOUND");

    // Byte-for-byte the same answer: nothing in the response tells the caller
    // whether the ticket exists and belongs to someone else, or never existed.
    expect(missing.status).toBe(foreign.status);
    expect(missing.body).toEqual(foreign.body);

    // And no fragment of the real ticket leaks into the refusal.
    expect(JSON.stringify(foreign.body)).not.toContain("Another Requester");
    expect(JSON.stringify(foreign.body)).not.toContain("TKT-2095-000002");
  });

  it("API-DETAIL-02: the owner of that ticket can still read it — the rule is ownership, not hiding", async () => {
    const response = await get(foreignTicketId, otherCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.ticketNumber).toBe("TKT-2095-000002");
  });

  it("API-DETAIL-04 / MIG-07, AC-25: no session is 401, and the Lab 2 header opens nothing", async () => {
    // Rewritten for Lab 3: the header this case was built around is no longer
    // read, so the failures it described cannot occur. What replaces them is
    // the one refusal that matters — an unresolvable identity gets 401, and a
    // header on its own gets a caller nowhere.
    const noSession = await get(ticketId, null);
    expect(noSession.status).toBe(401);
    expect(noSession.body.error.code).toBe("UNAUTHENTICATED");

    for (const cookie of ["tt_session=deadbeef", "tt_session="]) {
      const response = await request(app).get(`/api/tickets/${ticketId}`).set("Cookie", cookie);
      expect(response.status, cookie).toBe(401);
    }

    const headerOnly = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set("X-Requester-Id", String(ownerId));
    expect(headerOnly.status).toBe(401);

    // With a valid session, a header naming someone else changes nothing
    // about whose ticket is returned (BR-03, AC-03).
    const spoofed = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set("Cookie", ownerCookie)
      .set("X-Requester-Id", String(otherId));
    expect(spoofed.status).toBe(200);
    expect(spoofed.body.data.requesterId).toBe(ownerId);
  });

  it("an unusable ticket id in the path is a 404, never a 500", async () => {
    for (const badId of ["abc", "-1", "0", "99999999999999999999", "2147483648"]) {
      const response = await get(badId);
      expect(response.status, `ticket id ${badId}`).toBe(404);
      expect(response.body.error.code).toBe("TICKET_NOT_FOUND");
    }
  });
});
