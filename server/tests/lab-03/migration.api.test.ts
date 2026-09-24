import { execSync } from "node:child_process";
import request from "supertest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";

// tests.md MIG-01..05 — the Lab 2 to Lab 3 migration, against docs/lab-03/
// specification.md §7 and AC-08.
//
// These run on a scratch database this file creates and drops, not on the
// developer's database. The reason matters: the only way to prove a migration
// preserves data is to have data in the "before" state and then migrate it,
// and the developer's database is already migrated. Asserting its current
// contents would prove nothing on a fresh clone, where those same rows come
// from the seed instead.
//
// So the suite replays the real migration files in order, pauses after the
// last Lab 2 one to insert Lab 2-shaped rows, and then applies the two Lab 3
// migrations to them. What is under test is the SQL that actually ships.
//
// MIG-09 and MIG-10 cover the seed. They run at the bottom of this file against
// a second scratch database, migrated and seeded from nothing, so what they
// assert is what the seed produces rather than whatever the developer database
// has become since it was last seeded.
//
// MIG-06 is at the bottom of this file. MIG-07 (the header is ignored) and
// MIG-08 (every Lab 2 endpoint under a session) are asserted where they
// belong — inside the Lab 2 suites themselves, which now sign in rather than
// send a header, and whose passing is the regression evidence.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../prisma/migrations");
const SCRATCH_DB = "toktickit_migration_test";

// Where Lab 2 ends and Lab 3 begins, found by what a migration *does* rather
// than by its name. Naming the boundary migration would split at the wrong
// point, silently, the moment a migration is inserted before it — and a
// migration test that quietly stops testing the migration is worse than none.
const LAB3_MARKERS = ['RENAME TO "User"', '"CurrentStatus" ADD VALUE'];

