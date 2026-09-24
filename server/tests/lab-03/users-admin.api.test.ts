import { execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Response } from "supertest";
import { app } from "../../src/app.js";
import { sessionExpiry } from "../../src/auth.js";
import { hashPassword, verifyPassword } from "../../src/password.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { TEST_PASSWORD, upsertTestUser } from "../support/users.js";

// tests.md API-USER-01..20 and API-USER-10b; specification.md FR-22..FR-26,
// BR-07, BR-12, BR-18, BR-35..BR-39, BR-41, AC-17..AC-20, AC-22, AC-23, AC-27;
// api-spec.md §9.
//
// This suite runs on a database of its own, `toktickit_users_test`, migrated
// from nothing. The Administrator safety rules can only be exercised by
// arranging who else is an active Administrator — deactivating every other one
// to make somebody the last — and doing that to the developer database would
// leave its seeded Administrator deactivated if a run were interrupted halfway.
// It also means the list cases can assert the whole list, because every account
// in it was made here.
//
// The refusal for other roles (API-AUTHZ-04, API-AUTHZ-05) and the live-session
// effect of deactivation (API-AUTHZ-10, AC-24) are in
// `authorization.api.test.ts`, with the rest of the gate.

const USERS_DB = "toktickit_users_test";
const SERVER_ROOT = path.resolve(import.meta.dirname, "../..");
const ORIGINAL_URL = process.env.DATABASE_URL;

function databaseUrl(name: string): string {
  const url = new URL(ORIGINAL_URL ?? "");
  url.pathname = `/${name}`;
  return url.toString();
}

async function onServer(sql: string): Promise<void> {
  const url = new URL(ORIGINAL_URL ?? "");
  url.pathname = "/postgres";
  url.search = "";
  const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    await admin.$executeRawUnsafe(sql);
  } finally {
    await admin.$disconnect();
  }
}

const ALICE = "alice.admin@test.invalid";
const BELLA = "bella.admin@test.invalid";
const CARL = "carl.staff@test.invalid";
const DORA = "dora.staff@test.invalid";
const EVAN = "evan.requester@test.invalid";
const FAY = "fay.target@test.invalid";

const FIXTURE_NAMES = ["Alice Admin", "Bella Admin", "Carl Staff", "Dora Staff", "Evan Requester"];
const ADMIN_USER_KEYS = ["createdAt", "email", "id", "isActive", "mustChangePassword", "name", "role", "updatedAt"];
const NEVER_EXISTED = 2_147_483_600;

let prisma: PrismaClient;
const ids = { alice: 0, bella: 0, carl: 0, dora: 0, evan: 0, fay: 0 };
let aliceCookie = "";

type Body = Record<string, unknown>;
type UserRow = { id: number; name: string; email: string; role: string; isActive: boolean; mustChangePassword: boolean };

const listUsers = (query = "") => request(app).get(`/api/users${query}`).set("Cookie", aliceCookie);
const createUser = (body: Body) => request(app).post("/api/users").set("Cookie", aliceCookie).send(body);
const patchUser = (id: number | string, body: Body, cookie = aliceCookie) =>
  request(app).patch(`/api/users/${id}`).set("Cookie", cookie).send(body);
const setInitialPassword = (id: number | string, body: Body) =>
  request(app).post(`/api/users/${id}/initial-password`).set("Cookie", aliceCookie).send(body);
const login = (email: string, password: string) =>
  request(app).post("/api/auth/login").send({ email, password });

const namesOf = (res: Response) => (res.body.data as UserRow[]).map((u) => u.name);

const newUser = (overrides: Body = {}): Body => ({
  name: "Gina New",
  email: "gina.new@test.invalid",
  role: "IT_STAFF",
  isActive: true,
  initialPassword: "Welcome2026!",
  ...overrides,
});

/** Alice is always the acting, active Administrator; Bella is the other one, active or not. */
async function withBella(active: boolean): Promise<void> {
  await prisma.user.update({ where: { id: ids.alice }, data: { role: "ADMINISTRATOR", isActive: true } });
  await prisma.user.update({ where: { id: ids.bella }, data: { role: "ADMINISTRATOR", isActive: active } });
}

