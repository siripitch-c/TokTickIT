import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Test } from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { signIn } from "../support/session.js";
import { TEST_PASSWORD, upsertTestUser } from "../support/users.js";

// tests.md API-AUTHZ-01..11 and API-ERR-01..02, against the five-gate order in
// api-spec.md §3 and the authorization matrix in specification.md §5.
//
// This is the suite the handout's "the UI is feedback, the API is the control"
// distinction rests on: every case here is a request the client would never
// send, driven straight at the API. Hiding a link proves nothing; refusing the
// call does.
//
// Four rows of §2.3 cannot be written yet because the endpoints they name do
// not exist. They are not skipped silently — tests.md §8 records where each
// one lands:
//
//   API-AUTHZ-02  Requester -> /api/staff/*      Issue #31
//   API-AUTHZ-03  Requester -> IT-only fields    Issue #32
//   API-AUTHZ-04  Requester -> /api/users/*      Issue #33
//   API-AUTHZ-05  IT Staff  -> /api/users/*      Issue #33
//
// Pointing them at a path that is merely unrouted would assert a 404 from the
// fallback handler and read as a passing authorization test, which is worse
// than an honest deferral.

const prisma = getPrisma();

const OWNER = "authz.owner@test.invalid";
const OTHER = "authz.other@test.invalid";
const STAFF = "authz.staff@test.invalid";
const ADMIN = "authz.admin@test.invalid";
const DOOMED = "authz.doomed@test.invalid";

const emails = [OWNER, OTHER, STAFF, ADMIN, DOOMED];

let ownerId = 0;
let otherId = 0;
let ownerCookie = "";
let otherCookie = "";
let staffCookie = "";
let adminCookie = "";

let categoryId = 0;
let relatedSystemId = 0;

let ownTicketId = 0;
let foreignTicketId = 0;
let ownAttachmentId = 0;
let foreignAttachmentId = 0;
let removedAttachmentId = 0;

// An id inside the 32-bit range that no row will ever occupy, so "belongs to
// somebody else" and "was never created" can be compared byte for byte.
const NEVER_EXISTED = 2_147_483_600;

function ticketBody(summary: string) {
  return {
    categoryId,
    relatedSystemId,
    summary,
    description: "A ticket body used by the Lab 3 authorization suite.",
    requestedPriority: "LOW" as const,
  };
}

/**
 * Every endpoint behind `requesterOnly`, as a callable.
 *
 * Written as a table because BR-19 is a statement about *all* of them: a gate
 * applied to six routes and forgotten on the seventh is exactly the defect
 * these rows exist to catch, and a table cannot forget a route the way seven
 * hand-written cases can.
 *
 * Only ever driven with an absent cookie or a wrong-role one, so no call in it
 * reaches a handler — nothing here mutates data.
 *
 * The authentication gate applies to all seven. The *role* gate does not:
 * `REQUESTER_ONLY` below is the subset api-spec.md §6 keeps to the Requester
 * role permanently. The other three widen in Issue #32 and are asserted
 * separately, because a test cannot claim BR-19 over an endpoint the contract
 * says another role may call.
 */
interface ProtectedCall {
  name: string;
  send: (cookie: string | null) => Test;
}

// api-spec.md §6: "Requester role only ... another role answers 403". These
// four say so in as many words and stay that way for the rest of the sprint.
const REQUESTER_ONLY = new Set([
  "POST /api/tickets",
  "GET /api/tickets",
  "POST /api/tickets/:id/attachments",
  "DELETE /api/attachments/:id",
]);

function withCookie(req: Test, cookie: string | null): Test {
  return cookie === null ? req : req.set("Cookie", cookie);
}

function protectedCalls(): ProtectedCall[] {
  return [
    {
      name: "POST /api/tickets",
      send: (c) => withCookie(request(app).post("/api/tickets"), c).send(ticketBody("Gate probe")),
    },
    { name: "GET /api/tickets", send: (c) => withCookie(request(app).get("/api/tickets"), c) },
    {
      name: "GET /api/tickets/:id",
      send: (c) => withCookie(request(app).get(`/api/tickets/${ownTicketId}`), c),
    },
    {
      name: "POST /api/tickets/:id/attachments",
      send: (c) =>
        withCookie(request(app).post(`/api/tickets/${ownTicketId}/attachments`), c).attach(
          "file",
          Buffer.alloc(16, 0x41),
          { filename: "probe.png", contentType: "image/png" },
        ),
    },
    {
      name: "GET /api/attachments/:id",
      send: (c) => withCookie(request(app).get(`/api/attachments/${ownAttachmentId}`), c),
    },
    {
      name: "GET /api/attachments/:id/download",
      send: (c) => withCookie(request(app).get(`/api/attachments/${ownAttachmentId}/download`), c),
    },
    {
      name: "DELETE /api/attachments/:id",
      send: (c) =>
        withCookie(request(app).delete(`/api/attachments/${ownAttachmentId}`), c).send({
          removalReason: "Removed by the authorization gate probe.",
        }),
    },
  ];
}

