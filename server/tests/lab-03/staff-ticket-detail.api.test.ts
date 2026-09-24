import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CurrentStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { CURRENT_STATUSES, canTransition } from "../../src/statusTransitions.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-TICKET-01..19; specification.md FR-12, FR-14, FR-15, FR-17,
// FR-18, FR-21, BR-05, BR-16, BR-17, BR-25..BR-34, AC-10..AC-13, AC-16, AC-26;
// api-spec.md §6 and §7.
//
// The status tables drive `canTransition` over every pair rather than restating
// the matrix a second time. That is safe only because UNIT-03 checks the helper
// against a transcription of specification.md BR-31 — this suite proves the
// endpoint obeys the helper, and UNIT-03 proves the helper obeys the spec.

const prisma = getPrisma();

const REQUESTER = "ops.requester@test.invalid";
const OTHER = "ops.other@test.invalid";
const STAFF_A = "ops.staff.a@test.invalid";
const STAFF_B = "ops.staff.b@test.invalid";
const ADMIN = "ops.admin@test.invalid";
const GONE = "ops.staff.gone@test.invalid";
const LEAVING = "ops.staff.leaving@test.invalid";
const EMAILS = [REQUESTER, OTHER, STAFF_A, STAFF_B, ADMIN, GONE, LEAVING];

const NUMBER_PREFIX = "TKT-2092-";
const NEVER_EXISTED = 2_147_483_600;
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

let requesterId = 0;
let otherId = 0;
let staffAId = 0;
let staffBId = 0;
let adminId = 0;
let goneId = 0;
let leavingId = 0;

let requesterCookie = "";
let otherCookie = "";
let staffACookie = "";
let staffBCookie = "";
let adminCookie = "";

let categoryId = 0;
let relatedSystemId = 0;
let uploadDir = "";
let sequence = 0;

/** A fresh Ticket for one case, so no case depends on what another left behind. */
async function makeTicket(
  overrides: Partial<{
    requesterId: number;
    currentStatus: CurrentStatus;
    ownerId: number | null;
    requestedPriority: "LOW" | "MEDIUM" | "HIGH";
    itPriority: "LOW" | "MEDIUM" | "HIGH";
    requesterResolvedAt: Date | null;
  }> = {},
) {
  sequence += 1;
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(sequence).padStart(6, "0")}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: `Operations fixture ${sequence}`,
      description: "A Ticket for the IT Staff operations suite.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      updatedAt: LONG_AGO,
      ...overrides,
    },
  });
}

const as = (cookie: string) => ({
  get: (url: string) => request(app).get(url).set("Cookie", cookie),
  patch: (url: string, body: object) => request(app).patch(url).set("Cookie", cookie).send(body),
  post: (url: string) => request(app).post(url).set("Cookie", cookie),
});

/**
 * Collects a download's bytes, whatever its content type. Supertest types the
 * parser's first argument as its own Response, but at run time it is the Node
 * response stream, which is what is read here.
 */
function binary(res: SupertestResponse, done: (error: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => done(null, Buffer.concat(chunks)));
}

beforeAll(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "toktickit-ops-uploads-"));
  process.env.UPLOAD_DIR = uploadDir;

  requesterId = (await upsertTestUser({ email: REQUESTER, name: "Ops Requester" })).id;
  otherId = (await upsertTestUser({ email: OTHER, name: "Ops Other Requester" })).id;
  staffAId = (await upsertTestUser({ email: STAFF_A, name: "Ops Staff A", role: "IT_STAFF" })).id;
  staffBId = (await upsertTestUser({ email: STAFF_B, name: "Ops Staff B", role: "IT_STAFF" })).id;
  adminId = (await upsertTestUser({ email: ADMIN, name: "Ops Admin", role: "ADMINISTRATOR" })).id;
  goneId = (await upsertTestUser({ email: GONE, name: "Ops Staff Gone", role: "IT_STAFF", isActive: false })).id;
  leavingId = (await upsertTestUser({ email: LEAVING, name: "Ops Staff Leaving", role: "IT_STAFF" })).id;

  requesterCookie = await signIn(REQUESTER);
  otherCookie = await signIn(OTHER);
  staffACookie = await signIn(STAFF_A);
  staffBCookie = await signIn(STAFF_B);
  adminCookie = await signIn(ADMIN);

  categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;

  await removeFixtureTickets();
});