beforeAll(async () => {
  await onServer(`DROP DATABASE IF EXISTS "${USERS_DB}"`);
  await onServer(`CREATE DATABASE "${USERS_DB}"`);
  execSync("npx prisma migrate deploy", {
    cwd: SERVER_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: databaseUrl(USERS_DB) },
  });

  // The application's database handle is created on first use, so pointing the
  // environment here before anything in this file uses it sends the app, the
  // fixtures and the assertions to the same scratch database.
  process.env.DATABASE_URL = databaseUrl(USERS_DB);
  prisma = getPrisma();

  // Checked before a single row is written: if the handle had been created
  // earlier it would still point at the developer database, and every fixture
  // below would land there instead.
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  expect(db).toBe(USERS_DB);

  ids.alice = (await upsertTestUser({ email: ALICE, name: "Alice Admin", role: "ADMINISTRATOR" })).id;
  ids.bella = (await upsertTestUser({ email: BELLA, name: "Bella Admin", role: "ADMINISTRATOR" })).id;
  ids.carl = (await upsertTestUser({ email: CARL, name: "Carl Staff", role: "IT_STAFF" })).id;
  ids.dora = (await upsertTestUser({ email: DORA, name: "Dora Staff", role: "IT_STAFF", isActive: false })).id;
  ids.evan = (await upsertTestUser({ email: EVAN, name: "Evan Requester" })).id;

  aliceCookie = await signIn(ALICE);
}, 120_000);

afterAll(async () => {
  await getPrisma().$disconnect();
  process.env.DATABASE_URL = ORIGINAL_URL;
  await onServer(`DROP DATABASE IF EXISTS "${USERS_DB}"`);
});

// Runs first: every account in the database is one of the five fixtures.
describe("GET /api/users", () => {
  it("API-USER-01 / FR-22, BR-41: every account, inactive ones included, ordered by name", async () => {
    const res = await listUsers();

    expect(res.status).toBe(200);
    expect(namesOf(res)).toEqual(FIXTURE_NAMES);
    // Hiding deactivated accounts would make reactivating one impossible.
    const dora = (res.body.data as UserRow[]).find((u) => u.id === ids.dora);
    expect(dora?.isActive).toBe(false);
  });

  it("API-USER-02 / AC-27: search matches part of a name or an email, case-insensitively", async () => {
    expect(namesOf(await listUsers("?search=bella"))).toEqual(["Bella Admin"]);
    expect(namesOf(await listUsers("?search=CARL.STAFF"))).toEqual(["Carl Staff"]);
    // "admin" is in two names and two addresses; each account appears once.
    expect(namesOf(await listUsers("?search=Admin"))).toEqual(["Alice Admin", "Bella Admin"]);

    // A LIKE wildcard is a character to look for, not a match-everything.
    expect(namesOf(await listUsers("?search=%25"))).toEqual([]);

    // Clearing the search restores the full list.
    expect(namesOf(await listUsers("?search="))).toEqual(FIXTURE_NAMES);
  });

  it("API-USER-03 / AC-27: the role filter narrows to one role, and combines with search", async () => {
    expect(namesOf(await listUsers("?role=IT_STAFF"))).toEqual(["Carl Staff", "Dora Staff"]);
    expect(namesOf(await listUsers("?role=IT_STAFF&search=dora"))).toEqual(["Dora Staff"]);
    expect(namesOf(await listUsers("?role=ADMINISTRATOR&search=carl"))).toEqual([]);
  });

  it("API-USER-04 / BR-41: an unusable query value is ignored, never refused", async () => {
    for (const junk of ["?role=MANAGER", "?role=it_staff", "?role=IT_STAFF&role=REQUESTER", "?search[x]=1", "?unknown=1"]) {
      const res = await listUsers(junk);
      expect(res.status, junk).toBe(200);
      expect(namesOf(res), junk).toEqual(FIXTURE_NAMES);
    }
  });

  it("API-USER-05 / BR-41, BR-07: a plain array of admin user objects, with no pagination metadata", async () => {
    const res = await listUsers();

    // The handout excludes paging this list; metadata would describe a
    // capability that does not exist.
    expect(Object.keys(res.body)).toEqual(["data"]);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const user of res.body.data as Body[]) {
      expect(Object.keys(user).sort()).toEqual(ADMIN_USER_KEYS);
    }
  });
});

