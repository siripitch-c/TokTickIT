import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";

// tests.md API-LIST-01..11; specification.md FR-05..FR-08, BR-11..BR-18;
// api-spec.md §4 (GET /api/tickets).
// Requires a migrated + seeded test database (see README §Testing).

const prisma = getPrisma();

let ownerId = 0;
let otherId = 0;
let categoryA = 0;
let categoryB = 0;
let systemId = 0;

// AC-09's shape exactly: one Requester with many tickets, another with a few,
// so "only mine" is a claim the data can actually falsify.
const OWNER_TICKETS = 12;
const OTHER_TICKETS = 3;

const list = (query = "", id: number | null = ownerId) => {
  const req = request(app).get(`/api/tickets${query}`);
  if (id !== null) req.set("X-Requester-Id", String(id));
  return req;
};

const numbersOf = (body: { data: { ticketNumber: string }[] }) => body.data.map((t) => t.ticketNumber);

beforeAll(async () => {
  const owner = await prisma.requester.upsert({
    where: { email: "my-tickets.owner@test.invalid" },
    update: { isActive: true },
    create: { name: "My Tickets Owner", email: "my-tickets.owner@test.invalid" },
  });
  const other = await prisma.requester.upsert({
    where: { email: "my-tickets.other@test.invalid" },
    update: { isActive: true },
    create: { name: "My Tickets Other", email: "my-tickets.other@test.invalid" },
  });
  ownerId = owner.id;
  otherId = other.id;

  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { id: "asc" }, take: 2 });
  const system = await prisma.relatedSystem.findFirst({ where: { isActive: true } });
  if (categories.length < 2 || !system) throw new Error("Seed data missing — run npm run prisma:seed");
  categoryA = categories[0].id;
  categoryB = categories[1].id;
  systemId = system.id;

  await prisma.ticket.deleteMany({ where: { requesterId: { in: [ownerId, otherId] } } });

  // Fixed timestamps rather than "now", so ordering assertions do not depend
  // on how fast the rows were inserted. Tickets 10 and 11 deliberately share a
  // createdAt to exercise BR-15's secondary sort.
  const base = new Date("2026-04-01T00:00:00.000Z").getTime();
  const owned = Array.from({ length: OWNER_TICKETS }, (_, i) => {
    const n = i + 1;
    const tied = n === 10 || n === 11;
    return {
      ticketNumber: `TKT-2099-${String(n).padStart(6, "0")}`,
      requesterId: ownerId,
      categoryId: n % 2 === 0 ? categoryB : categoryA,
      relatedSystemId: systemId,
      summary: n <= 4 ? `VPN keeps dropping ${n}` : `Printer jam on floor ${n}`,
      description: `Fixture ticket number ${n} for the My Tickets list tests.`,
      requestedPriority: (["LOW", "MEDIUM", "HIGH"] as const)[n % 3],
      createdAt: new Date(tied ? base : base + n * 86_400_000),
    };
  });

  const foreign = Array.from({ length: OTHER_TICKETS }, (_, i) => ({
    ticketNumber: `TKT-2098-${String(i + 1).padStart(6, "0")}`,
    requesterId: otherId,
    categoryId: categoryA,
    relatedSystemId: systemId,
    summary: `VPN keeps dropping for somebody else ${i + 1}`,
    description: "Fixture ticket belonging to a different Requester.",
    requestedPriority: "HIGH" as const,
    createdAt: new Date(base),
  }));

  await prisma.ticket.createMany({ data: [...owned, ...foreign] });
});

afterAll(async () => {
  const ids = [ownerId, otherId];
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  await prisma.requester.deleteMany({ where: { id: { in: ids } } });
});

