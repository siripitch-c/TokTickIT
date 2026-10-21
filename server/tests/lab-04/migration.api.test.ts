import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md MIG-01..MIG-08; specification.md §7, BR-32, AC-27, AC-28.
//
// The migration is the one part of this sprint that cannot be re-run to check
// it: it has already been applied to the developer database, and applying it
// again would do nothing. So these cases prove the *outcome* rather than the
// process - that the rows Labs 1 to 3 created are all still here and still
// resolve, that the columns Lab 4 added carry the defaults the migration says
// they do, and that a Ticket from before Lab 4 behaves like any other.
//
// MIG-04 is the exception and the interesting one. PostgreSQL makes DDL
// transactional, so the documented rollback is executed for real - every
// statement from the migration header, against the live schema - inside a
// transaction that is then aborted. The database is unchanged afterwards, and
// the rollback has still been proven rather than described.
//
// MIG-09 is not a case here: "the earlier suites pass unchanged" is evidenced
// by those suites passing in the same run as this file, which is the whole
// server suite, not by a test that asserts something about other tests.

const prisma = getPrisma();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, "..", "..");

const STAFF = "mig.staff@test.invalid";
const REQUESTER = "mig.requester@test.invalid";
const EMAILS = [STAFF, REQUESTER];
const NUMBER_PREFIX = "TKT-2098-";

let staffCookie = "";
let requesterId = 0;
let categoryId = 0;
let relatedSystemId = 0;