describe("POST /api/users", () => {
  it("API-USER-06 / AC-22, BR-35: creates the account with one role, a normalised email and a password to replace", async () => {
    const res = await createUser(
      newUser({ name: "  Gina New  ", email: "  Gina.New@Test.INVALID ", role: "IT_STAFF", isActive: false }),
    );

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data).sort()).toEqual(ADMIN_USER_KEYS);
    expect(res.body.data).toMatchObject({
      name: "Gina New",
      email: "gina.new@test.invalid",
      role: "IT_STAFF",
      isActive: false,
      // AC-22: the initial password is used once, to choose a real one.
      mustChangePassword: true,
    });

    // Stored as a hash of exactly what was typed (BR-07).
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(stored.passwordHash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("Welcome2026!", stored.passwordHash)).toBe(true);

    // And it is in the list, with that role (AC-22).
    const listed = (await listUsers("?search=gina")).body.data as UserRow[];
    expect(listed.map((u) => [u.name, u.role])).toEqual([["Gina New", "IT_STAFF"]]);
  });

  it("API-USER-07 / AC-17, BR-36: an address already in use is a conflict, whatever its capitalisation", async () => {
    const before = await prisma.user.count();

    // Carl is active and Dora is not — an inactive account's address is taken too.
    for (const email of [CARL, "  CARL.Staff@TEST.invalid ", DORA]) {
      const res = await createUser(newUser({ name: "Somebody Else", email }));
      expect(res.status, email).toBe(409);
      expect(res.body.error).toMatchObject({ code: "EMAIL_ALREADY_EXISTS", field: "email" });
    }

    expect(await prisma.user.count()).toBe(before);
  });

  it("API-USER-08 / BR-42: each invalid field is refused by name, and nothing is created", async () => {
    const before = await prisma.user.count();
    const cases: [Body, string][] = [
      [{ name: "A" }, "name"],
      [{ name: "x".repeat(101) }, "name"],
      [{ name: "     " }, "name"],
      [{ name: undefined }, "name"],
      [{ email: "not-an-email" }, "email"],
      [{ email: "someone@nodot" }, "email"],
      [{ email: "two words@test.invalid" }, "email"],
      [{ email: `${"x".repeat(190)}@test.invalid` }, "email"],
      [{ isActive: undefined }, "isActive"],
      [{ isActive: "true" }, "isActive"],
      [{ initialPassword: "1234567" }, "initialPassword"],
      [{ initialPassword: "x".repeat(73) }, "initialPassword"],
      [{ initialPassword: "         " }, "initialPassword"],
    ];

    for (const [override, field] of cases) {
      const res = await createUser(newUser({ email: "never.created@test.invalid", ...override }));
      const label = JSON.stringify(override);
      expect(res.status, label).toBe(400);
      expect(res.body.error, label).toMatchObject({ code: "VALIDATION_ERROR", field });
    }
    expect(await prisma.user.count()).toBe(before);

    // The bounds themselves are accepted.
    const shortest = await createUser(newUser({ name: "Jo", email: "jo.bounds@test.invalid", initialPassword: "12345678" }));
    expect(shortest.status).toBe(201);
    const longest = await createUser(
      newUser({ name: "y".repeat(100), email: "long.bounds@test.invalid", initialPassword: "z".repeat(72) }),
    );
    expect(longest.status).toBe(201);
  });

  it("API-USER-09 / BR-18: a role is exactly one known value — never an array, never a first element taken", async () => {
    const before = await prisma.user.count();

    for (const role of [["IT_STAFF"], ["ADMINISTRATOR", "IT_STAFF"], "MANAGER", "it_staff", undefined]) {
      const res = await createUser(newUser({ email: "never.roled@test.invalid", role }));
      expect(res.status, JSON.stringify(role)).toBe(400);
      expect(res.body.error, JSON.stringify(role)).toMatchObject({ code: "VALIDATION_ERROR", field: "role" });
    }

    expect(await prisma.user.count()).toBe(before);
  });
});

