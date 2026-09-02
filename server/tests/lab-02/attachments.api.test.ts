import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";

// tests.md API-ATT-01..05 and API-ATT-12 (the upload half of the attachment
// lifecycle — metadata, download, and soft removal arrive with Issue #15).
// specification.md BR-11, BR-26..BR-28, BR-32, BR-33; api-spec.md §5.
// Runs against a temporary uploads directory so real files are never written
// into the repository (tests.md §1).

const prisma = getPrisma();

let uploadDir = "";
let requesterId = 0;
let otherRequesterId = 0;
let ticketId = 0;
let foreignTicketId = 0;

const ONE_MB = 1024 * 1024;

// Smallest bytes that still look like the type in question; the endpoint
// validates the declared type and extension, so content only needs to be
// non-empty and distinguishable between cases.
const bytes = (size: number) => Buffer.alloc(size, 0x41);

async function createTicketFor(owner: number, summary: string) {
  const response = await request(app)
    .post("/api/tickets")
    .set("X-Requester-Id", String(owner))
    .send({
      categoryId: (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id,
      relatedSystemId: (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id,
      summary,
      description: "Attachment lifecycle fixture ticket for the Lab 2 test suite.",
      requestedPriority: "LOW",
    });
  expect(response.status).toBe(201);
  return response.body.data.id as number;
}

const upload = (
  targetTicketId: number,
  file: { buffer: Buffer; filename: string; contentType?: string },
  callerId: number | null = requesterId,
) => {
  const req = request(app).post(`/api/tickets/${targetTicketId}/attachments`);
  if (callerId !== null) req.set("X-Requester-Id", String(callerId));
  return req.attach("file", file.buffer, {
    filename: file.filename,
    contentType: file.contentType,
  });
};

beforeAll(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "toktickit-uploads-"));
  process.env.UPLOAD_DIR = uploadDir;

  const owner = await prisma.requester.upsert({
    where: { email: "attachments.owner@test.invalid" },
    update: { isActive: true },
    create: { name: "Attachment Owner", email: "attachments.owner@test.invalid" },
  });
  const other = await prisma.requester.upsert({
    where: { email: "attachments.other@test.invalid" },
    update: { isActive: true },
    create: { name: "Attachment Other", email: "attachments.other@test.invalid" },
  });
  requesterId = owner.id;
  otherRequesterId = other.id;

  ticketId = await createTicketFor(requesterId, "Attachment fixture ticket");
  foreignTicketId = await createTicketFor(otherRequesterId, "Foreign attachment fixture ticket");
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Each test starts from a ticket with zero attachments so the BR-28 limit
  // test is the only one that has to reason about counts.
  await prisma.attachment.deleteMany({ where: { ticketId } });
});

