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

  it("API-ATT-14: concurrent uploads cannot push a ticket past 5 active attachments (BR-28)", async () => {
    for (let i = 1; i <= 4; i++) {
      const response = await upload(ticketId, {
        buffer: bytes(32),
        filename: `existing-${i}.png`,
        contentType: "image/png",
      });
      expect(response.status).toBe(201);
    }

    // Three uploads race for the single remaining slot. Counting outside a
    // transaction would let all three see four attachments and all three
    // insert, which is the same read-then-write race BR-01 rules out for the
    // Ticket Number.
    const responses = await Promise.all(
      [1, 2, 3].map((n) =>
        upload(ticketId, { buffer: bytes(32), filename: `racing-${n}.png`, contentType: "image/png" }),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const refused = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(2);
    for (const response of refused) {
      expect(response.body.error.code).toBe("ATTACHMENT_LIMIT_REACHED");
    }

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

    const filesBefore = fs.readdirSync(uploadDir).length;

    // The insert now runs on the transaction client, so the failure is
    // injected there. The callback still executes for real, which means the
    // file is written to disk before the write fails — exactly the case
    // BR-33's cleanup exists for.
    vi.spyOn(prisma, "$transaction").mockImplementationOnce(((callback: unknown) =>
      (callback as (tx: unknown) => Promise<unknown>)({
        $queryRaw: async () => [],
        attachment: {
          count: async () => 1,
          create: async () => {
            throw new Error("simulated write failure");
          },
        },
      })) as never);

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

    // The ticket itself is untouched by a failed attachment (BR-33/BR-34)...
    expect(await prisma.ticket.findUnique({ where: { id: ticketId } })).not.toBeNull();
    // ...and the file written just before the failure is cleaned up rather
    // than left orphaned on disk.
    expect(fs.readdirSync(uploadDir).length).toBe(filesBefore);
  });

  it("API-ATT-15: an unusable ticket id in the path is a 404, never a 500", async () => {
    const file = { buffer: bytes(32), filename: "evidence.png", contentType: "image/png" };

    for (const badId of ["abc", "-1", "0", "99999999999999999999", "2147483648"]) {
      const response = await request(app)
        .post(`/api/tickets/${badId}/attachments`)
        .set("X-Requester-Id", String(requesterId))
        .attach("file", file.buffer, { filename: file.filename, contentType: file.contentType });

      expect(response.status, `ticket id ${badId}`).toBe(404);
      expect(response.body.error.code).toBe("TICKET_NOT_FOUND");
    }
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

// ---------------------------------------------------------------------------
// Issue #15 — the rest of the attachment lifecycle: metadata, download and
// soft removal. tests.md API-ATT-05..11, API-ATT-13.
// ---------------------------------------------------------------------------
describe("Attachment metadata, download and removal", () => {
  const CONTENTS = Buffer.from("the exact bytes that must come back out", "utf8");

  async function freshAttachment(filename = "evidence.png") {
    const response = await upload(ticketId, {
      buffer: CONTENTS,
      filename,
      contentType: "image/png",
    });
    expect(response.status).toBe(201);
    return response.body.data as { id: number; originalFilename: string };
  }

  it("API-ATT-10: the owner downloads an active attachment and gets its bytes back (AC-17)", async () => {
    const attachment = await freshAttachment("proof of the problem.png");

    const response = await request(app)
      .get(`/api/attachments/${attachment.id}/download`)
      .set("X-Requester-Id", String(requesterId))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    // The display name comes back, not the randomised name on disk (BR-32).
    expect(response.headers["content-disposition"]).toContain("proof of the problem.png");
    expect(Buffer.from(response.body).equals(CONTENTS)).toBe(true);
  });

  it("API-ATT-05: metadata is readable on its own, and never exposes storedFilename", async () => {
    const attachment = await freshAttachment();

    const response = await request(app)
      .get(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId));

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual([
      "id",
      "mimeType",
      "originalFilename",
      "removedAt",
      "removedReason",
      "sizeBytes",
      "ticketId",
      "uploadedAt",
    ]);
    expect(response.body.data.sizeBytes).toBe(CONTENTS.length);
  });

  it("API-ATT-07: removing an attachment is a soft update — the row survives (BR-29)", async () => {
    const attachment = await freshAttachment();

    const response = await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId))
      .send({ removalReason: "Uploaded the wrong screenshot by mistake" });

    expect(response.status).toBe(200);
    expect(response.body.data.removedAt).not.toBeNull();
    expect(response.body.data.removedReason).toBe("Uploaded the wrong screenshot by mistake");

    // DELETE is the verb, but nothing is deleted: the record and its metadata
    // stay readable, which is the whole point of a soft removal.
    const row = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(row).not.toBeNull();
    expect(row!.removedAt).not.toBeNull();
    expect(row!.originalFilename).toBe("evidence.png");

    const metadata = await request(app)
      .get(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId));
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.removedReason).toBe("Uploaded the wrong screenshot by mistake");
  });

  it("API-ATT-08: a removed attachment cannot be downloaded, not even by its owner (BR-30, AC-08)", async () => {
    const attachment = await freshAttachment();
    await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId))
      .send({ removalReason: "No longer relevant to this ticket" })
      .expect(200);

    const response = await request(app)
      .get(`/api/attachments/${attachment.id}/download`)
      .set("X-Requester-Id", String(requesterId));

    // The one case where an owned resource still 404s, and deliberately so.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
  });

  it("API-ATT-09: removal requires a reason of 5-200 characters (BR-31, AC-13)", async () => {
    const attachment = await freshAttachment();

    const rejected: unknown[] = [undefined, "", "    ", "abcd", "a".repeat(201)];
    for (const removalReason of rejected) {
      const response = await request(app)
        .delete(`/api/attachments/${attachment.id}`)
        .set("X-Requester-Id", String(requesterId))
        .send({ removalReason });

      expect(response.status, `reason ${JSON.stringify(removalReason)}`).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.body.error.field).toBe("removalReason");
    }

    // Nothing was altered by any of those attempts.
    const untouched = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(untouched!.removedAt).toBeNull();

    // The lower boundary is accepted, and measured after trimming.
    const atMinimum = await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId))
      .send({ removalReason: "  wrong  " });
    expect(atMinimum.status).toBe(200);
    expect(atMinimum.body.data.removedReason).toBe("wrong");
  });

  it("API-ATT-13: removing an already-removed attachment is refused (idempotency guard)", async () => {
    const attachment = await freshAttachment();
    await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId))
      .send({ removalReason: "First and only removal" })
      .expect(200);

    const again = await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(requesterId))
      .send({ removalReason: "Trying to remove it a second time" });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_REMOVED");

    // The original reason is not overwritten by the second attempt.
    const row = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(row!.removedReason).toBe("First and only removal");
  });

  it("API-ATT-06: reading, downloading and removing are all refused across Requesters (BR-11, BR-12)", async () => {
    const attachment = await freshAttachment();

    const metadata = await request(app)
      .get(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(otherRequesterId));
    const download = await request(app)
      .get(`/api/attachments/${attachment.id}/download`)
      .set("X-Requester-Id", String(otherRequesterId));
    const removal = await request(app)
      .delete(`/api/attachments/${attachment.id}`)
      .set("X-Requester-Id", String(otherRequesterId))
      .send({ removalReason: "Not mine to remove, but trying anyway" });

    for (const response of [metadata, download, removal]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
    }

    // A nonexistent id answers identically, so ownership is not detectable.
    const missing = await request(app)
      .get("/api/attachments/999999")
      .set("X-Requester-Id", String(otherRequesterId));
    expect(missing.body).toEqual(metadata.body);

    // And the attempt changed nothing.
    const row = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(row!.removedAt).toBeNull();
  });

  it("API-ATT-11: a later upload failing leaves the ticket and earlier attachments intact (BR-25, BR-34)", async () => {
    const first = await freshAttachment("kept-one.png");
    const second = await freshAttachment("kept-two.png");

    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("simulated failure on the third"));
    const third = await upload(ticketId, {
      buffer: bytes(32),
      filename: "never-stored.png",
      contentType: "image/png",
    });
    expect(third.status).toBe(500);

    // The Ticket committed independently of its attachments, so a failure here
    // rolls back neither it nor the uploads that already succeeded.
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { attachments: true },
    });
    expect(ticket).not.toBeNull();
    expect(ticket!.attachments.map((a) => a.originalFilename).sort()).toEqual([
      "kept-one.png",
      "kept-two.png",
    ]);
    expect(ticket!.attachments.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("an unusable attachment id is a 404, and the header rules still apply", async () => {
    for (const badId of ["abc", "-1", "0", "99999999999999999999"]) {
      const response = await request(app)
        .get(`/api/attachments/${badId}`)
        .set("X-Requester-Id", String(requesterId));
      expect(response.status, `id ${badId}`).toBe(404);
      expect(response.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
    }

    const attachment = await freshAttachment();
    const noHeader = await request(app).get(`/api/attachments/${attachment.id}`);
    expect(noHeader.status).toBe(400);
    expect(noHeader.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Attachment file missing from disk", () => {
  it("reports a server fault rather than disguising a lost file as a missing resource", async () => {
    // The row says a file is there. If it is not, that is the server having
    // lost it — answering 404 would tell the Requester their attachment never
    // existed, which is not what happened.
    const orphan = await prisma.attachment.create({
      data: {
        ticketId,
        originalFilename: "vanished.png",
        storedFilename: "this-file-was-never-written.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    });

    try {
      const response = await request(app)
        .get(`/api/attachments/${orphan.id}/download`)
        .set("X-Requester-Id", String(requesterId));

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
      // The generic message only — no path, no filename, nothing internal.
      expect(JSON.stringify(response.body)).not.toContain("this-file-was-never-written");

      // Its metadata is still readable; only the file is gone.
      const metadata = await request(app)
        .get(`/api/attachments/${orphan.id}`)
        .set("X-Requester-Id", String(requesterId));
      expect(metadata.status).toBe(200);
      expect(metadata.body.data.originalFilename).toBe("vanished.png");
    } finally {
      await prisma.attachment.delete({ where: { id: orphan.id } });
    }
  });
});