async function removeFixtureTickets() {
  const tickets = { OR: [{ ticketNumber: { startsWith: NUMBER_PREFIX } }, { requesterId: { in: [requesterId, otherId] } }] };
  await prisma.publicComment.deleteMany({ where: { ticket: tickets } });
  await prisma.internalNote.deleteMany({ where: { ticket: tickets } });
  await prisma.attachment.deleteMany({ where: { ticket: tickets } });
  await prisma.ticket.deleteMany({ where: tickets });
}

afterAll(async () => {
  await removeFixtureTickets();
  // Sessions follow their users through the schema's cascade.
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  delete process.env.UPLOAD_DIR;
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe("Reading any Ticket", () => {
  it("API-TICKET-01 / BR-17: IT Staff and an Administrator read another Requester's Ticket, in the one Ticket shape", async () => {
    const ticket = await makeTicket();

    for (const cookie of [staffACookie, adminCookie]) {
      const res = await as(cookie).get(`/api/tickets/${ticket.id}`);

      expect(res.status).toBe(200);
      // api-spec.md §5, exhaustively: one object for every role.
      expect(Object.keys(res.body.data).sort()).toEqual([
        "attachments",
        "categoryId",
        "createdAt",
        "currentStatus",
        "description",
        "id",
        "itPriority",
        "owner",
        "ownerId",
        "relatedSystemId",
        "requestedPriority",
        "requester",
        "requesterId",
        "requesterResolvedAt",
        "summary",
        "ticketNumber",
        "updatedAt",
      ]);
      expect(res.body.data.requester).toEqual({ id: requesterId, name: "Ops Requester", role: "REQUESTER" });
      expect(res.body.data.owner).toBeNull();
    }

    // Widening it for staff narrowed nothing for Requesters (BR-16).
    const foreign = await as(otherCookie).get(`/api/tickets/${ticket.id}`);
    expect(foreign.status).toBe(404);
  });
});

describe("PATCH /api/tickets/:id/owner", () => {
  it("API-TICKET-02 / AC-10: claiming an unassigned Ticket makes the caller its owner, and another staff member sees it", async () => {
    const ticket = await makeTicket();

    const claimed = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: staffAId });
    expect(claimed.status).toBe(200);
    expect(claimed.body.data.ownerId).toBe(staffAId);
    expect(claimed.body.data.owner).toEqual({ id: staffAId, name: "Ops Staff A", role: "IT_STAFF" });

    const seen = await as(staffBCookie).get(`/api/tickets/${ticket.id}`);
    expect(seen.body.data.owner).toEqual({ id: staffAId, name: "Ops Staff A", role: "IT_STAFF" });
  });

  it("API-TICKET-03 / AC-11: an assigned Ticket moves to another active IT Staff member, or to an Administrator", async () => {
    const ticket = await makeTicket({ ownerId: staffAId });

    const toStaff = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: staffBId });
    expect(toStaff.status).toBe(200);
    expect(toStaff.body.data.owner.id).toBe(staffBId);

    // specification.md §5: a Ticket Owner may be an Administrator.
    const toAdmin = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: adminId });
    expect(toAdmin.status).toBe(200);
    expect(toAdmin.body.data.owner).toEqual({ id: adminId, name: "Ops Admin", role: "ADMINISTRATOR" });
  });

  it("API-TICKET-04 / AC-11, BR-25: an inactive user, a Requester or an unknown id is refused alike, and the owner is unchanged", async () => {
    const ticket = await makeTicket({ ownerId: staffAId });

    const refusals = [];
    for (const ownerId of [goneId, requesterId, NEVER_EXISTED]) {
      const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId });
      expect(res.status, `ownerId ${ownerId}`).toBe(400);
      expect(res.body.error).toMatchObject({ code: "INVALID_OWNER", field: "ownerId" });
      refusals.push(res.body);
    }
    // The same words each time: the caller learns nothing about which accounts
    // exist, are inactive, or are Requesters (api-spec.md §7).
    expect(refusals[1]).toEqual(refusals[0]);
    expect(refusals[2]).toEqual(refusals[0]);

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBe(staffAId);
  });

  it("API-TICKET-04 / BR-42: an owner that is not a number or null is a validation error", async () => {
    const ticket = await makeTicket({ ownerId: staffAId });

    for (const body of [{}, { ownerId: String(staffBId) }, { ownerId: 1.5 }, { ownerId: -3 }, { ownerId: true }]) {
      const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "ownerId" });
    }

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBe(staffAId);
  });

  it("API-TICKET-05 / BR-28: `ownerId: null` returns the Ticket to unassigned", async () => {
    const ticket = await makeTicket({ ownerId: staffAId });

    const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.ownerId).toBeNull();
    expect(res.body.data.owner).toBeNull();
  });

  it("API-TICKET-06 / BR-28: a staff member who is not the owner may still reassign", async () => {
    const ticket = await makeTicket({ ownerId: staffAId });

    // A service desk has to keep moving when the owner is away (§11).
    const res = await as(staffBCookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: adminId });

    expect(res.status).toBe(200);
    expect(res.body.data.owner.id).toBe(adminId);
  });

  it("API-TICKET-04: an unknown Ticket is 404, whatever the owner", async () => {
    const res = await as(staffACookie).patch(`/api/tickets/${NEVER_EXISTED}/owner`, { ownerId: staffAId });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });
});