describe("PATCH /api/users/:id", () => {
  beforeAll(async () => {
    ids.fay = (await upsertTestUser({ email: FAY, name: "Fay Target" })).id;
  });

  it("API-USER-10 / AC-23, BR-35: each editable field saves on its own, and the fields left out are untouched", async () => {
    const renamed = await patchUser(ids.fay, { name: "  Fay Renamed  " });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ name: "Fay Renamed", email: FAY, role: "REQUESTER", isActive: true });

    const moved = await patchUser(ids.fay, { email: "FAY.MOVED@test.invalid" });
    expect(moved.body.data).toMatchObject({ name: "Fay Renamed", email: "fay.moved@test.invalid" });

    const reroled = await patchUser(ids.fay, { role: "IT_STAFF" });
    expect(reroled.body.data).toMatchObject({ role: "IT_STAFF", email: "fay.moved@test.invalid" });
    // A role change is not a credential change.
    expect(reroled.body.data.mustChangePassword).toBe(false);

    const deactivated = await patchUser(ids.fay, { isActive: false });
    expect(deactivated.body.data).toMatchObject({ isActive: false, role: "IT_STAFF" });
    const reactivated = await patchUser(ids.fay, { isActive: true });
    expect(reactivated.body.data.isActive).toBe(true);

    // AC-23: the list reflects it.
    const listed = (await listUsers("?search=fay")).body.data as UserRow[];
    expect(listed).toEqual([expect.objectContaining({ name: "Fay Renamed", email: "fay.moved@test.invalid", role: "IT_STAFF", isActive: true })]);
  });

  it("API-USER-10b / BR-42: an account that does not exist is 404 on both edit endpoints", async () => {
    for (const id of [NEVER_EXISTED, "abc"]) {
      const edit = await patchUser(id, { name: "Valid Name" });
      expect(edit.status, `PATCH ${id}`).toBe(404);
      expect(edit.body.error.code).toBe("USER_NOT_FOUND");

      const reset = await setInitialPassword(id, { initialPassword: "Welcome2026!" });
      expect(reset.status, `initial-password ${id}`).toBe(404);
      expect(reset.body.error.code).toBe("USER_NOT_FOUND");
    }
  });

  it("API-USER-11 / BR-42: an edit that changes none of the four fields is refused, not confirmed", async () => {
    for (const body of [{}, { nickname: "Fay" }, { passwordHash: "x" }]) {
      const res = await patchUser(ids.fay, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    // The fields that are there are validated like creation.
    const bad = await patchUser(ids.fay, { name: "A" });
    expect(bad.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "name" });
  });

  it("API-USER-12 / BR-36: moving an account to an address another account holds is a conflict", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.fay } });

    const taken = await patchUser(ids.fay, { email: "CARL.STAFF@test.invalid" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: "EMAIL_ALREADY_EXISTS", field: "email" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.fay } })).email).toBe(before.email);

    // Its own address is not somebody else's.
    const same = await patchUser(ids.fay, { email: before.email.toUpperCase() });
    expect(same.status).toBe(200);
  });
});