function firstLab3Index(names: string[]): number {
  return names.findIndex((name) => {
    const sql = migrationSql(name);
    return LAB3_MARKERS.some((marker) => sql.includes(marker));
  });
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function migrationSql(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

/**
 * Splits a migration file into statements.
 *
 * The migrations in this project are plain statements with `--` comments and
 * no dollar-quoted bodies, so splitting on `;` is sufficient; a function body
 * would need a real parser, and if one is ever added this will need revisiting.
 */
function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function scratchUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

let db: PrismaClient;

beforeAll(async () => {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);
  } finally {
    await admin.$disconnect();
  }

  db = new PrismaClient({ datasources: { db: { url: scratchUrl() } } });

  const names = migrationNames();
  const cutoff = firstLab3Index(names);
  expect(cutoff, "prisma/migrations should contain a Lab 3 migration").toBeGreaterThan(0);

  // --- the database as Lab 2 left it ---------------------------------------
  for (const name of names.slice(0, cutoff)) {
    for (const statement of statementsOf(migrationSql(name))) {
      await db.$executeRawUnsafe(statement);
    }
  }

  // The split is only meaningful if this really is the Lab 2 shape: the
  // Requester table present, no User table, and a single-value status enum.
  // Asserting it here turns a mis-split into a failure in setup rather than a
  // test that passes while proving nothing.
  const before = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const beforeNames = before.map((t) => t.tablename);
  expect(beforeNames).toContain("Requester");
  expect(beforeNames).not.toContain("User");

  const beforeStatuses = await db.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'CurrentStatus'`,
  );
  expect(beforeStatuses.map((l) => l.enumlabel)).toEqual(["NEW"]);

  // Lab 2 rows: a Requester with a Ticket and an Attachment, plus the
  // reference data they point at. Written as raw SQL because the generated
  // Prisma client describes the Lab 3 schema, not this one.
  await db.$executeRawUnsafe(
    `INSERT INTO "Category" (id, name, "isActive") VALUES (1, 'Hardware', true)`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "RelatedSystem" (id, name, "isActive") VALUES (1, 'Printer', true)`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Requester" (id, name, email, "isActive") VALUES
       (1, 'Migrated Active', 'Migrated.Active@Example.EDU', true),
       (2, 'Migrated Inactive', 'migrated.inactive@example.edu', false)`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Ticket" (id, "ticketNumber", "requesterId", "categoryId", "relatedSystemId",
       summary, description, "requestedPriority", "itPriority", "currentStatus", "updatedAt")
     VALUES
       (1, 'TKT-2026-000001', 1, 1, 1, 'Printer jams', 'It jams on every job.', 'HIGH', NULL, 'NEW', now()),
       (2, 'TKT-2026-000002', 1, 1, 1, 'Printer is slow', 'It takes minutes.', 'LOW', NULL, 'NEW', now())`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "Attachment" (id, "ticketId", "originalFilename", "storedFilename", "mimeType", "sizeBytes")
     VALUES (1, 1, 'photo.png', 'stored-abc.png', 'image/png', 1234)`,
  );

  // --- now apply Lab 3 ------------------------------------------------------
  for (const name of names.slice(cutoff)) {
    for (const statement of statementsOf(migrationSql(name))) {
      await db.$executeRawUnsafe(statement);
    }
  }
});

afterAll(async () => {
  await db?.$disconnect();
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
  } finally {
    await admin.$disconnect();
  }
});

describe("Lab 2 to Lab 3 migration", () => {
  it("MIG-01 / AC-08: the Requester table became User — renamed, not dropped and recreated", async () => {
    const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = tables.map((t) => t.tablename);

    expect(names).toContain("User");
    expect(names).not.toContain("Requester");

    // The rows are the same rows: same ids, same names. A drop-and-create
    // would have produced an empty table, which is the failure this guards.
    const users = await db.$queryRawUnsafe<{ id: number; name: string }[]>(
      `SELECT id, name FROM "User" ORDER BY id`,
    );
    expect(users).toEqual([
      { id: 1, name: "Migrated Active" },
      { id: 2, name: "Migrated Inactive" },
    ]);
  });

  it("MIG-02 / AC-08: every Ticket and Attachment survives, still owned by its original Requester", async () => {
    const tickets = await db.$queryRawUnsafe<{ id: number; ticketNumber: string; requesterId: number }[]>(
      `SELECT id, "ticketNumber", "requesterId" FROM "Ticket" ORDER BY id`,
    );
    expect(tickets).toEqual([
      { id: 1, ticketNumber: "TKT-2026-000001", requesterId: 1 },
      { id: 2, ticketNumber: "TKT-2026-000002", requesterId: 1 },
    ]);

    const attachments = await db.$queryRawUnsafe<{ id: number; ticketId: number; originalFilename: string }[]>(
      `SELECT id, "ticketId", "originalFilename" FROM "Attachment" ORDER BY id`,
    );
    expect(attachments).toEqual([{ id: 1, ticketId: 1, originalFilename: "photo.png" }]);

    // The foreign key survived the rename rather than being dropped and
    // re-added, so it still points at the renamed table.
    const orphans = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM "Ticket" t LEFT JOIN "User" u ON u.id = t."requesterId" WHERE u.id IS NULL`,
    );
    expect(Number(orphans[0].count)).toBe(0);
  });

  it("MIG-03 / AC-08, BR-36: migrated accounts are Requesters that must change an initial password, with normalised emails", async () => {
    const users = await db.$queryRawUnsafe<
      { id: number; email: string; role: string; isActive: boolean; mustChangePassword: boolean; passwordHash: string }[]
    >(`SELECT id, email, role, "isActive", "mustChangePassword", "passwordHash" FROM "User" ORDER BY id`);

    for (const user of users) {
      expect(user.role).toBe("REQUESTER");
      expect(user.mustChangePassword).toBe(true);
      expect(user.passwordHash.startsWith("$2")).toBe(true);
      expect(user.email).toBe(user.email.trim().toLowerCase());
    }

    // The mixed-case address the Lab 2 row carried was lower-cased in place.
    expect(users[0].email).toBe("migrated.active@example.edu");
    // Activation state is migrated, not reset.
    expect(users.map((u) => u.isActive)).toEqual([true, false]);
  });

  it("MIG-04 / BR-29: IT Priority is backfilled from Requested Priority on every existing Ticket", async () => {
    const tickets = await db.$queryRawUnsafe<{ requestedPriority: string; itPriority: string | null }[]>(
      `SELECT "requestedPriority", "itPriority" FROM "Ticket" ORDER BY id`,
    );

    expect(tickets.every((t) => t.itPriority !== null)).toBe(true);
    expect(tickets.every((t) => t.itPriority === t.requestedPriority)).toBe(true);
  });

  it("MIG-05 / BR-27: migrated Tickets are unassigned and carry no resolution signal", async () => {
    const tickets = await db.$queryRawUnsafe<{ ownerId: number | null; requesterResolvedAt: Date | null }[]>(
      `SELECT "ownerId", "requesterResolvedAt" FROM "Ticket"`,
    );

    expect(tickets.every((t) => t.ownerId === null)).toBe(true);
    expect(tickets.every((t) => t.requesterResolvedAt === null)).toBe(true);
  });

  it("MIG-01: the eight Ticket statuses exist after migration, and the Lab 2 value is untouched", async () => {
    const labels = await db.$queryRawUnsafe<{ enumlabel: string }[]>(
      `SELECT enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'CurrentStatus' ORDER BY e.enumsortorder`,
    );

    expect(labels.map((l) => l.enumlabel)).toEqual([
      "NEW",
      "OPEN",
      "IN_PROGRESS",
      "WAITING_FOR_REQUESTER",
      "RESOLVED",
      "CLOSED",
      "REOPENED",
      "CANCELLED",
    ]);

    const statuses = await db.$queryRawUnsafe<{ currentStatus: string }[]>(
      `SELECT "currentStatus" FROM "Ticket"`,
    );
    expect(statuses.every((s) => s.currentStatus === "NEW")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The seed (handout §5.3, BR-45), against a database of its own.
//
// These used to run against the developer database, which made them assert
// state the application itself changes: once IT Staff can claim a Ticket or
// move its status (Issue #32), or an Administrator can deactivate an account
// (Issue #33), a seeded row stops looking seeded — and the seed deliberately
// leaves a changed row alone. A database migrated and seeded from nothing is
// the only place "the seed produces this" can be checked honestly.
//
// It is not the migration suite's scratch database: that one holds Lab 2-shaped
// Tickets numbered without the counter, and the seed's first number would
// collide with them.
// ---------------------------------------------------------------------------
const SEED_DB = "toktickit_seed_test";

function seedUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${SEED_DB}`;
  return url.toString();
}

describe("seed data", () => {
  let prisma: PrismaClient;
  const onSeedDb = {
    cwd: path.resolve(import.meta.dirname, "../.."),
    stdio: "pipe" as const,
    env: { ...process.env, DATABASE_URL: seedUrl() },
  };
  const runSeed = () => execSync("npx tsx prisma/seed.ts", onSeedDb);

  beforeAll(async () => {
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SEED_DB}"`);
      await admin.$executeRawUnsafe(`CREATE DATABASE "${SEED_DB}"`);
    } finally {
      await admin.$disconnect();
    }

    // The shipped migrations, applied the way a fresh clone applies them, then
    // the seed once. Every case below describes that state.
    execSync("npx prisma migrate deploy", onSeedDb);
    runSeed();
    prisma = new PrismaClient({ datasources: { db: { url: seedUrl() } } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl() } } });
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SEED_DB}"`);
    } finally {
      await admin.$disconnect();
    }
  });

  it("MIG-10 / BR-45: seeds the account mix the handout requires", async () => {
    const counts = await prisma.user.groupBy({
      by: ["role", "isActive"],
      _count: true,
    });

    const count = (role: string, isActive: boolean) =>
      counts.find((c) => c.role === role && c.isActive === isActive)?._count ?? 0;

    expect(count("REQUESTER", true)).toBeGreaterThanOrEqual(4);
    expect(count("REQUESTER", false)).toBeGreaterThanOrEqual(1);
    expect(count("IT_STAFF", true)).toBeGreaterThanOrEqual(3);
    expect(count("IT_STAFF", false)).toBeGreaterThanOrEqual(1);
    expect(count("ADMINISTRATOR", true)).toBeGreaterThanOrEqual(1);
  });

  it("MIG-10 / BR-26, BR-27: seeds Tickets across Requesters, statuses, priorities and ownership", async () => {
    const tickets = await prisma.ticket.findMany({
      where: { description: { contains: "[seed]" } },
      include: { owner: { select: { isActive: true } } },
    });

    // specification.md §7: enough spread that every queue filter and sort has
    // something to tell apart.
    expect(new Set(tickets.map((t) => t.currentStatus))).toEqual(
      new Set(["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]),
    );
    expect(new Set(tickets.map((t) => t.requestedPriority)).size).toBe(3);
    expect(new Set(tickets.map((t) => t.itPriority)).size).toBe(3);
    expect(new Set(tickets.map((t) => t.requesterId)).size).toBeGreaterThanOrEqual(2);
    expect(tickets.some((t) => t.ownerId === null)).toBe(true);
    expect(tickets.some((t) => t.ownerId !== null)).toBe(true);

    // A Lab 3 Ticket always has an IT Priority (BR-29) — only migrated Lab 2
    // rows may lack one.
    expect(tickets.every((t) => t.itPriority !== null)).toBe(true);
    // BR-27: a New Ticket has not been claimed yet.
    expect(tickets.filter((t) => t.currentStatus === "NEW").every((t) => t.ownerId === null)).toBe(true);
    // BR-26: an owner stays on the record after their account is deactivated,
    // so the queue has to be able to show one.
    expect(tickets.some((t) => t.owner !== null && !t.owner.isActive)).toBe(true);
  });

  it("MIG-10 / BR-04, BR-20: seeds example Public Comments and Internal Notes, notes only ever by staff", async () => {
    const onSeeded = { ticket: { description: { contains: "[seed]" } } };
    const comments = await prisma.publicComment.findMany({
      where: onSeeded,
      include: { author: { select: { id: true, role: true } }, ticket: { select: { requesterId: true } } },
    });
    const notes = await prisma.internalNote.findMany({
      where: onSeeded,
      include: { author: { select: { role: true } } },
    });

    expect(comments.length).toBeGreaterThan(0);
    expect(notes.length).toBeGreaterThan(0);

    // A Public Comment is written by the Ticket's own Requester or by staff —
    // never by some other Requester, which BR-16 would not allow.
    for (const c of comments) {
      const byOwner = c.author.id === c.ticket.requesterId;
      expect(byOwner || c.author.role !== "REQUESTER").toBe(true);
    }
    // Both kinds of reply appear, so the seeded data can show a conversation.
    expect(comments.some((c) => c.author.role === "REQUESTER")).toBe(true);
    expect(comments.some((c) => c.author.role !== "REQUESTER")).toBe(true);

    // An Internal Note is never written by a Requester (BR-04, BR-20).
    expect(notes.every((n) => n.author.role !== "REQUESTER")).toBe(true);
  });

  it("MIG-10 / BR-07: no seeded account stores anything but a hash", async () => {
    const users = await prisma.user.findMany({ select: { email: true, passwordHash: true } });

    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(user.passwordHash.startsWith("$2")).toBe(true);
      expect(user.passwordHash).not.toContain("ChangeMe");
      expect(user.email).toBe(user.email.trim().toLowerCase());
    }
  });

  it("MIG-10: at least one seeded account is left needing a password change, so the first-login flow can be demonstrated", async () => {
    // BR-02 and AC-02 are demonstrable on a fresh database without an
    // Administrator having to reset somebody first.
    expect(await prisma.user.count({ where: { mustChangePassword: true } })).toBeGreaterThanOrEqual(1);
  });

  it("MIG-06 / AC-25: GET /api/requesters no longer exists", async () => {
    // It existed only to fill the Development Requester selector, and it
    // handed a list of real people to any caller with no session at all.
    // Removed in Issue #30 with the selector (api-spec.md §6).
    const response = await request(app).get("/api/requesters");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    // A deleted route falls through to the unmatched-path handler, so it must
    // still answer in the error envelope rather than Express's HTML page.
    expect(response.headers["content-type"]).toMatch(/application\/json/);
  });

  it("MIG-09 / BR-45: running the seed twice changes nothing", async () => {
    // The block has already seeded once, so this is the second run — the one
    // an idempotency claim is actually about.
    const before = {
      users: await prisma.user.count(),
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      tickets: await prisma.ticket.count(),
      publicComments: await prisma.publicComment.count(),
      internalNotes: await prisma.internalNote.count(),
    };

    runSeed();

    expect({
      users: await prisma.user.count(),
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      tickets: await prisma.ticket.count(),
      publicComments: await prisma.publicComment.count(),
      internalNotes: await prisma.internalNote.count(),
    }).toEqual(before);

    // Idempotent must also mean "does not rewrite what is there": a re-seed
    // that reset mustChangePassword would destroy the migration evidence
    // MIG-03 depends on.
    const emails = await prisma.user.findMany({ select: { email: true } });
    expect(new Set(emails.map((e) => e.email)).size).toBe(emails.length);

    const seeded = await prisma.ticket.findMany({
      where: { description: { contains: "[seed]" } },
      select: { summary: true },
    });
    expect(new Set(seeded.map((t) => t.summary)).size).toBe(seeded.length);
  });
});
