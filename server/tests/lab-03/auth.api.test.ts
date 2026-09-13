import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Response } from "supertest";
import { app } from "../../src/app.js";
import { SESSION_COOKIE, sessionExpiry } from "../../src/auth.js";
import { hashPassword } from "../../src/password.js";
import { getPrisma } from "../../src/prisma.js";
import { TEST_PASSWORD, upsertTestUser } from "../support/users.js";

// tests.md API-AUTH-01..16, against api-spec.md §4.
//
// Authentication is performed by actually logging in and reusing the cookie
// that comes back, never by inserting a session row and pretending — a test
// that forges its own identity proves nothing about the gate it is testing.
//
// API-AUTH-17 and API-AUTH-18 were deferred from Issue #29 and are written at
// the bottom of this file: they need endpoints standing behind the gate, and
// the Lab 2 routes only moved onto the session in Issue #30.

const prisma = getPrisma();

const ACTIVE = "auth.active@test.invalid";
const INACTIVE = "auth.inactive@test.invalid";
const CHANGER = "auth.changer@test.invalid";
const UNKNOWN = "auth.nobody@test.invalid";
const PENDING = "auth.pending@test.invalid";
const PENDING_STAFF = "auth.pending.staff@test.invalid";

const ids: number[] = [];

const login = (email: string, password: string = TEST_PASSWORD) =>
  request(app).post("/api/auth/login").send({ email, password });

/** The `name=value` pair from Set-Cookie, ready to send back as a Cookie. */
function cookieOf(res: Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  expect(raw, "expected a Set-Cookie header").toBeTruthy();
  return raw![0].split(";")[0];
}

beforeAll(async () => {
  const active = await upsertTestUser({ email: ACTIVE, name: "Auth Active" });
  const inactive = await upsertTestUser({ email: INACTIVE, name: "Auth Inactive", isActive: false });
  const changer = await upsertTestUser({ email: CHANGER, name: "Auth Changer" });
  // An account still holding the password it was created with (BR-02).
  const pending = await upsertTestUser({
    email: PENDING,
    name: "Auth Pending",
    mustChangePassword: true,
  });
  const pendingStaff = await upsertTestUser({
    email: PENDING_STAFF,
    name: "Auth Pending Staff",
    role: "IT_STAFF",
    mustChangePassword: true,
  });
  ids.push(active.id, inactive.id, changer.id, pending.id, pendingStaff.id);
});