describe("Administrator safety rules", () => {
  it("API-USER-13 / AC-20, BR-37: an Administrator cannot deactivate their own account", async () => {
    await withBella(true);

    const res = await patchUser(ids.alice, { isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "SELF_DEACTIVATION", field: "isActive" });
    // The field named is the change that caused it, even with all four in the
    // body — which is what the Edit dialog sends.
    const full = await patchUser(ids.alice, { name: "Alice Admin", email: ALICE, role: "ADMINISTRATOR", isActive: false });
    expect(full.body.error).toMatchObject({ code: "SELF_DEACTIVATION", field: "isActive" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.alice } })).isActive).toBe(true);
    // And their session is untouched.
    expect((await request(app).get("/api/auth/me").set("Cookie", aliceCookie)).status).toBe(200);
  });

  it("API-USER-14 / BR-37: an Administrator cannot take away their own role, but can edit the rest of their account", async () => {
    await withBella(true);

    const res = await patchUser(ids.alice, { role: "IT_STAFF" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "SELF_DEACTIVATION", field: "role" });
    const full = await patchUser(ids.alice, { name: "Alice Admin", email: ALICE, role: "IT_STAFF", isActive: true });
    expect(full.body.error).toMatchObject({ code: "SELF_DEACTIVATION", field: "role" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.alice } })).role).toBe("ADMINISTRATOR");

    const renamed = await patchUser(ids.alice, { name: "Alice Admin" });
    expect(renamed.status).toBe(200);
  });

  it("API-USER-15 / AC-19, BR-38: the last active Administrator cannot be deactivated", async () => {
    await withBella(false);

    const res = await patchUser(ids.alice, { isActive: false });

    // The count decides before the self rule: when nobody else could administer
    // the system, that is the reason given (api-spec.md §9).
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "LAST_ACTIVE_ADMINISTRATOR", field: "isActive" });
    const alice = await prisma.user.findUniqueOrThrow({ where: { id: ids.alice } });
    expect(alice).toMatchObject({ role: "ADMINISTRATOR", isActive: true });

    // While another remains, deactivating a different Administrator is allowed.
    await withBella(true);
    expect((await patchUser(ids.bella, { isActive: false })).status).toBe(200);
  });

  it("API-USER-15 / BR-38: two Administrators deactivating each other at once still leave one active", async () => {
    await withBella(true);
    const bellaCookie = await signIn(BELLA);

    const results = await Promise.all([
      patchUser(ids.bella, { isActive: false }, aliceCookie),
      patchUser(ids.alice, { isActive: false }, bellaCookie),
    ]);
    const statuses = results.map((r) => r.status).sort();

    // One succeeds. The other is refused — as the last Administrator if its
    // transaction waited on the first, or as no longer signed in if the first
    // had already ended its session. Never both successful.
    expect(statuses).toContain(200);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    const other = results.find((r) => r.status !== 200)!;
    expect([401, 409]).toContain(other.status);
    if (other.status === 409) expect(other.body.error.code).toBe("LAST_ACTIVE_ADMINISTRATOR");

    expect(await prisma.user.count({ where: { role: "ADMINISTRATOR", isActive: true } })).toBe(1);

    // Put both back, and sign Alice in again in case hers was the session ended.
    await withBella(true);
    aliceCookie = await signIn(ALICE);
  });

  it("API-USER-16 / AC-19, BR-38: the last active Administrator cannot be given another role", async () => {
    await withBella(false);

    for (const role of ["IT_STAFF", "REQUESTER"]) {
      const res = await patchUser(ids.alice, { role });
      expect(res.status, role).toBe(409);
      expect(res.body.error).toMatchObject({ code: "LAST_ACTIVE_ADMINISTRATOR", field: "role" });
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.alice } })).role).toBe("ADMINISTRATOR");
    const full = await patchUser(ids.alice, { name: "Alice Admin", email: ALICE, role: "REQUESTER", isActive: true });
    expect(full.body.error).toMatchObject({ code: "LAST_ACTIVE_ADMINISTRATOR", field: "role" });

    // An inactive Administrator is not an active one to lose.
    expect((await patchUser(ids.bella, { role: "IT_STAFF" })).status).toBe(200);
    await withBella(true);
  });
});