afterAll(async () => {
  const ids = [requesterId, otherRequesterId];
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  await prisma.requester.deleteMany({ where: { id: { in: ids } } });
  delete process.env.UPLOAD_DIR;
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

describe("POST /api/tickets/:id/attachments", () => {
  it("API-ATT-01: accepts JPG/JPEG/PNG/WEBP/PDF and rejects anything else with 415 (BR-26)", async () => {
    const allowed = [
      { filename: "evidence.jpg", contentType: "image/jpeg" },
      { filename: "evidence.jpeg", contentType: "image/jpeg" },
      { filename: "evidence.png", contentType: "image/png" },
      { filename: "evidence.webp", contentType: "image/webp" },
      { filename: "evidence.pdf", contentType: "application/pdf" },
    ];

    for (const file of allowed) {
      const response = await upload(ticketId, { buffer: bytes(64), ...file });
      expect(response.status, `${file.filename} should be accepted`).toBe(201);
      expect(response.body.data.originalFilename).toBe(file.filename);
      expect(response.body.data.mimeType).toBe(file.contentType);
      await prisma.attachment.deleteMany({ where: { ticketId } });
    }

    const rejected = [
      { filename: "notes.txt", contentType: "text/plain" },
      { filename: "payload.exe", contentType: "application/octet-stream" },
      // A disallowed file wearing an allowed extension must still be refused.
      { filename: "payload.png", contentType: "application/zip" },
      // ...and an allowed type wearing a disallowed extension likewise.
      { filename: "payload.svg", contentType: "image/png" },
    ];

    for (const file of rejected) {
      const response = await upload(ticketId, { buffer: bytes(64), ...file });
      expect(response.status, `${file.filename} should be refused`).toBe(415);
      expect(response.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    }

    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(0);
  });

  it("API-ATT-02: accepts a file at exactly 5 MB and rejects 5 MB + 1 byte with 413 (BR-27)", async () => {
    const atLimit = await upload(ticketId, {
      buffer: bytes(5 * ONE_MB),
      filename: "at-limit.pdf",
      contentType: "application/pdf",
    });
    expect(atLimit.status).toBe(201);
    expect(atLimit.body.data.sizeBytes).toBe(5 * ONE_MB);

    const overLimit = await upload(ticketId, {
      buffer: bytes(5 * ONE_MB + 1),
      filename: "over-limit.pdf",
      contentType: "application/pdf",
    });
    expect(overLimit.status).toBe(413);
    expect(overLimit.body.error.code).toBe("FILE_TOO_LARGE");

    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(1);
  });

  it("API-ATT-03: a 6th active attachment is refused with 409 and never stored (BR-28)", async () => {
    for (let i = 1; i <= 5; i++) {
      const response = await upload(ticketId, {
        buffer: bytes(32),
        filename: `evidence-${i}.png`,
        contentType: "image/png",
      });
      expect(response.status).toBe(201);
    }

    const sixth = await upload(ticketId, {
      buffer: bytes(32),
      filename: "evidence-6.png",
      contentType: "image/png",
    });
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe("ATTACHMENT_LIMIT_REACHED");
    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(5);

    // A soft-removed attachment does not count toward the active limit, so
    // freeing one slot must let the 6th through (BR-28 counts active only).
    const first = await prisma.attachment.findFirstOrThrow({ where: { ticketId } });
    await prisma.attachment.update({
      where: { id: first.id },
      data: { removedAt: new Date(), removedReason: "Freeing a slot for the limit test" },
    });

    const retry = await upload(ticketId, {
      buffer: bytes(32),
      filename: "evidence-6.png",
      contentType: "image/png",
    });
    expect(retry.status).toBe(201);
    expect(await prisma.attachment.count({ where: { ticketId, removedAt: null } })).toBe(5);
  });

  it("API-ATT-04: stored filenames are randomized and can never escape the uploads directory (BR-32)", async () => {
    const response = await upload(ticketId, {
      buffer: bytes(32),
      filename: "../../escape attempt.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(201);
    const stored = await prisma.attachment.findFirstOrThrow({ where: { ticketId } });

    // The name on disk is generated, not derived from user input...
    expect(stored.storedFilename).not.toContain("escape");
    expect(stored.storedFilename).not.toMatch(/[/\\]/);
    expect(stored.storedFilename).not.toContain("..");

    // ...and the file really landed inside the uploads directory.
    const resolved = path.resolve(uploadDir, stored.storedFilename);
    expect(resolved.startsWith(path.resolve(uploadDir))).toBe(true);
    expect(fs.existsSync(resolved)).toBe(true);
    expect(fs.statSync(resolved).size).toBe(32);

    // The display name is kept, but only as its basename — no directory parts.
    expect(stored.originalFilename).toBe("escape attempt.png");
  });

  it("API-ATT-05: the metadata response carries every contracted field and never storedFilename", async () => {
    const response = await upload(ticketId, {
      buffer: bytes(128),
      filename: "screenshot.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(201);
    const attachment = response.body.data;
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
    expect(attachment.ticketId).toBe(ticketId);
    expect(attachment.sizeBytes).toBe(128);
    expect(attachment.removedAt).toBeNull();
    expect(attachment.removedReason).toBeNull();
    expect(new Date(attachment.uploadedAt).getTime()).not.toBeNaN();
  });

  it("API-ATT-06 (upload half): uploading to a ticket you do not own returns 404 (BR-11, BR-12)", async () => {
    const foreign = await upload(foreignTicketId, {
      buffer: bytes(32),
      filename: "evidence.png",
      contentType: "image/png",
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("TICKET_NOT_FOUND");

    const missing = await upload(999999, {
      buffer: bytes(32),
      filename: "evidence.png",
      contentType: "image/png",
    });
    // Indistinguishable from the foreign-ticket response, so ticket existence
    // is never leaked across Requesters (BR-12).
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(foreign.body);

    expect(await prisma.attachment.count({ where: { ticketId: foreignTicketId } })).toBe(0);
  });

  it("API-ATT-12: a failed upload stores no row and leaves existing attachments intact (BR-33)", async () => {
    const first = await upload(ticketId, {
      buffer: bytes(32),
      filename: "keeper.png",
      contentType: "image/png",
    });
    expect(first.status).toBe(201);

    vi.spyOn(prisma.attachment, "create").mockRejectedValueOnce(new Error("simulated write failure"));

    const failed = await upload(ticketId, {
      buffer: bytes(32),
      filename: "doomed.png",
      contentType: "image/png",
    });
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(failed.body)).not.toContain("simulated write failure");

    const remaining = await prisma.attachment.findMany({ where: { ticketId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].originalFilename).toBe("keeper.png");

    // The ticket itself is untouched by a failed attachment (BR-33/BR-34).
    expect(await prisma.ticket.findUnique({ where: { id: ticketId } })).not.toBeNull();
  });

  it("requires the X-Requester-Id header (api-spec.md §1)", async () => {
    const response = await upload(
      ticketId,
      { buffer: bytes(32), filename: "evidence.png", contentType: "image/png" },
      null,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