async function removeFixtures() {
  const ids = (
    await prisma.ticket.findMany({
      where: { ticketNumber: { startsWith: NUMBER_PREFIX } },
      select: { id: true },
    })
  ).map((t) => t.id);
  if (ids.length) {
    await prisma.actionTaken.deleteMany({ where: { ticketId: { in: ids } } });
    // MIG-07 uploads one, and an Attachment row restricts the delete of its
    // Ticket, so it goes first or the whole cleanup fails on the next run.
    await prisma.attachment.deleteMany({ where: { ticketId: { in: ids } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await upsertTestUser({ email: STAFF, name: "Mig Staff", role: "IT_STAFF" });
  requesterId = (await upsertTestUser({ email: REQUESTER, name: "Mig Requester" })).id;
  staffCookie = await signIn(STAFF);
  categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;
  await removeFixtures();
}, 60_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

/** A Ticket shaped like one Lab 2 left behind: no Actions, no owner. */
async function legacyTicket(currentStatus: "NEW" | "RESOLVED" = "NEW") {
  const when = new Date("2026-09-01T03:00:00.000Z");
  return prisma.ticket.create({
    data: {
      ticketNumber: `${NUMBER_PREFIX}${String(Date.now() % 1_000_000).padStart(6, "0")}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: "A Ticket raised before Actions Taken existed",
      description: "Created by the migration suite to stand in for a pre-Lab-4 row.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus,
      createdAt: when,
      updatedAt: when,
      resolvedAt: currentStatus === "RESOLVED" ? when : null,
    },
  });
}

describe("What Labs 1 to 3 left behind", () => {
  it("MIG-01 / §7, BR-32: every row the earlier labs created still resolves, and the Lab 2 Tickets are still here", async () => {
    // The Lab 3 migration renamed `Requester` to `User` in place rather than
    // dropping and recreating it, so that every id survived and every
    // `Ticket.requesterId` kept pointing at the same person. If that had gone
    // wrong, the damage would show as an unresolvable reference rather than as
    // a missing table, and nothing else in the suite looks for one.
    const [users, tickets, attachments, comments, notes, actions] = await Promise.all([
      prisma.user.count(),
      prisma.ticket.count(),
      prisma.attachment.count(),
      prisma.publicComment.count(),
      prisma.internalNote.count(),
      prisma.actionTaken.count(),
    ]);
    expect(users, "no User rows: the database is not seeded").toBeGreaterThan(0);
    expect(tickets).toBeGreaterThan(0);

    const orphans = await prisma.$queryRawUnsafe<{ what: string; count: bigint }[]>(`
      SELECT 'ticket.requesterId' AS what, count(*) FROM "Ticket" t
        LEFT JOIN "User" u ON u.id = t."requesterId" WHERE u.id IS NULL
      UNION ALL SELECT 'ticket.ownerId', count(*) FROM "Ticket" t
        LEFT JOIN "User" u ON u.id = t."ownerId" WHERE t."ownerId" IS NOT NULL AND u.id IS NULL
      UNION ALL SELECT 'attachment.ticketId', count(*) FROM "Attachment" a
        LEFT JOIN "Ticket" t ON t.id = a."ticketId" WHERE t.id IS NULL
      UNION ALL SELECT 'comment.ticketId', count(*) FROM "PublicComment" c
        LEFT JOIN "Ticket" t ON t.id = c."ticketId" WHERE t.id IS NULL
      UNION ALL SELECT 'comment.authorId', count(*) FROM "PublicComment" c
        LEFT JOIN "User" u ON u.id = c."authorId" WHERE u.id IS NULL
      UNION ALL SELECT 'note.ticketId', count(*) FROM "InternalNote" n
        LEFT JOIN "Ticket" t ON t.id = n."ticketId" WHERE t.id IS NULL
      UNION ALL SELECT 'note.authorId', count(*) FROM "InternalNote" n
        LEFT JOIN "User" u ON u.id = n."authorId" WHERE u.id IS NULL
      UNION ALL SELECT 'action.ticketId', count(*) FROM "ActionTaken" a
        LEFT JOIN "Ticket" t ON t.id = a."ticketId" WHERE t.id IS NULL
    `);
    const broken = orphans.filter((row) => Number(row.count) > 0).map((row) => `${row.what}: ${row.count}`);
    expect(broken, `references that no longer resolve:\n  ${broken.join("\n  ")}`).toEqual([]);

    // The oldest Ticket predates Lab 4 by construction - nothing in Lab 4
    // backdates a row - so reading it proves a migrated row is still readable
    // through the API and not only present in the table.
    const oldest = await prisma.ticket.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    const res = await request(app).get(`/api/tickets/${oldest.id}`).set("Cookie", staffCookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.id).toBe(oldest.id);
    expect(res.body.data.ticketNumber).toBe(oldest.ticketNumber);

    void [attachments, comments, notes, actions];
  });

  it("MIG-02 / §7, BR-26: the version column arrived with a default of 1, so an unaware client reads 1", async () => {
    // Asserted from the schema rather than from the rows: a Ticket edited since
    // the migration is legitimately above 1, so counting rows at version 1
    // would prove nothing. What the migration promised is the DEFAULT.
    const columns = await prisma.$queryRawUnsafe<{ column_name: string; column_default: string | null }[]>(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'Ticket' AND column_name IN ('version', 'resolvedAt')
    `);
    const version = columns.find((c) => c.column_name === "version");
    expect(version, "Ticket.version is missing").toBeDefined();
    expect(version!.column_default).toBe("1");

    // And no row escaped it downwards.
    expect(await prisma.ticket.count({ where: { version: { lt: 1 } } })).toBe(0);

    // `resolvedAt` is nullable with no default on purpose (Issue #49): a Ticket
    // that is not Resolved has no resolution moment to record.
    expect(columns.find((c) => c.column_name === "resolvedAt")!.column_default).toBeNull();
  });

  it("MIG-03 / AC-27: a Ticket from before Actions Taken reads, resolves, and is counted rather than skipped", async () => {
    const ticket = await legacyTicket("NEW");

    // It reads, and the gate's counter says there is nothing open on it.
    const detail = await request(app).get(`/api/tickets/${ticket.id}`).set("Cookie", staffCookie);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.data.openActionCount).toBe(0);
    expect(detail.body.data.version).toBe(1);

    // And it resolves: BR-18's gate passes trivially for a Ticket with no
    // Actions, which is the whole of AC-27. The matrix has no New -> Resolved
    // edge, so it is walked the way a real desk would.
    let version = detail.body.data.version as number;
    for (const currentStatus of ["IN_PROGRESS", "RESOLVED"]) {
      const moved = await request(app)
        .patch(`/api/tickets/${ticket.id}/status`)
        .set("Cookie", staffCookie)
        .send({ version, currentStatus });
      expect(moved.status, `${currentStatus}: ${JSON.stringify(moved.body)}`).toBe(200);
      version = moved.body.data.version;
    }

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.currentStatus).toBe("RESOLVED");
    expect(stored.resolvedAt, "the transition records when it happened").not.toBeNull();

    // Counted by the dashboard, not skipped for having no Actions.
    const dashboard = await request(app).get("/api/dashboard/staff").set("Cookie", staffCookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.metrics.resolvedLast7Days).toBeGreaterThan(0);
    expect(dashboard.body.metrics.byStatus.RESOLVED).toBeGreaterThan(0);
  });

  it("MIG-04 / §7: the documented rollback runs, restores the Lab 3 shape, and keeps Lab 3 data", async () => {
    const before = {
      users: await prisma.user.count(),
      tickets: await prisma.ticket.count(),
      comments: await prisma.publicComment.count(),
      notes: await prisma.internalNote.count(),
      actions: await prisma.actionTaken.count(),
    };
    expect(before.actions, "no Actions to roll back: seed the database first").toBeGreaterThan(0);

    const ABORT = "migration-suite: roll the rollback back";
    let observed: Record<string, unknown> = {};

    await expect(
      prisma.$transaction(async (tx) => {
        // Exactly the statements in the two Lab 4 migration headers, in order.
        await tx.$executeRawUnsafe(`DROP INDEX "Ticket_currentStatus_resolvedAt_idx"`);
        await tx.$executeRawUnsafe(`ALTER TABLE "Ticket" DROP COLUMN "resolvedAt"`);
        await tx.$executeRawUnsafe(`DROP TABLE "ActionTaken"`);
        await tx.$executeRawUnsafe(`DROP TYPE "ActionStatus"`);
        await tx.$executeRawUnsafe(`ALTER TABLE "Ticket" DROP COLUMN "version"`);

        const gone = await tx.$queryRawUnsafe<{ what: string; n: bigint }[]>(`
          SELECT 'ActionTaken' AS what, count(*) AS n FROM information_schema.tables
            WHERE table_name = 'ActionTaken'
          UNION ALL SELECT 'ActionStatus', count(*) FROM pg_type WHERE typname = 'ActionStatus'
          UNION ALL SELECT 'Ticket.version', count(*) FROM information_schema.columns
            WHERE table_name = 'Ticket' AND column_name = 'version'
          UNION ALL SELECT 'Ticket.resolvedAt', count(*) FROM information_schema.columns
            WHERE table_name = 'Ticket' AND column_name = 'resolvedAt'
          UNION ALL SELECT 'Ticket.ownerId', count(*) FROM information_schema.columns
            WHERE table_name = 'Ticket' AND column_name = 'ownerId'
          UNION ALL SELECT 'PublicComment', count(*) FROM information_schema.tables
            WHERE table_name = 'PublicComment'
        `);
        const rows = await tx.$queryRawUnsafe<{ what: string; n: bigint }[]>(`
          SELECT 'users' AS what, count(*) AS n FROM "User"
          UNION ALL SELECT 'tickets', count(*) FROM "Ticket"
          UNION ALL SELECT 'comments', count(*) FROM "PublicComment"
          UNION ALL SELECT 'notes', count(*) FROM "InternalNote"
        `);
        observed = Object.fromEntries(
          [...gone, ...rows].map((row) => [row.what, Number(row.n)]),
        );
        throw new Error(ABORT);
      }),
    ).rejects.toThrow(ABORT);

    // Lab 4's own objects are gone...
    expect(observed["ActionTaken"]).toBe(0);
    expect(observed["ActionStatus"]).toBe(0);
    expect(observed["Ticket.version"]).toBe(0);
    expect(observed["Ticket.resolvedAt"]).toBe(0);
    // ...and Lab 3's are not, which is what "restores the Lab 3 schema" means.
    expect(observed["Ticket.ownerId"]).toBe(1);
    expect(observed["PublicComment"]).toBe(1);
    expect(observed["users"]).toBe(before.users);
    expect(observed["tickets"]).toBe(before.tickets);
    expect(observed["comments"]).toBe(before.comments);
    expect(observed["notes"]).toBe(before.notes);

    // The abort put everything back. If this fails, the developer database has
    // actually lost its Lab 4 schema and needs `prisma migrate deploy`.
    const after = {
      users: await prisma.user.count(),
      tickets: await prisma.ticket.count(),
      comments: await prisma.publicComment.count(),
      notes: await prisma.internalNote.count(),
      actions: await prisma.actionTaken.count(),
    };
    expect(after, "the rollback was not rolled back").toEqual(before);
  }, 60_000);
});

describe("The seed", () => {
  it("MIG-05 / BR-32: running it again changes nothing", async () => {
    const fingerprint = async () => ({
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      users: await prisma.user.count(),
      tickets: await prisma.ticket.count(),
      comments: await prisma.publicComment.count(),
      notes: await prisma.internalNote.count(),
      actions: await prisma.actionTaken.count(),
      // A changed password would be the costly regression: the seed upserts
      // users with `update: {}` so that a hand-changed development password is
      // never silently reset, which three debugging sessions have depended on.
      hashes: (await prisma.user.findMany({ select: { email: true, passwordHash: true }, orderBy: { id: "asc" } }))
        .map((u) => `${u.email}:${u.passwordHash.slice(-12)}`)
        .join("|"),
    });

    const before = await fingerprint();
    execFileSync("npm", ["run", "prisma:seed", "--silent"], {
      cwd: SERVER_DIR,
      stdio: "pipe",
      shell: true,
      timeout: 120_000,
    });
    expect(await fingerprint()).toEqual(before);
  }, 180_000);

  it("MIG-06 / §7: the seeded data covers what the dashboards and the gate need to show", async () => {
    const grouped = await prisma.actionTaken.groupBy({ by: ["ticketId"], _count: { _all: true } });
    const withActions = grouped.length;
    const totalTickets = await prisma.ticket.count();

    expect(withActions, "no Ticket has an Action").toBeGreaterThan(0);
    expect(totalTickets - withActions, "every Ticket has an Action, so the empty log is undemonstrable").toBeGreaterThan(0);
    expect(grouped.some((g) => g._count._all === 1), "no Ticket has exactly one Action").toBe(true);
    expect(grouped.some((g) => g._count._all > 1), "no Ticket has several Actions").toBe(true);

    // At least one Action in each status, so every badge is demonstrable.
    const byStatus = await prisma.actionTaken.groupBy({ by: ["status"], _count: { _all: true } });
    const seen = new Set(byStatus.map((row) => row.status));
    for (const status of ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect([...seen], `no seeded Action is ${status}`).toContain(status);
    }

    // And one Ticket resolved inside the dashboard's weekly window (BR-21).
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(
      await prisma.ticket.count({ where: { currentStatus: "RESOLVED", resolvedAt: { gte: sevenDaysAgo } } }),
      "nothing was resolved in the last 7 days, so that card always reads 0",
    ).toBeGreaterThan(0);

    // The Ticket-level coverage the handout §5.3 asks for, which this case did
    // not look at until the Issue #51 audit read that list against it: "all
    // major statuses, priorities, assigned and unassigned ownership".
    const statuses = new Set((await prisma.ticket.groupBy({ by: ["currentStatus"] })).map((r) => r.currentStatus));
    for (const status of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED"] as const) {
      expect([...statuses], `no seeded Ticket is ${status}`).toContain(status);
    }

    const priorities = new Set(
      (await prisma.ticket.groupBy({ by: ["requestedPriority"] })).map((r) => r.requestedPriority),
    );
    for (const priority of ["LOW", "MEDIUM", "HIGH"] as const) {
      expect([...priorities], `no seeded Ticket asked for ${priority}`).toContain(priority);
    }

    expect(await prisma.ticket.count({ where: { ownerId: null } }), "every Ticket has an owner").toBeGreaterThan(0);
    expect(
      await prisma.ticket.count({ where: { ownerId: { not: null } } }),
      "no Ticket is assigned, so the Unassigned and Assigned-to-me cards cannot both be shown",
    ).toBeGreaterThan(0);

    // "Data sufficient to demonstrate non-zero *and zero* dashboard metrics"
    // (§5.3). The zero half is a Requester with nothing at all, which is what
    // the Requester dashboard's empty state and AC-21 are shown with.
    const requesterIdsWithTickets = new Set(
      (await prisma.ticket.groupBy({ by: ["requesterId"] })).map((r) => r.requesterId),
    );
    const idleRequesters = (
      await prisma.user.findMany({ where: { role: "REQUESTER", isActive: true }, select: { id: true, email: true } })
    ).filter((u) => !requesterIdsWithTickets.has(u.id) && !u.email.includes(".test.invalid"));
    expect(
      idleRequesters.length,
      "every active Requester owns a Ticket, so the empty Requester dashboard cannot be demonstrated",
    ).toBeGreaterThan(0);
  });
});

describe("The earlier labs' contracts", () => {
  it("MIG-07 / AC-28, BR-32: the Lab 2 Requester contract still answers as lab-02/api-spec.md describes", async () => {
    const cookie = await signIn(REQUESTER);
    const mine = await legacyTicket("NEW");

    // The list, its envelope, and ownership (Lab 2 §4, BR-11).
    const list = await request(app).get("/api/tickets?pageSize=10").set("Cookie", cookie);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.pagination).toMatchObject({ page: 1, pageSize: 10 });
    expect((list.body.data as { id: number }[]).map((t) => t.id)).toContain(mine.id);

    // A Ticket that is not theirs reads as one that never existed (BR-12).
    const theirs = await prisma.ticket.findFirstOrThrow({ where: { requesterId: { not: requesterId } } });
    const foreign = await request(app).get(`/api/tickets/${theirs.id}`).set("Cookie", cookie);
    expect(foreign.status).toBe(404);
    // `TICKET_NOT_FOUND`, not the generic `NOT_FOUND` an unmatched path gets:
    // lab-02/api-spec.md §4 names it, and the distinction is the point - the
    // answer must be identical whether the Ticket is absent or simply not
    // theirs (BR-12), and that is the code for both.
    expect(foreign.body.error.code).toBe("TICKET_NOT_FOUND");

    // Reference data is still open to a signed-in Requester (Lab 2 §3).
    for (const url of ["/api/categories", "/api/related-systems"]) {
      const res = await request(app).get(url).set("Cookie", cookie);
      expect(res.status, url).toBe(200);
      expect(Array.isArray(res.body.data), url).toBe(true);
    }

    // The attachment rules, which this row has always promised and which were
    // not actually exercised here until the Issue #51 audit read the labsheet
    // §8.5 bullet "attachments ... remains correct" against the suite. Each is
    // a distinct code in lab-02/api-spec.md §5, and a migration that broke the
    // upload path would answer 500 rather than any of them.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = (ticketId: number, filename: string, contentType: string, body: Buffer) =>
      request(app)
        .post(`/api/tickets/${ticketId}/attachments`)
        .set("Cookie", cookie)
        .attach("file", body, { filename, contentType });

    // BR-26: a type outside JPG/JPEG/PNG/WEBP/PDF.
    const badType = await upload(mine.id, "notes.txt", "text/plain", Buffer.from("plain text"));
    expect(badType.status, JSON.stringify(badType.body)).toBe(415);
    expect(badType.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");

    // BR-27: over 5 MB.
    const tooBig = await upload(mine.id, "huge.png", "image/png", Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(tooBig.status, JSON.stringify(tooBig.body)).toBe(413);
    expect(tooBig.body.error.code).toBe("FILE_TOO_LARGE");

    // The success case for the same rule, because Issue #47 shipped three
    // defects past a suite that tested only refusals.
    const accepted = await upload(mine.id, "evidence.png", "image/png", png);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body.data.originalFilename).toBe("evidence.png");

    // BR-11 again, on the attachment rather than the Ticket: somebody else's
    // Ticket answers 404 to an upload, not 403.
    const foreignUpload = await upload(theirs.id, "evidence.png", "image/png", png);
    expect(foreignUpload.status).toBe(404);
    expect(foreignUpload.body.error.code).toBe("TICKET_NOT_FOUND");

    // BR-30: a soft-removed attachment is never downloadable, not even by its
    // owner - the one case where an owned resource still answers 404.
    const attachmentId = accepted.body.data.id as number;
    const removal = { removalReason: "Uploaded the wrong screenshot by mistake" };
    const removed = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set("Cookie", cookie)
      .send(removal);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    // BR-31 of Lab 2: the reason is required, and removal is not repeatable.
    const noReason = await request(app).delete(`/api/attachments/${attachmentId}`).set("Cookie", cookie).send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.field).toBe("removalReason");
    const again = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set("Cookie", cookie)
      .send(removal);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_REMOVED");
    const download = await request(app).get(`/api/attachments/${attachmentId}/download`).set("Cookie", cookie);
    expect(download.status).toBe(404);
    expect(download.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
    // BR-29: its metadata stays readable, which is the distinction.
    const metadata = await request(app).get(`/api/attachments/${attachmentId}`).set("Cookie", cookie);
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.removedAt).not.toBeNull();
  });

  it("MIG-08 / AC-28, BR-32: the Lab 3 contract still answers as lab-03/api-spec.md describes", async () => {
    // Identity comes from the session, and no session is 401 (not 400, which
    // is what Lab 2's header-based contract answered).
    const anonymous = await request(app).get("/api/tickets");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("UNAUTHENTICATED");

    // The queue is staff-only, and a Requester is refused by the server.
    const requesterCookie = await signIn(REQUESTER);
    const refused = await request(app).get("/api/staff/tickets").set("Cookie", requesterCookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("FORBIDDEN");

    const queue = await request(app).get("/api/staff/tickets?pageSize=10").set("Cookie", staffCookie);
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(queue.body.pagination.pageSize).toBe(10);

    // User management is the Administrator's, not IT Staff's.
    const users = await request(app).get("/api/users").set("Cookie", staffCookie);
    expect(users.status).toBe(403);

    // Internal Notes never reach a Requester, which is Lab 3's sharpest rule.
    const noted = await prisma.internalNote.findFirst({ include: { ticket: true } });
    if (noted) {
      const asRequester = await signIn(REQUESTER);
      const detail = await request(app).get(`/api/tickets/${noted.ticketId}/notes`).set("Cookie", asRequester);
      expect([403, 404], `a Requester asked for internal notes and got ${detail.status}`).toContain(detail.status);
    }
  });
});
