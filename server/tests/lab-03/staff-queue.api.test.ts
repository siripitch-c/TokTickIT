import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { CurrentStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { upsertTestUser } from "../support/users.js";

// tests.md API-QUEUE-01..12; specification.md FR-13, FR-16, BR-25..BR-27,
// BR-40, AC-09, AC-28; api-spec.md §7.
//
// The queue lists every Ticket in the database — the seed, the Lab 2 rows and
// other suites' fixtures included — so a case that looked at the whole list
// would be asserting whatever happened to be in the developer database. Every
// fixture summary therefore carries TOKEN, a string no real summary contains,
// and each case scopes itself with it. Where a case is *about* search, the
// terms it uses are unique to these fixtures for the same reason.
//
// The refusal for a Requester (API-AUTHZ-02) lives in
// `authorization.api.test.ts`, with the rest of the role gate.

const prisma = getPrisma();

const TOKEN = "QZX31";
const DESCRIPTION_ONLY = "DESCONLY31";
const NUMBER_PREFIX = "TKT-2093-";

const REQUESTER_ONE = "queue.requester.one@test.invalid";
const REQUESTER_TWO = "queue.requester.two@test.invalid";
const STAFF = "queue.staff@test.invalid";
const STAFF_GONE = "queue.staff.gone@test.invalid";
const ADMIN = "queue.admin@test.invalid";
const EMAILS = [REQUESTER_ONE, REQUESTER_TWO, STAFF, STAFF_GONE, ADMIN];

let requesterOneId = 0;
let requesterTwoId = 0;
let staffId = 0;
let goneId = 0;
let adminId = 0;
let staffCookie = "";
let adminCookie = "";
let categoryA = 0;
let categoryB = 0;

type Priority = "LOW" | "MEDIUM" | "HIGH";
type Fixture = {
  n: number;
  requester: "one" | "two";
  category: "A" | "B";
  requestedPriority: Priority;
  itPriority: Priority | null;
  status: CurrentStatus;
  owner: "staff" | "gone" | null;
  summary: string;
  createdHours: number;
  updatedHours: number;
};

// Ten Tickets, chosen so each assertion below has something to falsify: every
// status, every priority on both fields, three kinds of ownership, one null IT
// Priority (a migrated Lab 2 row) and one tie on Last Updated (7 and 8).
const FIXTURES: Fixture[] = [
  { n: 1, requester: "one", category: "A", requestedPriority: "LOW", itPriority: "LOW", status: "NEW", owner: null, summary: `${TOKEN} Printer jam on floor two`, createdHours: 1, updatedHours: 10 },
  { n: 2, requester: "two", category: "B", requestedPriority: "MEDIUM", itPriority: "HIGH", status: "OPEN", owner: "staff", summary: `${TOKEN} VPN drops at night`, createdHours: 2, updatedHours: 20 },
  { n: 3, requester: "one", category: "A", requestedPriority: "HIGH", itPriority: "MEDIUM", status: "IN_PROGRESS", owner: "staff", summary: `${TOKEN} Laptop will not charge`, createdHours: 3, updatedHours: 30 },
  { n: 4, requester: "two", category: "B", requestedPriority: "LOW", itPriority: "HIGH", status: "WAITING_FOR_REQUESTER", owner: null, summary: `${TOKEN} printer toner warning`, createdHours: 4, updatedHours: 40 },
  { n: 5, requester: "one", category: "A", requestedPriority: "MEDIUM", itPriority: "LOW", status: "RESOLVED", owner: "gone", summary: `${TOKEN} Email quota exceeded`, createdHours: 5, updatedHours: 50 },
  { n: 6, requester: "two", category: "B", requestedPriority: "HIGH", itPriority: "MEDIUM", status: "CLOSED", owner: "staff", summary: `${TOKEN} Wi-Fi certificate prompt`, createdHours: 6, updatedHours: 60 },
  { n: 7, requester: "one", category: "A", requestedPriority: "LOW", itPriority: "HIGH", status: "REOPENED", owner: null, summary: `${TOKEN} Monitor flicker`, createdHours: 7, updatedHours: 70 },
  { n: 8, requester: "two", category: "B", requestedPriority: "MEDIUM", itPriority: "LOW", status: "CANCELLED", owner: "staff", summary: `${TOKEN} Licence request`, createdHours: 8, updatedHours: 70 },
  { n: 9, requester: "one", category: "A", requestedPriority: "HIGH", itPriority: "MEDIUM", status: "NEW", owner: null, summary: `${TOKEN} Keyboard keys stuck`, createdHours: 9, updatedHours: 90 },
  { n: 10, requester: "two", category: "B", requestedPriority: "HIGH", itPriority: null, status: "OPEN", owner: null, summary: `${TOKEN} Migrated with no IT priority`, createdHours: 10, updatedHours: 100 },
];

const BASE = new Date("2026-03-01T00:00:00.000Z").getTime();
const HOUR_MS = 3_600_000;

const num = (n: number) => `${NUMBER_PREFIX}${String(n).padStart(6, "0")}`;
const nums = (...ns: number[]) => ns.map(num);
const numbersOf = (body: { data: { ticketNumber: string }[] }) => body.data.map((t) => t.ticketNumber);
const expectedWhere = (keep: (f: Fixture) => boolean) =>
  FIXTURES.filter(keep)
    .map((f) => num(f.n))
    .sort();

const queue = (query: string, cookie: string | null = staffCookie) => {
  const req = request(app).get(`/api/staff/tickets${query}`);
  if (cookie !== null) req.set("Cookie", cookie);
  return req;
};
/** Scoped to the fixtures, with room for all ten on one page. */
const scoped = (extra = "") => queue(`?search=${TOKEN}&pageSize=50${extra}`);

beforeAll(async () => {
  const one = await upsertTestUser({ email: REQUESTER_ONE, name: "Queue Requester One" });
  const two = await upsertTestUser({ email: REQUESTER_TWO, name: "Queue Requester Two" });
  const staff = await upsertTestUser({ email: STAFF, name: "Queue Staff", role: "IT_STAFF" });
  const gone = await upsertTestUser({ email: STAFF_GONE, name: "Queue Staff Gone", role: "IT_STAFF", isActive: false });
  const admin = await upsertTestUser({ email: ADMIN, name: "Queue Admin", role: "ADMINISTRATOR" });
  requesterOneId = one.id;
  requesterTwoId = two.id;
  staffId = staff.id;
  goneId = gone.id;
  adminId = admin.id;

  staffCookie = await signIn(STAFF);
  adminCookie = await signIn(ADMIN);

  const categories = await prisma.category.findMany({ where: { isActive: true }, orderBy: { id: "asc" }, take: 2 });
  const system = await prisma.relatedSystem.findFirst({ where: { isActive: true } });
  if (categories.length < 2 || !system) throw new Error("Seed data missing — run npm run prisma:seed");
  categoryA = categories[0].id;
  categoryB = categories[1].id;

  await prisma.ticket.deleteMany({ where: { ticketNumber: { startsWith: NUMBER_PREFIX } } });

  const ownerIdOf = (owner: Fixture["owner"]) => (owner === "staff" ? staffId : owner === "gone" ? goneId : null);

  // Fixed timestamps, so the ordering assertions depend on the data rather than
  // on how quickly the rows happened to be inserted.
  await prisma.ticket.createMany({
    data: FIXTURES.map((f) => ({
      ticketNumber: num(f.n),
      requesterId: f.requester === "one" ? requesterOneId : requesterTwoId,
      categoryId: f.category === "A" ? categoryA : categoryB,
      relatedSystemId: system.id,
      summary: f.summary,
      description: `Queue fixture ${f.n}. ${DESCRIPTION_ONLY}`,
      requestedPriority: f.requestedPriority,
      itPriority: f.itPriority,
      currentStatus: f.status,
      ownerId: ownerIdOf(f.owner),
      createdAt: new Date(BASE + f.createdHours * HOUR_MS),
      updatedAt: new Date(BASE + f.updatedHours * HOUR_MS),
    })),
  });
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { ticketNumber: { startsWith: NUMBER_PREFIX } } });
  // Sessions follow their users through the schema's cascade.
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
});