afterAll(async () => {
  // Sessions go with their users through the schema's cascade.
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("POST /api/auth/login", () => {
  it("API-AUTH-01 / AC-01, BR-01: valid credentials return the safe user and set the session cookie", async () => {
    const res = await login(ACTIVE);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      email: ACTIVE,
      name: "Auth Active",
      role: "REQUESTER",
      isActive: true,
      mustChangePassword: false,
    });
    expect(cookieOf(res).startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    const sessions = await prisma.session.findMany({ where: { userId: ids[0] } });
    expect(sessions).toHaveLength(1);
  });

  it("API-AUTH-02 / BR-06: a wrong password is 401 with no cookie and no session row", async () => {
    const before = await prisma.session.count();
    const res = await login(ACTIVE, "not-the-password");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.session.count()).toBe(before);
  });

  it("API-AUTH-03 / BR-06: an unknown address answers exactly as a wrong password does", async () => {
    const wrongPassword = await login(ACTIVE, "not-the-password");
    const unknownAddress = await login(UNKNOWN);

    expect(unknownAddress.status).toBe(wrongPassword.status);
    // Byte-identical: not merely the same code, the same message and the same
    // absence of a `field`. Any difference would separate the two cases.
    expect(unknownAddress.body).toEqual(wrongPassword.body);
    expect(unknownAddress.body.error).not.toHaveProperty("field");
  });

  it("API-AUTH-04 / AC-05, BR-01: an inactive account with the right password fails the same way, and no session is created", async () => {
    const wrongPassword = await login(ACTIVE, "not-the-password");
    const res = await login(INACTIVE);

    expect(res.status).toBe(401);
    expect(res.body).toEqual(wrongPassword.body);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: ids[1] } })).toBe(0);
  });

  it("API-AUTH-05 / BR-42: a blank submission is 400 with the offending field, not 401", async () => {
    const noEmail = await request(app).post("/api/auth/login").send({ password: TEST_PASSWORD });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "email" });

    const noPassword = await request(app).post("/api/auth/login").send({ email: ACTIVE });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "password" });

    const blank = await request(app)
      .post("/api/auth/login")
      .send({ email: "   ", password: "   " });
    expect(blank.status).toBe(400);
  });

  it("API-AUTH-06 / BR-36: a padded, capitalised address still finds the account", async () => {
    const res = await login(`  ${ACTIVE.toUpperCase()}  `);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(ACTIVE);
  });

  it("API-AUTH-07 / BR-07: no password hash and no session identifier appear in the body", async () => {
    const res = await login(ACTIVE);
    const body = JSON.stringify(res.body);
    const sessionId = cookieOf(res).split("=")[1];

    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(body).not.toContain("$2");
    expect(body).not.toContain(sessionId);
  });

  it("API-AUTH-08 / BR-14: ten failures do not lock the account", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await login(ACTIVE, `wrong-${attempt}`);
      expect(failed.status).toBe(401);
      // No lockout means no Retry-After and no change of code along the way.
      expect(failed.headers["retry-after"]).toBeUndefined();
      expect(failed.body.error.code).toBe("INVALID_CREDENTIALS");
    }

    const eleventh = await login(ACTIVE);
    expect(eleventh.status).toBe(200);
  });

  it("API-AUTH-01: logging in again replaces the previous session rather than adding one", async () => {
    await login(ACTIVE);
    await login(ACTIVE);

    expect(await prisma.session.count({ where: { userId: ids[0] } })).toBe(1);
  });

  it("API-AUTH-12 / BR-15: the cookie is HttpOnly, SameSite=Lax and Path=/", async () => {
    const res = await login(ACTIVE);
    const raw = (res.headers["set-cookie"] as unknown as string[])[0];

    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Path=\//i);
    // Secure is off here on purpose: the dev and test servers are plain http,
    // and a Secure cookie would simply never be sent back.
    expect(raw).not.toMatch(/Secure/i);
  });
});