describe("PATCH /api/tickets/:id/it-priority", () => {
  it("API-TICKET-07 / AC-12, BR-29: IT Priority changes and Requested Priority does not", async () => {
    const ticket = await makeTicket({ requestedPriority: "LOW", itPriority: "LOW" });

    const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/it-priority`, { itPriority: "HIGH" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ itPriority: "HIGH", requestedPriority: "LOW" });
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect({ itPriority: stored.itPriority, requestedPriority: stored.requestedPriority }).toEqual({
      itPriority: "HIGH",
      requestedPriority: "LOW",
    });
  });

  it("API-TICKET-08 / BR-42: a null, lower-case, unknown or missing IT Priority is refused on that field", async () => {
    const ticket = await makeTicket({ itPriority: "MEDIUM" });

    for (const body of [{ itPriority: null }, { itPriority: "URGENT" }, { itPriority: "high" }, { itPriority: 3 }, {}]) {
      const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/it-priority`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "itPriority" });
    }

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.itPriority).toBe("MEDIUM");
  });
});

describe("PATCH /api/tickets/:id/status", () => {
  it("API-TICKET-09 / BR-31: every permitted transition succeeds, persists, and moves Last Updated", async () => {
    let permitted = 0;
    for (const from of CURRENT_STATUSES) {
      for (const to of CURRENT_STATUSES) {
        if (!canTransition(from, to)) continue;
        const ticket = await makeTicket({ currentStatus: from });

        const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/status`, { currentStatus: to });

        expect(res.status, `${from} -> ${to}`).toBe(200);
        expect(res.body.data.currentStatus, `${from} -> ${to}`).toBe(to);
        const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect(stored.currentStatus, `${from} -> ${to}`).toBe(to);
        // A status change is activity: it must move the queue's default order.
        expect(stored.updatedAt.getTime(), `${from} -> ${to}`).toBeGreaterThan(LONG_AGO.getTime());
        permitted += 1;
      }
    }
    expect(permitted).toBe(20);
  });

  it("API-TICKET-10 / AC-13, BR-31: every other pair is a 409 naming both ends, and the status is unchanged", async () => {
    let refused = 0;
    for (const from of CURRENT_STATUSES) {
      // A refused move changes nothing, so one Ticket serves every attempt
      // from the same status.
      const ticket = await makeTicket({ currentStatus: from });
      for (const to of CURRENT_STATUSES) {
        if (to === from || canTransition(from, to)) continue;

        const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/status`, { currentStatus: to });

        expect(res.status, `${from} -> ${to}`).toBe(409);
        expect(res.body.error.code, `${from} -> ${to}`).toBe("INVALID_STATUS_TRANSITION");
        refused += 1;
      }
      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(stored.currentStatus, from).toBe(from);
    }
    expect(refused).toBe(64 - 20 - 8);

    // The message is the Ticket's own state in words (api-spec.md §7).
    const closed = await makeTicket({ currentStatus: "CLOSED" });
    const res = await as(staffACookie).patch(`/api/tickets/${closed.id}/status`, { currentStatus: "OPEN" });
    expect(res.body.error.message).toBe("A ticket cannot move from Closed to Open.");
  });

  it("API-TICKET-10 / AC-13: of two simultaneous moves on one Ticket, exactly one wins and the other is a conflict", async () => {
    const ticket = await makeTicket({ currentStatus: "NEW" });

    const results = await Promise.all([
      as(staffACookie).patch(`/api/tickets/${ticket.id}/status`, { currentStatus: "OPEN" }),
      as(staffBCookie).patch(`/api/tickets/${ticket.id}/status`, { currentStatus: "OPEN" }),
    ]);

    // Whichever lands second finds the Ticket already Open, and Open -> Open is
    // not a move — it must not report a success it did not perform.
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.currentStatus).toBe("OPEN");
  });

  it("API-TICKET-10 / BR-42: a value that is not a status is a validation error, not a conflict", async () => {
    const ticket = await makeTicket({ currentStatus: "NEW" });

    for (const body of [{ currentStatus: "DONE" }, { currentStatus: "open" }, { currentStatus: null }, {}]) {
      const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/status`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "currentStatus" });
    }
  });

  it("API-TICKET-11 / BR-31: setting a status to the value it already has is a 409, not a silent success", async () => {
    for (const status of CURRENT_STATUSES) {
      const ticket = await makeTicket({ currentStatus: status });

      const res = await as(staffACookie).patch(`/api/tickets/${ticket.id}/status`, { currentStatus: status });

      expect(res.status, status).toBe(409);
      expect(res.body.error.code, status).toBe("INVALID_STATUS_TRANSITION");
      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(stored.updatedAt.getTime(), status).toBe(LONG_AGO.getTime());
    }
  });
});

describe("POST /api/tickets/:id/appears-resolved", () => {
  it("API-TICKET-12 / AC-16, BR-05, BR-34: the Requester's signal is recorded with the time, the status is untouched, and staff see it", async () => {
    const ticket = await makeTicket({ currentStatus: "IN_PROGRESS" });
    const before = Date.now();

    const res = await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);

    expect(res.status).toBe(200);
    expect(res.body.data.currentStatus).toBe("IN_PROGRESS");
    const signalledAt = new Date(res.body.data.requesterResolvedAt).getTime();
    expect(signalledAt).toBeGreaterThanOrEqual(before - 1000);
    expect(signalledAt).toBeLessThanOrEqual(Date.now() + 1000);

    const staff = await as(staffACookie).get(`/api/tickets/${ticket.id}`);
    expect(staff.body.data.requesterResolvedAt).toBe(res.body.data.requesterResolvedAt);
    expect(staff.body.data.currentStatus).toBe("IN_PROGRESS");
  });

  it("API-TICKET-13 / BR-34: a second signal is 409, and the first time is not overwritten", async () => {
    const ticket = await makeTicket({ currentStatus: "OPEN" });

    const first = await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);
    expect(first.status).toBe(200);

    const second = await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ALREADY_INDICATED");

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.requesterResolvedAt?.toISOString()).toBe(first.body.data.requesterResolvedAt);
  });

  it("API-TICKET-14 / BR-34: on a Resolved, Closed or Cancelled Ticket the signal no longer applies", async () => {
    for (const status of ["RESOLVED", "CLOSED", "CANCELLED"] as const) {
      const ticket = await makeTicket({ currentStatus: status });

      const res = await as(requesterCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);

      expect(res.status, status).toBe(409);
      expect(res.body.error.code, status).toBe("RESOLUTION_NOT_APPLICABLE");
      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(stored.requesterResolvedAt, status).toBeNull();
    }
  });

  it("API-TICKET-15 / BR-16: staff are refused with 403; another Requester gets the 404 a missing Ticket gets", async () => {
    const ticket = await makeTicket({ currentStatus: "OPEN" });

    for (const cookie of [staffACookie, adminCookie]) {
      const res = await as(cookie).post(`/api/tickets/${ticket.id}/appears-resolved`);
      // Staff may see the Ticket, so a plain refusal discloses nothing.
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }

    const foreign = await as(otherCookie).post(`/api/tickets/${ticket.id}/appears-resolved`);
    const absent = await as(otherCookie).post(`/api/tickets/${NEVER_EXISTED}/appears-resolved`);
    expect(foreign.status).toBe(404);
    // Byte for byte: somebody else's Ticket and no Ticket are one answer.
    expect(foreign.body).toEqual(absent.body);

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.requesterResolvedAt).toBeNull();
  });
});

describe("Attachments for staff", () => {
  async function uploadAsRequester(ticketId: number, filename: string, bytes: Buffer) {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set("Cookie", requesterCookie)
      .attach("file", bytes, { filename, contentType: "application/pdf" });
    expect(res.status).toBe(201);
    return res.body.data as { id: number; originalFilename: string };
  }

  it("API-TICKET-16 / AC-26, FR-21: staff read and download an attachment on a Ticket they do not own", async () => {
    const ticket = await makeTicket();
    const bytes = Buffer.from("%PDF-1.4 staff can read this");
    const attachment = await uploadAsRequester(ticket.id, "error report.pdf", bytes);

    for (const cookie of [staffACookie, adminCookie]) {
      const metadata = await as(cookie).get(`/api/attachments/${attachment.id}`);
      expect(metadata.status).toBe(200);
      expect(metadata.body.data.originalFilename).toBe("error report.pdf");

      const download = await request(app)
        .get(`/api/attachments/${attachment.id}/download`)
        .set("Cookie", cookie)
        .buffer(true)
        .parse(binary);
      expect(download.status).toBe(200);
      expect(download.headers["content-disposition"]).toContain("error report.pdf");
      expect(Buffer.compare(download.body as Buffer, bytes)).toBe(0);
    }

    // The Ticket's detail lists it for staff too.
    const detail = await as(staffACookie).get(`/api/tickets/${ticket.id}`);
    expect(detail.body.data.attachments.map((a: { id: number }) => a.id)).toEqual([attachment.id]);
  });

  it("API-TICKET-16 / BR-30: a removed attachment stays readable as metadata and is never downloadable, by staff either", async () => {
    const ticket = await makeTicket();
    const attachment = await uploadAsRequester(ticket.id, "old.pdf", Buffer.from("%PDF-1.4 removed"));
    const removed = await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("Cookie", requesterCookie)
      .send({ removalReason: "Uploaded the wrong file." });
    expect(removed.status).toBe(200);

    const metadata = await as(staffACookie).get(`/api/attachments/${attachment.id}`);
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.removedAt).not.toBeNull();

    const download = await as(staffACookie).get(`/api/attachments/${attachment.id}/download`);
    expect(download.status).toBe(404);
    expect(download.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
  });

  it("API-TICKET-17 / FR-21: staff can neither upload nor remove, and the attachment is untouched", async () => {
    const ticket = await makeTicket();
    const attachment = await uploadAsRequester(ticket.id, "keep.pdf", Buffer.from("%PDF-1.4 keep"));

    const upload = await request(app)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set("Cookie", staffACookie)
      .attach("file", Buffer.from("%PDF-1.4 staff"), { filename: "staff.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(403);
    expect(upload.body.error.code).toBe("FORBIDDEN");

    const remove = await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("Cookie", staffACookie)
      .send({ removalReason: "Staff trying to remove it." });
    expect(remove.status).toBe(403);
    expect(remove.body.error.code).toBe("FORBIDDEN");

    const stored = await prisma.attachment.findMany({ where: { ticketId: ticket.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].removedAt).toBeNull();
  });
});

describe("New and changed ownership", () => {
  it("API-TICKET-18 / BR-27, BR-29: a Ticket created in Lab 3 starts unassigned, New, with IT Priority equal to Requested Priority", async () => {
    const created = await request(app).post("/api/tickets").set("Cookie", requesterCookie).send({
      categoryId,
      relatedSystemId,
      summary: "Created through the API for API-TICKET-18",
      description: "Checks the starting state of a Ticket raised in Lab 3.",
      requestedPriority: "HIGH",
    });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      currentStatus: "NEW",
      ownerId: null,
      owner: null,
      requestedPriority: "HIGH",
      itPriority: "HIGH",
      requesterResolvedAt: null,
    });
    expect(created.body.data.requester).toEqual({ id: requesterId, name: "Ops Requester", role: "REQUESTER" });

    // And staff read it the same way.
    const staff = await as(staffACookie).get(`/api/tickets/${created.body.data.id}`);
    expect(staff.body.data).toMatchObject({ currentStatus: "NEW", owner: null, itPriority: "HIGH" });
  });

  it("API-TICKET-19 / BR-26: a Ticket keeps an owner who is deactivated, and stays reassignable", async () => {
    const ticket = await makeTicket({ ownerId: leavingId });
    await prisma.user.update({ where: { id: leavingId }, data: { isActive: false } });

    try {
      const read = await as(staffACookie).get(`/api/tickets/${ticket.id}`);
      expect(read.body.data.owner).toEqual({ id: leavingId, name: "Ops Staff Leaving", role: "IT_STAFF" });

      // BR-25 applies to a new assignment only: the deactivated owner cannot be
      // chosen again...
      const back = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: leavingId });
      expect(back.status).toBe(400);
      expect(back.body.error.code).toBe("INVALID_OWNER");

      // ...but any staff member can move the Ticket on (BR-28).
      const moved = await as(staffACookie).patch(`/api/tickets/${ticket.id}/owner`, { ownerId: staffBId });
      expect(moved.status).toBe(200);
      expect(moved.body.data.owner.id).toBe(staffBId);
    } finally {
      await prisma.user.update({ where: { id: leavingId }, data: { isActive: true } });
    }
  });
});