describe("GET /api/staff/tickets", () => {
  it("API-QUEUE-01 / AC-09, FR-13: IT Staff see every Requester's Tickets with owner, status and both priorities", async () => {
    const res = await scoped();

    expect(res.status).toBe(200);
    expect(numbersOf(res.body).sort()).toEqual(expectedWhere(() => true));
    // Not one Requester's list: the whole point of the queue is that it is not.
    expect(new Set(res.body.data.map((t: { requesterId: number }) => t.requesterId))).toEqual(
      new Set([requesterOneId, requesterTwoId]),
    );

    const row = res.body.data.find((t: { ticketNumber: string }) => t.ticketNumber === num(2));
    // api-spec.md §5's Ticket object without `attachments` (§7). Exhaustive on
    // purpose, so a field that starts leaking fails here rather than shipping.
    expect(Object.keys(row).sort()).toEqual([
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
    // People are actor summaries: no email address for anyone (api-spec.md §5).
    expect(row.requester).toEqual({ id: requesterTwoId, name: "Queue Requester Two", role: "REQUESTER" });
    expect(row.owner).toEqual({ id: staffId, name: "Queue Staff", role: "IT_STAFF" });
    expect(row).toMatchObject({ currentStatus: "OPEN", requestedPriority: "MEDIUM", itPriority: "HIGH" });

    const unassigned = res.body.data.find((t: { ticketNumber: string }) => t.ticketNumber === num(1));
    expect(unassigned.ownerId).toBeNull();
    expect(unassigned.owner).toBeNull();
  });

  it("API-QUEUE-01 / BR-26: an owner whose account was deactivated is still shown", async () => {
    const res = await scoped();
    const row = res.body.data.find((t: { ticketNumber: string }) => t.ticketNumber === num(5));

    // Deactivation does not clear ownership, so the queue keeps telling the
    // truth about who holds the Ticket until somebody reassigns it.
    expect(row.owner).toEqual({ id: goneId, name: "Queue Staff Gone", role: "IT_STAFF" });
  });

  it("API-QUEUE-01 / FR-13: an Administrator reads the same queue", async () => {
    const staff = await scoped();
    const admin = await queue(`?search=${TOKEN}&pageSize=50`, adminCookie);

    expect(admin.status).toBe(200);
    expect(numbersOf(admin.body)).toEqual(numbersOf(staff.body));
  });

  it("API-QUEUE-02 / AC-09, BR-40: search matches ticket number and summary, case-insensitively", async () => {
    const byNumber = await queue("?search=2093-000004&pageSize=50");
    expect(numbersOf(byNumber.body)).toEqual(nums(4));

    // Fixtures 1 and 4 share "printer", once capitalised and once not.
    const lower = await queue(`?search=${TOKEN}%20printer&pageSize=50`);
    const upper = await queue(`?search=${TOKEN.toLowerCase()}%20PRINTER&pageSize=50`);
    expect(numbersOf(lower.body).sort()).toEqual(nums(1, 4));
    expect(numbersOf(upper.body).sort()).toEqual(nums(1, 4));

    // The same two fields Lab 2 searches — description is not one of them.
    const byDescription = await queue(`?search=${DESCRIPTION_ONLY}&pageSize=50`);
    expect(byDescription.body.data).toEqual([]);
  });

  it("API-QUEUE-03 / AC-09, BR-40: each filter on its own narrows to exactly its matches", async () => {
    const byCategory = await scoped(`&category=${categoryA}`);
    expect(numbersOf(byCategory.body).sort()).toEqual(expectedWhere((f) => f.category === "A"));

    for (const value of ["LOW", "MEDIUM", "HIGH"] as const) {
      const requested = await scoped(`&requestedPriority=${value}`);
      expect(numbersOf(requested.body).sort(), `requestedPriority=${value}`).toEqual(
        expectedWhere((f) => f.requestedPriority === value),
      );

      // A null IT Priority matches none of the three — it is not swept in.
      const it = await scoped(`&itPriority=${value}`);
      expect(numbersOf(it.body).sort(), `itPriority=${value}`).toEqual(
        expectedWhere((f) => f.itPriority === value),
      );
    }

    for (const status of [
      "NEW",
      "OPEN",
      "IN_PROGRESS",
      "WAITING_FOR_REQUESTER",
      "RESOLVED",
      "CLOSED",
      "REOPENED",
      "CANCELLED",
    ] as const) {
      const res = await scoped(`&status=${status}`);
      expect(numbersOf(res.body).sort(), `status=${status}`).toEqual(expectedWhere((f) => f.status === status));
    }
  });

  it("API-QUEUE-04 / BR-40: owner filters by an id, by unassigned, and ignores anything else", async () => {
    const unassigned = await scoped("&owner=unassigned");
    expect(numbersOf(unassigned.body).sort()).toEqual(expectedWhere((f) => f.owner === null));
    expect(unassigned.body.data.every((t: { ownerId: number | null }) => t.ownerId === null)).toBe(true);

    const mine = await scoped(`&owner=${staffId}`);
    expect(numbersOf(mine.body).sort()).toEqual(expectedWhere((f) => f.owner === "staff"));

    // BR-26: a deactivated owner is still a real owner to filter by.
    const gone = await scoped(`&owner=${goneId}`);
    expect(numbersOf(gone.body)).toEqual(nums(5));

    // api-spec.md §7: `me` is not accepted. It is ignored like any other value
    // the contract does not define, rather than quietly meaning something.
    const me = await scoped("&owner=me");
    expect(numbersOf(me.body).sort()).toEqual(expectedWhere(() => true));
  });

  it("API-QUEUE-05 / BR-40: filters combine with AND", async () => {
    const newInA = await scoped(`&category=${categoryA}&status=NEW`);
    expect(numbersOf(newInA.body).sort()).toEqual(expectedWhere((f) => f.category === "A" && f.status === "NEW"));

    const unclaimedHigh = await scoped("&owner=unassigned&requestedPriority=HIGH");
    expect(numbersOf(unclaimedHigh.body).sort()).toEqual(
      expectedWhere((f) => f.owner === null && f.requestedPriority === "HIGH"),
    );
    // Guard against a fixture change that would make AND and OR agree.
    expect(numbersOf(unclaimedHigh.body).length).toBeLessThan(expectedWhere((f) => f.owner === null).length);
  });

  it("API-QUEUE-06 / BR-40: every sortable field orders in both directions, ties by ticketNumber desc", async () => {
    const numberAsc = await scoped("&sortBy=ticketNumber&sortDir=asc");
    expect(numbersOf(numberAsc.body)).toEqual(nums(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    const numberDesc = await scoped("&sortBy=ticketNumber&sortDir=desc");
    expect(numbersOf(numberDesc.body)).toEqual(nums(10, 9, 8, 7, 6, 5, 4, 3, 2, 1));

    const createdAsc = await scoped("&sortBy=createdAt&sortDir=asc");
    expect(numbersOf(createdAsc.body)).toEqual(nums(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    const createdDesc = await scoped("&sortBy=createdAt&sortDir=desc");
    expect(numbersOf(createdDesc.body)).toEqual(nums(10, 9, 8, 7, 6, 5, 4, 3, 2, 1));

    // 7 and 8 share a Last Updated. The tie breaks by ticketNumber desc in
    // *both* directions — it is a fixed rule, not a mirror of the sort — so 8
    // precedes 7 either way.
    const updatedDesc = await scoped("&sortBy=updatedAt&sortDir=desc");
    expect(numbersOf(updatedDesc.body)).toEqual(nums(10, 9, 8, 7, 6, 5, 4, 3, 2, 1));
    const updatedAsc = await scoped("&sortBy=updatedAt&sortDir=asc");
    expect(numbersOf(updatedAsc.body)).toEqual(nums(1, 2, 3, 4, 5, 6, 8, 7, 9, 10));
  });

  it("API-QUEUE-07 / BR-40: itPriority sorts by rank, not alphabetically, with a null always last", async () => {
    // Alphabetically, descending would be MEDIUM, LOW, HIGH. By rank it is
    // HIGH (2, 4, 7), MEDIUM (3, 6, 9), LOW (1, 5, 8), each tie by ticketNumber
    // desc, and then the Ticket nobody has given an IT Priority.
    const desc = await scoped("&sortBy=itPriority&sortDir=desc");
    expect(numbersOf(desc.body)).toEqual(nums(7, 4, 2, 9, 6, 3, 8, 5, 1, 10));

    // PostgreSQL would put a null *first* here by default. api-spec.md §7 only
    // requires "last in desc"; this implementation keeps it last ascending too,
    // because an untriaged Ticket is not the lowest priority — it has none yet.
    const asc = await scoped("&sortBy=itPriority&sortDir=asc");
    expect(numbersOf(asc.body)).toEqual(nums(8, 5, 1, 9, 6, 3, 7, 4, 2, 10));
  });

  it("API-QUEUE-08 / BR-40: no parameters means Last Updated newest first, 25 per page", async () => {
    const bare = await queue("");
    expect(bare.status).toBe(200);
    expect(bare.body.pagination).toMatchObject({ page: 1, pageSize: 25 });

    // The default order, observed on the fixtures: identical to an explicit
    // `updatedAt desc`, which API-QUEUE-06 pins down.
    const defaulted = await queue(`?search=${TOKEN}`);
    expect(defaulted.body.pagination.pageSize).toBe(25);
    expect(numbersOf(defaulted.body)).toEqual(nums(10, 9, 8, 7, 6, 5, 4, 3, 2, 1));
  });

  it("API-QUEUE-09 / AC-28, BR-40: a junk value in any parameter falls back to its default, never 400", async () => {
    const everything = expectedWhere(() => true);
    const defaultOrder = nums(10, 9, 8, 7, 6, 5, 4, 3, 2, 1);

    const ignoredFilters = [
      "&category=not-a-number",
      "&category=-4",
      "&requestedPriority=URGENT",
      "&itPriority=nonsense",
      "&status=ESCALATED",
      "&status=new",
      "&owner=me",
      "&owner=-1",
      "&owner=abc",
      "&unknownParameter=whatever",
    ];
    for (const junk of ignoredFilters) {
      const res = await scoped(junk);
      expect(res.status, junk).toBe(200);
      expect(numbersOf(res.body).sort(), junk).toEqual(everything);
    }

    for (const junk of ["&sortBy=summary", "&sortBy=;DROP TABLE", "&sortDir=sideways", "&sortDir=ASC"]) {
      const res = await scoped(junk);
      expect(res.status, junk).toBe(200);
      expect(numbersOf(res.body), junk).toEqual(defaultOrder);
    }

    for (const junk of ["11", "0", "-5", "abc", "1000"]) {
      const res = await queue(`?search=${TOKEN}&pageSize=${junk}`);
      expect(res.status, `pageSize=${junk}`).toBe(200);
      expect(res.body.pagination.pageSize, `pageSize=${junk}`).toBe(25);
    }

    for (const junk of ["abc", "0", "-3", "1.5"]) {
      const res = await queue(`?search=${TOKEN}&page=${junk}`);
      expect(res.status, `page=${junk}`).toBe(200);
      expect(res.body.pagination.page, `page=${junk}`).toBe(1);
    }

    // An owner id that names nobody is a filter that matched nothing, not a
    // rejected request.
    const nobody = await scoped("&owner=2147483600");
    expect(nobody.status).toBe(200);
    expect(nobody.body.data).toEqual([]);
  });

  it("API-QUEUE-10 / BR-40: a page past the end is an empty page with accurate metadata", async () => {
    const past = await queue(`?search=${TOKEN}&pageSize=10&page=5`);

    expect(past.status).toBe(200);
    expect(past.body.data).toEqual([]);
    expect(past.body.pagination).toEqual({ page: 5, pageSize: 10, totalItems: 10, totalPages: 1 });
  });

  it("API-QUEUE-11 / BR-40: the pagination envelope has the Lab 2 shape", async () => {
    const res = await queue(`?search=${TOKEN}&pageSize=10`);

    expect(Object.keys(res.body).sort()).toEqual(["data", "pagination"]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 10, totalItems: 10, totalPages: 1 });
    expect(res.body.data).toHaveLength(10);
  });
});

describe("GET /api/staff/assignees", () => {
  it("API-QUEUE-12 / FR-16, BR-25: active IT Staff and Administrators only, as actor summaries", async () => {
    const res = await request(app).get("/api/staff/assignees").set("Cookie", staffCookie);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["data"]);

    const people = res.body.data as { id: number; name: string; role: string }[];
    const ids = people.map((p) => p.id);
    expect(ids).toContain(staffId);
    expect(ids).toContain(adminId);
    // Never offered as a new owner: a deactivated account (BR-25) or anyone
    // who is not staff.
    expect(ids).not.toContain(goneId);
    expect(ids).not.toContain(requesterOneId);

    for (const person of people) {
      // Narrower than the Administrator user list on purpose — no email and no
      // activation state (api-spec.md §7).
      expect(Object.keys(person).sort()).toEqual(["id", "name", "role"]);
      expect(["IT_STAFF", "ADMINISTRATOR"]).toContain(person.role);
    }
    const stored = await prisma.user.findMany({ where: { id: { in: ids } }, select: { isActive: true } });
    expect(stored.every((u) => u.isActive)).toBe(true);

    // Ordered by name. Asserted on the two fixture names rather than the whole
    // list, so the database's collation rules for spaces and case cannot make
    // the test disagree with a correct ORDER BY.
    expect(ids.indexOf(adminId)).toBeLessThan(ids.indexOf(staffId));
  });

  it("API-QUEUE-12 / FR-16: an Administrator gets the same list", async () => {
    const staff = await request(app).get("/api/staff/assignees").set("Cookie", staffCookie);
    const admin = await request(app).get("/api/staff/assignees").set("Cookie", adminCookie);

    expect(admin.status).toBe(200);
    expect(admin.body).toEqual(staff.body);
  });
});