describe("POST /api/users/:id/initial-password", () => {
  it("API-USER-17 / AC-18, BR-12, BR-35: sets the flag and ends every session the account had", async () => {
    const carlCookie = await signIn(CARL);

    const res = await setInitialPassword(ids.carl, { initialPassword: "Fresh2026!" });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(ADMIN_USER_KEYS);
    expect(res.body.data.mustChangePassword).toBe(true);
    // Never echoed (BR-07).
    expect(JSON.stringify(res.body)).not.toContain("Fresh2026!");

    expect(await prisma.session.count({ where: { userId: ids.carl } })).toBe(0);
    expect((await request(app).get("/api/auth/me").set("Cookie", carlCookie)).status).toBe(401);

    for (const body of [{}, { initialPassword: "short" }, { initialPassword: "x".repeat(73) }]) {
      const bad = await setInitialPassword(ids.carl, body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "initialPassword" });
    }
  });

  it("API-USER-18 / AC-18: the new initial password signs in, straight into the password-change gate, and the old one no longer works", async () => {
    const fresh = await login(CARL, "Fresh2026!");
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.mustChangePassword).toBe(true);

    const cookie = (fresh.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const queue = await request(app).get("/api/staff/tickets").set("Cookie", cookie);
    expect(queue.status).toBe(403);
    expect(queue.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const old = await login(CARL, TEST_PASSWORD);
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("API-USER-17 / BR-12: on an Administrator's own account, the session making the request is the one kept", async () => {
    const otherSession = "b".repeat(64);
    await prisma.session.create({ data: { id: otherSession, userId: ids.alice, expiresAt: sessionExpiry() } });

    const res = await setInitialPassword(ids.alice, { initialPassword: "Another2026!" });
    expect(res.status).toBe(200);

    // The other session is gone; this one survives, so the next request lands on
    // Change Password rather than on Login (api-spec.md §9).
    expect(await prisma.session.findUnique({ where: { id: otherSession } })).toBeNull();
    const me = await request(app).get("/api/auth/me").set("Cookie", aliceCookie);
    expect(me.status).toBe(200);
    expect(me.body.data.mustChangePassword).toBe(true);
    const next = await listUsers();
    expect(next.status).toBe(403);
    expect(next.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // Restored, so the cases after this one still act as a ready Administrator.
    await prisma.user.update({
      where: { id: ids.alice },
      data: { passwordHash: await hashPassword(TEST_PASSWORD), mustChangePassword: false },
    });
  });
});

describe("What user management does not do, and never says", () => {
  it("API-USER-19 / BR-39: there is no way to delete an account", async () => {
    for (const method of ["delete", "put"] as const) {
      const res = await request(app)[method](`/api/users/${ids.evan}`).set("Cookie", aliceCookie);
      expect(res.status, method).toBe(404);
      expect(res.body.error.code, method).toBe("NOT_FOUND");
    }
    expect(await prisma.user.findUnique({ where: { id: ids.evan } })).not.toBeNull();
  });

  it("API-USER-20 / BR-07: no user response carries a password hash or echoes a password", async () => {
    const password = "Sweep-Secret-2026";
    const responses: [string, Response][] = [
      ["list", await listUsers()],
      ["create", await createUser(newUser({ name: "Hal Sweep", email: "hal.sweep@test.invalid", initialPassword: password }))],
      ["create 409", await createUser(newUser({ email: CARL, initialPassword: password }))],
      ["create 400", await createUser(newUser({ name: "A", initialPassword: password }))],
      ["patch", await patchUser(ids.evan, { name: "Evan Requester" })],
      ["initial-password", await setInitialPassword(ids.evan, { initialPassword: password })],
      ["initial-password 404", await setInitialPassword(NEVER_EXISTED, { initialPassword: password })],
    ];

    for (const [name, res] of responses) {
      const text = JSON.stringify(res.body);
      expect(text, `${name} mentions passwordHash`).not.toContain("passwordHash");
      expect(text, `${name} contains a bcrypt hash`).not.toMatch(/\$2[aby]?\$/);
      expect(text, `${name} echoes the password`).not.toContain(password);
    }
  });
});