beforeAll(async () => {
  const owner = await upsertTestUser({ email: OWNER, name: "Authz Owner" });
  const other = await upsertTestUser({ email: OTHER, name: "Authz Other" });
  await upsertTestUser({ email: STAFF, name: "Authz Staff", role: "IT_STAFF" });
  await upsertTestUser({ email: ADMIN, name: "Authz Admin", role: "ADMINISTRATOR" });
  await upsertTestUser({ email: DOOMED, name: "Authz Doomed" });

  ownerId = owner.id;
  otherId = other.id;

  ownerCookie = await signIn(OWNER);
  otherCookie = await signIn(OTHER);
  staffCookie = await signIn(STAFF);
  adminCookie = await signIn(ADMIN);

  categoryId = (await prisma.category.findFirstOrThrow({ where: { isActive: true } })).id;
  relatedSystemId = (await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } })).id;

  const ids = [ownerId, otherId];
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });

  const own = await prisma.ticket.create({
    data: {
      ticketNumber: "TKT-2094-000001",
      requesterId: ownerId,
      categoryId,
      relatedSystemId,
      summary: "Owned by the caller under test",
      description: "The ticket the authorization suite is allowed to read.",
      requestedPriority: "MEDIUM",
    },
  });
  ownTicketId = own.id;

  const foreign = await prisma.ticket.create({
    data: {
      ticketNumber: "TKT-2094-000002",
      requesterId: otherId,
      categoryId,
      relatedSystemId,
      summary: "Owned by somebody else entirely",
      description: "The ticket the authorization suite must never be able to read.",
      requestedPriority: "HIGH",
    },
  });
  foreignTicketId = foreign.id;

  ownAttachmentId = (
    await prisma.attachment.create({
      data: {
        ticketId: ownTicketId,
        originalFilename: "mine.png",
        storedFilename: "authz-own.png",
        mimeType: "image/png",
        sizeBytes: 64,
      },
    })
  ).id;

  foreignAttachmentId = (
    await prisma.attachment.create({
      data: {
        ticketId: foreignTicketId,
        originalFilename: "theirs.pdf",
        storedFilename: "authz-foreign.pdf",
        mimeType: "application/pdf",
        sizeBytes: 96,
      },
    })
  ).id;

  removedAttachmentId = (
    await prisma.attachment.create({
      data: {
        ticketId: ownTicketId,
        originalFilename: "gone.pdf",
        storedFilename: "authz-removed.pdf",
        mimeType: "application/pdf",
        sizeBytes: 32,
        removedAt: new Date("2026-06-01T00:00:00.000Z"),
        removedReason: "Removed before this suite ran, on purpose.",
      },
    })
  ).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });
  const ids = users.map((u) => u.id);
  await prisma.attachment.deleteMany({ where: { ticket: { requesterId: { in: ids } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  // Sessions follow their users through the schema's cascade.
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("Gate 2 — authentication", () => {
  it("API-AUTHZ-01 / BR-19: every protected endpoint refuses a request with no cookie", async () => {
    for (const call of protectedCalls()) {
      const res = await call.send(null);

      expect(res.status, `${call.name} without a session`).toBe(401);
      expect(res.body.error.code, call.name).toBe("UNAUTHENTICATED");
      // 401, not 403: nothing is known about the caller yet, so there is no
      // role to refuse (api-spec.md §3).
      expect(res.body.error).not.toHaveProperty("field");
    }
  });

  it("API-AUTHZ-01 / BR-19: a cookie that names no session is unauthenticated, not a server error", async () => {
    for (const call of protectedCalls()) {
      const res = await call.send(`tt_session=${"f".repeat(64)}`);

      expect(res.status, `${call.name} with an unknown session id`).toBe(401);
      expect(res.body.error.code, call.name).toBe("UNAUTHENTICATED");
    }
  });
});

describe("Gate 4 — role", () => {
  const requesterOnlyCalls = () => protectedCalls().filter((c) => REQUESTER_ONLY.has(c.name));

  it("API-AUTHZ-06 / BR-19: IT Staff are refused the Requester-only endpoints", async () => {
    for (const call of requesterOnlyCalls()) {
      const res = await call.send(staffCookie);

      // 403 rather than 404: the existence of the Requester endpoints is not a
      // secret, and pretending they are absent would mislead a legitimate
      // caller in the wrong role (api-spec.md §3).
      expect(res.status, `${call.name} as IT Staff`).toBe(403);
      expect(res.body.error.code, call.name).toBe("FORBIDDEN");
    }
  });

  it("API-AUTHZ-06 / BR-19: an Administrator is refused them too, and nothing is created", async () => {
    const before = await prisma.ticket.count();

    for (const call of requesterOnlyCalls()) {
      const res = await call.send(adminCookie);
      expect(res.status, `${call.name} as an Administrator`).toBe(403);
      expect(res.body.error.code, call.name).toBe("FORBIDDEN");
    }

    // The refusal happens before the handler, so the POST in the table left
    // nothing behind. A 403 that still wrote a row would be no refusal at all.
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("API-AUTHZ-06: the three read endpoints that widen in Issue #32 are still Requester-only today", async () => {
    // Not an assertion that this is right. api-spec.md §6 widens all three to
    // "anyone who may read the parent Ticket" (BR-17, FR-21, AC-26), and
    // Issue #32 is where that happens because it is the issue that decides
    // what a staff caller sees on a Ticket.
    //
    // It is recorded rather than left blank so the change is deliberate: when
    // #32 widens them this test fails, and whoever is holding it has to come
    // here, read this, and move the endpoint into the widened case instead of
    // discovering the behaviour changed by accident.
    const widening = protectedCalls().filter((c) => !REQUESTER_ONLY.has(c.name));
    expect(widening.map((c) => c.name)).toEqual([
      "GET /api/tickets/:id",
      "GET /api/attachments/:id",
      "GET /api/attachments/:id/download",
    ]);

    for (const call of widening) {
      const res = await call.send(staffCookie);
      expect(res.status, `${call.name} as IT Staff`).toBe(403);
    }
  });

  it("API-AUTHZ-06 / BR-19: the refusal does not depend on the request being otherwise valid", async () => {
    // A malformed body under the wrong role must still be 403, never 400:
    // validation runs inside the handler, and the handler is never reached.
    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", staffCookie)
      .send({ summary: "" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("Gate 5 — ownership", () => {
  it("API-AUTHZ-07 / BR-16: another Requester's Ticket answers exactly as one that never existed", async () => {
    const foreign = await request(app)
      .get(`/api/tickets/${foreignTicketId}`)
      .set("Cookie", ownerCookie);
    const absent = await request(app)
      .get(`/api/tickets/${NEVER_EXISTED}`)
      .set("Cookie", ownerCookie);

    expect(foreign.status).toBe(404);
    // Byte-identical, not merely both 404. Any difference in code or wording
    // would let a caller probe which ids are real (BR-16).
    expect(foreign.body).toEqual(absent.body);
    expect(foreign.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("API-AUTHZ-07 / BR-16: the list never contains a Ticket the caller does not own", async () => {
    const res = await request(app)
      .get("/api/tickets?pageSize=50")
      .set("Cookie", ownerCookie);

    expect(res.status).toBe(200);
    const owners: number[] = res.body.data.map((t: { requesterId: number }) => t.requesterId);
    expect(owners.every((id) => id === ownerId)).toBe(true);
    expect(res.body.data.some((t: { id: number }) => t.id === foreignTicketId)).toBe(false);
  });

  it("API-AUTHZ-09 / BR-16: another Requester's attachment is not readable, downloadable or removable", async () => {
    const absent = await request(app)
      .get(`/api/attachments/${NEVER_EXISTED}`)
      .set("Cookie", ownerCookie);

    const metadata = await request(app)
      .get(`/api/attachments/${foreignAttachmentId}`)
      .set("Cookie", ownerCookie);
    expect(metadata.status).toBe(404);
    expect(metadata.body).toEqual(absent.body);
    expect(metadata.body.error.code).toBe("ATTACHMENT_NOT_FOUND");

    const download = await request(app)
      .get(`/api/attachments/${foreignAttachmentId}/download`)
      .set("Cookie", ownerCookie);
    expect(download.status).toBe(404);
    expect(download.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
    // The bytes are the thing being protected; a body that leaked the stored
    // name would be a smaller failure of the same rule.
    expect(JSON.stringify(download.body)).not.toContain("authz-foreign");

    const remove = await request(app)
      .delete(`/api/attachments/${foreignAttachmentId}`)
      .set("Cookie", ownerCookie)
      .send({ removalReason: "Trying to remove somebody else's attachment." });
    expect(remove.status).toBe(404);

    const untouched = await prisma.attachment.findUniqueOrThrow({
      where: { id: foreignAttachmentId },
    });
    expect(untouched.removedAt).toBeNull();
  });
});

describe("Identity comes from the session", () => {
  it("API-AUTHZ-08 / AC-03, BR-03: X-Requester-Id naming another user changes nothing", async () => {
    const list = await request(app)
      .get("/api/tickets?pageSize=50")
      .set("Cookie", ownerCookie)
      .set("X-Requester-Id", String(otherId));

    expect(list.status).toBe(200);
    const owners: number[] = list.body.data.map((t: { requesterId: number }) => t.requesterId);
    expect(owners.every((id) => id === ownerId)).toBe(true);

    const detail = await request(app)
      .get(`/api/tickets/${foreignTicketId}`)
      .set("Cookie", ownerCookie)
      .set("X-Requester-Id", String(otherId));
    expect(detail.status).toBe(404);

    const created = await request(app)
      .post("/api/tickets")
      .set("Cookie", ownerCookie)
      .set("X-Requester-Id", String(otherId))
      .send(ticketBody("Created while claiming to be somebody else"));
    expect(created.status).toBe(201);
    // The header is not merely outranked by the session — it is not read at
    // all. The new Ticket belongs to whoever the cookie names.
    expect(created.body.data.requesterId).toBe(ownerId);
  });

  it("API-AUTHZ-08 / AC-03, BR-03: a requesterId in the body is ignored too", async () => {
    // api-spec.md §6 names the body as well as the header: "`requesterId` comes
    // from the session and a `requesterId` in the body is ignored". AC-03 says
    // "when the client supplies another `requesterId`" without naming where —
    // so testing only the header would leave the other half of the criterion
    // resting on the fact that nothing happens to read it today.
    const created = await request(app)
      .post("/api/tickets")
      .set("Cookie", ownerCookie)
      .send({ ...ticketBody("Created with a forged body field"), requesterId: otherId });

    expect(created.status).toBe(201);
    expect(created.body.data.requesterId).toBe(ownerId);

    // And it is not merely overridden on the way out: the stored row belongs to
    // the session user, so the other Requester never sees it in their list.
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(stored.requesterId).toBe(ownerId);

    const theirList = await request(app)
      .get("/api/tickets?pageSize=50")
      .set("Cookie", otherCookie);
    expect(theirList.body.data.some((t: { id: number }) => t.id === created.body.data.id)).toBe(false);
  });

  it("API-AUTHZ-08 / AC-25, BR-03: the header on its own opens nothing", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .set("X-Requester-Id", String(ownerId));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("API-AUTHZ-10 / AC-24, BR-12: a live session stops working the moment its account is deactivated", async () => {
    const doomedCookie = await signIn(DOOMED);
    expect((await request(app).get("/api/auth/me").set("Cookie", doomedCookie)).status).toBe(200);

    // The Administrator endpoint that performs this arrives with Issue #33,
    // and API-USER-17 covers its side of BR-12 — that deactivating also
    // deletes the rows. What is asserted here is the half that lives in this
    // issue: the gate re-reads the account on every request, so the refusal
    // does not depend on that cleanup having run.
    await prisma.user.update({ where: { email: DOOMED }, data: { isActive: false } });

    const after = await request(app).get("/api/auth/me").set("Cookie", doomedCookie);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");

    const ticket = await request(app).get("/api/tickets").set("Cookie", doomedCookie);
    expect(ticket.status).toBe(401);

    await prisma.user.update({ where: { email: DOOMED }, data: { isActive: true } });
  });
});

describe("What responses are allowed to contain", () => {
  it("API-AUTHZ-11 / BR-07: no response body carries a password hash or a session identifier", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: OWNER, password: TEST_PASSWORD });
    const cookie = (loginRes.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const sessionId = cookie.split("=")[1];
    // Logging in replaces the previous session rather than adding one
    // (api-spec.md §4), so the one this suite was holding is now gone. Adopt
    // the new cookie instead of leaving a dead one behind for later tests —
    // they would fail with 401 and blame the wrong thing.
    ownerCookie = cookie;

    const responses: Array<[string, { body: unknown }]> = [
      ["POST /api/auth/login", loginRes],
      ["GET /api/auth/me", await request(app).get("/api/auth/me").set("Cookie", cookie)],
      [
        "POST /api/tickets",
        await request(app)
          .post("/api/tickets")
          .set("Cookie", cookie)
          .send(ticketBody("Body sweep")),
      ],
      ["GET /api/tickets", await request(app).get("/api/tickets").set("Cookie", cookie)],
      [
        "GET /api/tickets/:id",
        await request(app).get(`/api/tickets/${ownTicketId}`).set("Cookie", cookie),
      ],
      [
        "GET /api/attachments/:id",
        await request(app).get(`/api/attachments/${ownAttachmentId}`).set("Cookie", cookie),
      ],
      ["401", await request(app).get("/api/tickets")],
      ["403", await request(app).get("/api/tickets").set("Cookie", staffCookie)],
      [
        "404",
        await request(app).get(`/api/tickets/${foreignTicketId}`).set("Cookie", cookie),
      ],
    ];

    for (const [name, res] of responses) {
      const text = JSON.stringify(res.body);
      expect(text, `${name} mentions passwordHash`).not.toContain("passwordHash");
      // bcrypt hashes all start this way, so this catches the value even if
      // some future code renames the field.
      expect(text, `${name} contains a bcrypt hash`).not.toMatch(/\$2[aby]?\$/);
      expect(text, `${name} echoes the session id`).not.toContain(sessionId);
    }
  });

  it("API-ERR-01 / BR-43: an unexpected failure is a generic 500 with nothing internal in it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.ticket, "count").mockRejectedValue(
      new Error('relation "Ticket" does not exist at C:\\CPE334\\tocktickit\\server\\src\\app.ts:1'),
    );

    const res = await request(app).get("/api/tickets").set("Cookie", ownerCookie);

    expect(res.status).toBe(500);
    // Compared whole rather than field by field: api-spec.md §6 says the 500
    // body is this and nothing else, and a `details` key added later would
    // pass a looser assertion.
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });

    const text = JSON.stringify(res.body);
    for (const leak of [/relation/i, /\.ts/, /prisma/i, /at .*:\d+/, /\\|\//]) {
      expect(text).not.toMatch(leak);
    }
    // The detail is not discarded — it goes to the server log, where it is
    // useful and not visible to the caller.
    expect(consoleError).toHaveBeenCalled();
  });

  it("API-ERR-02 / BR-43: 401, 403, 404 and 409 all use the one envelope", async () => {
    const cases: Array<[number, string, { status: number; body: { error?: unknown } }]> = [
      [401, "UNAUTHENTICATED", await request(app).get("/api/tickets")],
      [403, "FORBIDDEN", await request(app).get("/api/tickets").set("Cookie", staffCookie)],
      [
        404,
        "TICKET_NOT_FOUND",
        await request(app).get(`/api/tickets/${NEVER_EXISTED}`).set("Cookie", ownerCookie),
      ],
      [
        409,
        "ALREADY_REMOVED",
        await request(app)
          .delete(`/api/attachments/${removedAttachmentId}`)
          .set("Cookie", ownerCookie)
          .send({ removalReason: "Removing something already removed." }),
      ],
    ];

    for (const [status, code, res] of cases) {
      expect(res.status).toBe(status);
      const error = res.body.error as { code: string; message: string } | undefined;
      expect(error, `${status} has no error object`).toBeTruthy();
      expect(error!.code).toBe(code);
      expect(typeof error!.message).toBe("string");
      expect(error!.message.length).toBeGreaterThan(0);
      // api-spec.md §1: `error` is the only top-level key on a failure.
      expect(Object.keys(res.body)).toEqual(["error"]);
    }
  });

  it("API-ERR-02 / BR-43: an unrouted path is the envelope too, not Express's HTML page", async () => {
    const res = await request(app).get("/api/there-is-no-such-thing");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