describe("GET /api/auth/me", () => {
  it("API-AUTH-09 / FR-03, BR-13: returns the safe user for a valid session", async () => {
    const cookie = cookieOf(await login(ACTIVE));
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: ACTIVE, role: "REQUESTER" });
    expect(res.body.data).not.toHaveProperty("passwordHash");
  });

  it("API-AUTH-10 / BR-13: answers 401 with no session — never 200 with a null user", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body).not.toHaveProperty("data");
  });

  it("API-AUTH-10 / BR-13: an unknown cookie value is unauthenticated, not a server error", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=deadbeef`);

    expect(res.status).toBe(401);
  });

  it("API-AUTH-13 / BR-11: an expired session answers 401 and the row is removed", async () => {
    const cookie = cookieOf(await login(ACTIVE));
    const id = cookie.split("=")[1];

    // Age the session past its expiry rather than waiting eight hours.
    await prisma.session.update({
      where: { id },
      data: { expiresAt: sessionExpiry(new Date(Date.now() - 9 * 60 * 60 * 1000)) },
    });

    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(await prisma.session.findUnique({ where: { id } })).toBeNull();
  });
});

describe("POST /api/auth/logout", () => {
  it("API-AUTH-11 / AC-06, BR-10: 204, the row is deleted, and replaying the cookie is unauthenticated", async () => {
    const cookie = cookieOf(await login(ACTIVE));
    const id = cookie.split("=")[1];

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(204);
    expect(out.body).toEqual({});
    expect(await prisma.session.findUnique({ where: { id } })).toBeNull();

    const replay = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(replay.status).toBe(401);
  });

  it("API-AUTH-11: logging out twice is an ordinary unauthenticated request the second time", async () => {
    const cookie = cookieOf(await login(ACTIVE));

    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);
    expect((await request(app).post("/api/auth/logout").set("Cookie", cookie)).status).toBe(401);
  });

  it("API-AUTH-11: logout without a session is 401, not 204", async () => {
    expect((await request(app).post("/api/auth/logout")).status).toBe(401);
  });
});

describe("POST /api/auth/change-password", () => {
  const NEW_PASSWORD = "a-different-password-1";

  const change = (cookie: string, body: Record<string, unknown>) =>
    request(app).post("/api/auth/change-password").set("Cookie", cookie).send(body);

  it("API-AUTH-14 / BR-09, BR-12: the new password works, the old one does not, and other sessions are dropped", async () => {
    const cookie = cookieOf(await login(CHANGER));
    const currentId = cookie.split("=")[1];

    // A second live session for the same user, as a different browser would
    // have. createSession replaces rather than adds, so it is inserted here.
    const otherId = "other-session-for-changer";
    await prisma.session.create({
      data: { id: otherId, userId: ids[2], expiresAt: sessionExpiry() },
    });

    const res = await change(cookie, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.mustChangePassword).toBe(false);
    expect(res.body.data).not.toHaveProperty("passwordHash");

    // The session that made the change survives; every other one is gone.
    expect(await prisma.session.findUnique({ where: { id: currentId } })).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { id: otherId } })).toBeNull();

    expect((await login(CHANGER, TEST_PASSWORD)).status).toBe(401);
    expect((await login(CHANGER, NEW_PASSWORD)).status).toBe(200);

    // Put the fixture back so the order of the cases below does not matter.
    await prisma.user.update({
      where: { id: ids[2] },
      data: { passwordHash: await hashPassword(TEST_PASSWORD) },
    });
  });

  it("API-AUTH-15 / BR-42: a wrong current password is 400 on that field, not 401", async () => {
    const cookie = cookieOf(await login(CHANGER));
    const res = await change(cookie, {
      currentPassword: "not-my-password",
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    // 401 would send the client back to Login, but the session is perfectly
    // valid — it is the typed value that is wrong.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", field: "currentPassword" });
  });

  it("API-AUTH-16 / BR-08, BR-09: too short, too long, unchanged, and mismatched each fail on the right field", async () => {
    const cookie = cookieOf(await login(CHANGER));
    const base = { currentPassword: TEST_PASSWORD };

    const short = await change(cookie, {
      ...base,
      newPassword: "a".repeat(7),
      confirmPassword: "a".repeat(7),
    });
    expect(short.status).toBe(400);
    expect(short.body.error.field).toBe("newPassword");

    const long = await change(cookie, {
      ...base,
      newPassword: "a".repeat(73),
      confirmPassword: "a".repeat(73),
    });
    expect(long.status).toBe(400);
    expect(long.body.error.field).toBe("newPassword");

    const unchanged = await change(cookie, {
      ...base,
      newPassword: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
    });
    expect(unchanged.status).toBe(400);
    expect(unchanged.body.error.field).toBe("newPassword");

    const mismatch = await change(cookie, {
      ...base,
      newPassword: NEW_PASSWORD,
      confirmPassword: `${NEW_PASSWORD}-typo`,
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.field).toBe("confirmPassword");

    // Nothing above changed the stored password.
    expect((await login(CHANGER, TEST_PASSWORD)).status).toBe(200);
  });

  it("API-AUTH-16 / BR-42: missing fields are reported one at a time, by name", async () => {
    const cookie = cookieOf(await login(CHANGER));

    const noCurrent = await change(cookie, {
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });
    expect(noCurrent.body.error.field).toBe("currentPassword");

    const noNew = await change(cookie, { currentPassword: TEST_PASSWORD });
    expect(noNew.body.error.field).toBe("newPassword");

    const noConfirm = await change(cookie, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(noConfirm.body.error.field).toBe("confirmPassword");
  });

  it("API-AUTH-14: changing a password requires a session at all", async () => {
    const res = await request(app).post("/api/auth/change-password").send({
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Deferred from Issue #29 — gate 3, the mandatory password change.
//
// The gate was built with the rest of the authentication foundation, but there
// was nothing standing behind it until Issue #30 moved the Lab 2 routes onto
// the session. These two rows are what make BR-02 a server-side rule rather
// than a client-side redirect.
// ---------------------------------------------------------------------------
describe("The mandatory password change gate", () => {
  const CHOSEN_PASSWORD = "chosen-after-the-initial-one";

  it("API-AUTH-17 / AC-02, BR-02: an account on its initial password reaches no ordinary endpoint", async () => {
    const cookie = cookieOf(await login(PENDING));

    const calls = [
      request(app).get("/api/tickets").set("Cookie", cookie),
      request(app).get("/api/tickets/1").set("Cookie", cookie),
      request(app).post("/api/tickets").set("Cookie", cookie).send({ summary: "Anything" }),
      request(app).get("/api/attachments/1").set("Cookie", cookie),
      request(app).get("/api/attachments/1/download").set("Cookie", cookie),
      request(app)
        .delete("/api/attachments/1")
        .set("Cookie", cookie)
        .send({ removalReason: "A reason long enough to pass validation." }),
    ];

    for (const call of calls) {
      const res = await call;
      // 403 and not 401: the session is perfectly valid, which is precisely
      // why the client can be told what to do about it (api-spec.md §3).
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("API-AUTH-17 / BR-02: the gate stands in front of the staff endpoints too", async () => {
    const cookie = cookieOf(await login(PENDING_STAFF));

    for (const path of ["/api/staff/tickets", "/api/staff/assignees"]) {
      const res = await request(app).get(path).set("Cookie", cookie);
      // The account holds the right role and is still refused: gate 3 runs
      // before gate 4 (api-spec.md §3), whichever role's endpoint it guards.
      expect(res.status, path).toBe(403);
      expect(res.body.error.code, path).toBe("PASSWORD_CHANGE_REQUIRED");
    }
  });

  it("API-AUTH-17 / BR-02: the refusal outranks anything else wrong with the request", async () => {
    const cookie = cookieOf(await login(PENDING));

    // An unparseable id would be 404 and an empty body 400 for anyone else.
    // The gate runs first, so neither answer is reachable from here — a 404
    // would tell an unauthorised caller which ids exist.
    const badId = await request(app).get("/api/tickets/not-a-number").set("Cookie", cookie);
    expect(badId.status).toBe(403);
    expect(badId.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("API-AUTH-18 / BR-02: the three ways out of that state all still work", async () => {
    const cookie = cookieOf(await login(PENDING));

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    // The client needs this flag to know which screen to show, so it is on the
    // safe user rather than inferred from a refusal.
    expect(me.body.data.mustChangePassword).toBe(true);

    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: CHOSEN_PASSWORD,
        confirmPassword: CHOSEN_PASSWORD,
      });
    expect(changed.status).toBe(200);
    expect(changed.body.data.mustChangePassword).toBe(false);

    // AC-02: past the gate, the ordinary endpoints answer normally — the same
    // session, no second sign-in.
    const after = await request(app).get("/api/tickets").set("Cookie", cookie);
    expect(after.status).toBe(200);

    const loggedOut = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(loggedOut.status).toBe(204);

    // Left as it was found, so the suite can be run twice in a row.
    await prisma.user.update({
      where: { email: PENDING },
      data: { passwordHash: await hashPassword(TEST_PASSWORD), mustChangePassword: true },
    });
  });

  it("API-AUTH-18 / BR-02: logging out is available without changing anything first", async () => {
    const cookie = cookieOf(await login(PENDING));

    const res = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(res.status).toBe(204);
    expect(await prisma.session.count({ where: { user: { email: PENDING } } })).toBe(0);
  });
});