describe("GET /api/tickets", () => {
  it("API-LIST-01: returns only the caller's tickets, never another Requester's (BR-11, AC-09)", async () => {
    const response = await list("?pageSize=50");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(OWNER_TICKETS);
    expect(response.body.pagination.totalItems).toBe(OWNER_TICKETS);
    for (const ticket of response.body.data as { requesterId: number }[]) {
      expect(ticket.requesterId).toBe(ownerId);
    }

    // The other Requester sees their own three and nothing of the owner's,
    // even though both sets match the same search terms.
    const foreign = await list("?pageSize=50", otherId);
    expect(foreign.body.data).toHaveLength(OTHER_TICKETS);
    expect(numbersOf(foreign.body).every((n) => n.startsWith("TKT-2098-"))).toBe(true);
  });

  it("API-LIST-01: a list row carries the ticket fields but no attachments array (api-spec.md §4)", async () => {
    const response = await list("?pageSize=10");
    const row = response.body.data[0];

    expect(Object.keys(row).sort()).toEqual([
      "categoryId",
      "createdAt",
      "currentStatus",
      "description",
      "id",
      "itPriority",
      "relatedSystemId",
      "requestedPriority",
      "requesterId",
      "summary",
      "ticketNumber",
      "updatedAt",
    ]);
    expect(response.body.pagination).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: OWNER_TICKETS,
      totalPages: 2,
    });
  });

  it("API-LIST-02: search matches ticket number and summary, case-insensitively (BR-13)", async () => {
    // Partial ticket number.
    const byNumber = await list("?search=2099-000003&pageSize=50");
    expect(numbersOf(byNumber.body)).toEqual(["TKT-2099-000003"]);

    // Partial summary, lower case against mixed-case content.
    const bySummary = await list("?search=vpn&pageSize=50");
    expect(bySummary.body.data).toHaveLength(4);
    for (const t of bySummary.body.data as { summary: string }[]) {
      expect(t.summary.toLowerCase()).toContain("vpn");
    }

    // Upper case gives the same answer.
    const upper = await list("?search=VPN&pageSize=50");
    expect(numbersOf(upper.body).sort()).toEqual(numbersOf(bySummary.body).sort());

    // Description is deliberately not searched (specification.md §11).
    const byDescription = await list("?search=Fixture&pageSize=50");
    expect(byDescription.body.data).toHaveLength(0);
  });

  it("API-LIST-02b: LIKE wildcards in the search term are matched literally (BR-13)", async () => {
    // "%" and "_" are wildcards to LIKE. Passed through unescaped, searching
    // for "%" returns every ticket and "_" matches any single character, so a
    // Requester looking for "50%" or "TKT_2026" gets answers that have nothing
    // to do with what they typed.
    const extras = await prisma.ticket.createManyAndReturn({
      data: [
        {
          ticketNumber: "TKT-2097-000001",
          requesterId: ownerId,
          categoryId: categoryA,
          relatedSystemId: systemId,
          summary: "Wi-Fi drops with 50% packet loss",
          description: "Fixture for wildcard escaping.",
          requestedPriority: "LOW" as const,
        },
        {
          ticketNumber: "TKT-2097-000002",
          requesterId: ownerId,
          categoryId: categoryA,
          relatedSystemId: systemId,
          summary: "Report file named month_end is missing",
          description: "Fixture for wildcard escaping.",
          requestedPriority: "LOW" as const,
        },
      ],
    });

    try {
      const percent = await list("?search=%25&pageSize=50");
      expect(numbersOf(percent.body)).toEqual(["TKT-2097-000001"]);

      const underscore = await list("?search=_&pageSize=50");
      expect(numbersOf(underscore.body)).toEqual(["TKT-2097-000002"]);

      // A backslash is LIKE's escape character; it must not swallow the
      // character that follows it either.
      const backslash = await list("?search=%5C&pageSize=50");
      expect(backslash.body.data).toHaveLength(0);

      // The ordinary case still works.
      const literal = await list("?search=50%25%20packet&pageSize=50");
      expect(numbersOf(literal.body)).toEqual(["TKT-2097-000001"]);
    } finally {
      await prisma.ticket.deleteMany({ where: { id: { in: extras.map((t) => t.id) } } });
    }
  });

  it("API-LIST-03..06: each filter narrows the list, and filters combine with AND (BR-14)", async () => {
    const byCategory = await list(`?category=${categoryA}&pageSize=50`);
    expect(byCategory.body.data.length).toBeGreaterThan(0);
    for (const t of byCategory.body.data as { categoryId: number }[]) {
      expect(t.categoryId).toBe(categoryA);
    }

    const byPriority = await list("?requestedPriority=HIGH&pageSize=50");
    for (const t of byPriority.body.data as { requestedPriority: string }[]) {
      expect(t.requestedPriority).toBe("HIGH");
    }

    const byStatus = await list("?status=NEW&pageSize=50");
    expect(byStatus.body.data).toHaveLength(OWNER_TICKETS);

    // Every Lab 2 ticket has itPriority unset (BR-02), so filtering on any of
    // the three values must return nothing — the unset ones are not swept in.
    for (const value of ["LOW", "MEDIUM", "HIGH"]) {
      const byItPriority = await list(`?itPriority=${value}&pageSize=50`);
      expect(byItPriority.body.data).toHaveLength(0);
    }

    // AND, not OR: the combination is the intersection of the two filters.
    const combined = await list(`?category=${categoryA}&requestedPriority=HIGH&pageSize=50`);
    for (const t of combined.body.data as { categoryId: number; requestedPriority: string }[]) {
      expect(t.categoryId).toBe(categoryA);
      expect(t.requestedPriority).toBe("HIGH");
    }
    expect(combined.body.data.length).toBeLessThanOrEqual(byCategory.body.data.length);
    expect(combined.body.data.length).toBeLessThanOrEqual(byPriority.body.data.length);
  });

  it("API-LIST-07: ties on the sort field break by ticketNumber descending (BR-15)", async () => {
    const response = await list("?pageSize=50");

    // Default sort is createdAt desc; tickets 10 and 11 share a timestamp.
    const tied = numbersOf(response.body).filter((n) => ["TKT-2099-000010", "TKT-2099-000011"].includes(n));
    expect(tied).toEqual(["TKT-2099-000011", "TKT-2099-000010"]);

    // And the ordering is stable across repeated requests, not incidental.
    const again = await list("?pageSize=50");
    expect(numbersOf(again.body)).toEqual(numbersOf(response.body));
  });

  it("API-LIST-08: the sort field and direction can both be changed (AC-15)", async () => {
    const numberAsc = await list("?sortBy=ticketNumber&sortDir=asc&pageSize=50");
    expect(numbersOf(numberAsc.body)[0]).toBe("TKT-2099-000001");

    const numberDesc = await list("?sortBy=ticketNumber&sortDir=desc&pageSize=50");
    expect(numbersOf(numberDesc.body)).toEqual([...numbersOf(numberAsc.body)].reverse());

    const createdAsc = await list("?sortBy=createdAt&sortDir=asc&pageSize=50");
    const createdDesc = await list("?sortBy=createdAt&sortDir=desc&pageSize=50");
    expect(numbersOf(createdAsc.body)).not.toEqual(numbersOf(createdDesc.body));

    // Default with no parameters equals createdAt desc (BR-15).
    const defaulted = await list("?pageSize=50");
    expect(numbersOf(defaulted.body)).toEqual(numbersOf(createdDesc.body));

    const updated = await list("?sortBy=updatedAt&sortDir=asc&pageSize=50");
    expect(updated.status).toBe(200);
    expect(updated.body.data).toHaveLength(OWNER_TICKETS);
  });

  it("API-LIST-09: page sizes 10/25/50 are honoured and anything else falls back to 10 (BR-16)", async () => {
    for (const size of [10, 25, 50]) {
      const response = await list(`?pageSize=${size}`);
      expect(response.body.pagination.pageSize).toBe(size);
      expect(response.body.data.length).toBe(Math.min(size, OWNER_TICKETS));
    }

    for (const bad of ["999", "abc", "0", "-5", "11", ""]) {
      const response = await list(`?pageSize=${bad}`);
      expect(response.status, `pageSize=${bad}`).toBe(200);
      expect(response.body.pagination.pageSize, `pageSize=${bad}`).toBe(10);
    }
  });

  it("API-LIST-10: a page past the end is an empty list, not an error (BR-17)", async () => {
    const response = await list("?page=99&pageSize=10");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({
      page: 99,
      pageSize: 10,
      totalItems: OWNER_TICKETS,
      totalPages: 2,
    });

    // The two real pages between them hold every ticket exactly once.
    const first = await list("?page=1&pageSize=10");
    const second = await list("?page=2&pageSize=10");
    expect(first.body.data).toHaveLength(10);
    expect(second.body.data).toHaveLength(2);
    expect(new Set([...numbersOf(first.body), ...numbersOf(second.body)]).size).toBe(OWNER_TICKETS);
  });

  it("API-LIST-11: every unusable query parameter is ignored, never a 400 (BR-18)", async () => {
    const queries = [
      "?unknownFilter=whatever",
      "?requestedPriority=URGENT",
      "?status=CLOSED",
      "?itPriority=nonsense",
      "?category=not-a-number",
      "?category=999999",
      "?page=abc",
      "?page=-3",
      "?page=0",
      "?sortBy=summary",
      "?sortBy=; DROP TABLE tickets",
      "?sortDir=sideways",
      "?search=",
      "?page=abc&pageSize=xyz&sortBy=nope&sortDir=nope&requestedPriority=nope",
    ];

    for (const query of queries) {
      const response = await list(query);
      expect(response.status, query).toBe(200);
      expect(response.body.pagination.page, query).toBeGreaterThanOrEqual(1);
    }

    // An unrecognised sort field falls back to the documented default rather
    // than to an arbitrary database ordering.
    const unknownSort = await list("?sortBy=summary&pageSize=50");
    const defaulted = await list("?pageSize=50");
    expect(numbersOf(unknownSort.body)).toEqual(numbersOf(defaulted.body));

    // A category that matches nothing is a filter that matched nothing, not a
    // rejected request.
    const noMatch = await list("?category=999999");
    expect(noMatch.body.data).toEqual([]);
    expect(noMatch.body.pagination.totalItems).toBe(0);
  });

  it("requires a usable X-Requester-Id header (api-spec.md §1)", async () => {
    expect((await list("", null)).status).toBe(400);

    for (const bad of ["abc", "0", "-1", "999999", "1e21"]) {
      const response = await request(app).get("/api/tickets").set("X-Requester-Id", bad);
      expect(response.status, `header ${bad}`).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
