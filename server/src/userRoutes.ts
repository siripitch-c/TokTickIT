import { Router } from "express";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { adminOnly, readSessionId } from "./auth.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword, isPasswordLengthValid, normaliseEmail } from "./password.js";
import { getPrisma } from "./prisma.js";
import { escapeLikePattern, readId, sendError, sendInternalError } from "./requesterContext.js";

// Lab 3, Issue #33 — Administrator user management (api-spec.md §9).
//
// BR-35 fixes an Administrator's authority over accounts at three operations —
// create, update, set a new initial password — and this module offers exactly
// those three plus the list they are chosen from. There is no delete (BR-39):
// deactivation is the only way an account stops working.

export const userRoutes = Router();

// Every route here is Administrator-only, and says so once: a route added later
// cannot forget the gate. Any other role gets a plain 403 (AC-21), because the
// existence of user management is not a secret.
userRoutes.use(adminOnly);

// api-spec.md §9 — the admin user object. Selected field by field, so a
// password hash is never loaded into a response, let alone sent (BR-07).
const ADMIN_USER = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ROLES: readonly Role[] = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"];
const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 200;
// A syntax check, not a deliverability check: one @, something either side, a
// dot in the domain, and no spaces. It stops a typo from becoming an account
// nobody can sign in to, which is all a server can promise about an address.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  name: `Name must be between ${NAME_MIN} and ${NAME_MAX} characters.`,
  email: "Enter a valid email address.",
  role: "Choose exactly one role.",
  isActive: "Choose whether the account is active.",
  initialPassword: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
  emailTaken: "An account with this email address already exists.",
  self: "You cannot remove your own administrator access.",
  lastAdmin: "At least one administrator must stay active.",
  notFound: "User not found.",
} as const;

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? name : null;
}

// BR-36: stored trimmed and lower-cased, the same way login looks it up.
function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = normaliseEmail(value);
  return email.length <= EMAIL_MAX && EMAIL_SHAPE.test(email) ? email : null;
}

// BR-18: exactly one. An array is not a role, and its first element is not
// quietly taken for one.
function readRole(value: unknown): Role | null {
  return ROLES.find((role) => role === value) ?? null;
}

// Explicit, never defaulted (api-spec.md §9): creating an inactive account has
// to be a decision.
function readIsActive(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// BR-08. Not trimmed — a password is exactly what was typed — but a value that
// is nothing except spaces is not one.
function readPassword(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && isPasswordLengthValid(value) ? value : null;
}

function bodyOf(req: Request): Record<string, unknown> {
  const body = req.body;
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function isEmailConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** A refusal decided inside a transaction, answered after it has rolled back. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/users — FR-22, FR-23, AC-27, BR-41.
// ---------------------------------------------------------------------------
userRoutes.get("/", async (req: Request, res: Response) => {
  // Lenient, like every query in the application: a value that is not usable is
  // ignored rather than refused.
  const query = req.query as Record<string, unknown>;
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const role = readRole(query.role);

  try {
    const pattern = escapeLikePattern(search);
    const data = await getPrisma().user.findMany({
      where: {
        ...(role ? { role } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: pattern, mode: "insensitive" as const } },
                { email: { contains: pattern, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: ADMIN_USER,
      // BR-41: by name, so an account can be found by eye; the id keeps two
      // people with the same name in a stable order. Inactive accounts are
      // included — hiding them would make reactivating one impossible.
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });

    // A plain array, not a pagination envelope: the handout excludes paging
    // this list, and metadata would describe a capability that does not exist.
    res.json({ data });
  } catch (error) {
    console.error("Error listing users:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users — FR-24, AC-17, AC-22, BR-35, BR-36.
// ---------------------------------------------------------------------------
userRoutes.post("/", async (req: Request, res: Response) => {
  const body = bodyOf(req);

  const name = readName(body.name);
  if (name === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.name, "name");
  const email = readEmail(body.email);
  if (email === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.email, "email");
  const role = readRole(body.role);
  if (role === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.role, "role");
  const isActive = readIsActive(body.isActive);
  if (isActive === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.isActive, "isActive");
  const initialPassword = readPassword(body.initialPassword);
  if (initialPassword === null) {
    return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.initialPassword, "initialPassword");
  }

  try {
    const data = await getPrisma().user.create({
      data: {
        name,
        email,
        role,
        isActive,
        passwordHash: await hashPassword(initialPassword),
        // AC-22: an initial password is used once, to choose a real one.
        mustChangePassword: true,
      },
      select: ADMIN_USER,
    });
    // The password is not echoed (BR-07). The Administrator typed it and it is
    // theirs to pass on.
    res.status(201).json({ data });
  } catch (error) {
    // BR-36, AC-17: the unique index on the normalised address decides, so two
    // simultaneous creates with the same address cannot both succeed.
    if (isEmailConflict(error)) {
      return sendError(res, 409, "EMAIL_ALREADY_EXISTS", MESSAGES.emailTaken, "email");
    }
    console.error("Error creating a user:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/users/:id — FR-25, AC-19, AC-20, AC-23, AC-24, BR-12, BR-35..BR-38.
// ---------------------------------------------------------------------------
userRoutes.patch("/:id", async (req: Request, res: Response) => {
  const actor = req.user!;
  const userId = readId(req.params.id);
  if (userId === null) return sendError(res, 404, "USER_NOT_FOUND", MESSAGES.notFound);

  // Any subset of the four; each one present is validated like creation.
  const body = bodyOf(req);
  const changes: { name?: string; email?: string; role?: Role; isActive?: boolean } = {};
  if (body.name !== undefined) {
    const name = readName(body.name);
    if (name === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.name, "name");
    changes.name = name;
  }
  if (body.email !== undefined) {
    const email = readEmail(body.email);
    if (email === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.email, "email");
    changes.email = email;
  }
  if (body.role !== undefined) {
    const role = readRole(body.role);
    if (role === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.role, "role");
    changes.role = role;
  }
  if (body.isActive !== undefined) {
    const isActive = readIsActive(body.isActive);
    if (isActive === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.isActive, "isActive");
    changes.isActive = isActive;
  }
  // An empty PATCH is a client bug, not a no-op worth confirming (api-spec.md §9).
  if (Object.keys(changes).length === 0) {
    return sendError(res, 400, "VALIDATION_ERROR", "Change at least one of name, email, role or status.");
  }

  try {
    const data = await getPrisma().$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
      });
      if (!target) throw new Refusal(404, "USER_NOT_FOUND", MESSAGES.notFound);

      const nextRole = changes.role ?? target.role;
      const nextActive = changes.isActive ?? target.isActive;
      // The control a refusal belongs on is the change that caused it. The Edit
      // dialog sends all four fields every time, so which ones are present says
      // nothing about which one was refused.
      const causedBy = nextActive ? "role" : "isActive";

      // BR-38, counted after the proposed change and inside this transaction.
      // The active Administrator rows are locked first, so two Administrators
      // demoting each other at the same moment are serialised: the second sees
      // the first one's commit and is refused, instead of both believing
      // another Administrator remains.
      //
      // It is checked before BR-37. The caller is always an active
      // Administrator, so a change to somebody else can never leave none; the
      // last Administrator can only be reached on the caller's own account.
      // Checking the self rule first would therefore make this refusal
      // unreachable outside a race, and the person who is the only one left
      // would be told the wrong reason.
      const losesAnAdministrator =
        target.role === "ADMINISTRATOR" && target.isActive && !(nextRole === "ADMINISTRATOR" && nextActive);
      if (losesAnAdministrator) {
        // In id order: two transactions taking the same rows in different
        // orders would deadlock, and PostgreSQL would end one of them with an
        // error instead of a refusal.
        await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMINISTRATOR' AND "isActive" = true ORDER BY id FOR UPDATE`;
        const others = await tx.user.count({
          where: { role: "ADMINISTRATOR", isActive: true, id: { not: target.id } },
        });
        if (others === 0) throw new Refusal(409, "LAST_ACTIVE_ADMINISTRATOR", MESSAGES.lastAdmin, causedBy);
      }

      // BR-37: with another Administrator still active, the refusal is about whose
      // account this is.
      if (target.id === actor.id && (!nextActive || nextRole !== "ADMINISTRATOR")) {
        throw new Refusal(409, "SELF_DEACTIVATION", MESSAGES.self, causedBy);
      }

      // A role change is not a credential change, so mustChangePassword is left
      // alone. Tickets the user owns keep that owner either way (BR-26).
      const updated = await tx.user.update({ where: { id: userId }, data: changes, select: ADMIN_USER });

      // BR-12, AC-24: deactivation ends every open session in the same
      // transaction, so the account stops working on its very next request.
      if (target.isActive && !nextActive) {
        await tx.session.deleteMany({ where: { userId } });
      }
      return updated;
    });

    res.json({ data });
  } catch (error) {
    if (error instanceof Refusal) {
      return sendError(res, error.status, error.code, error.message, error.field);
    }
    if (isEmailConflict(error)) {
      return sendError(res, 409, "EMAIL_ALREADY_EXISTS", MESSAGES.emailTaken, "email");
    }
    console.error("Error updating a user:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/users/:id/initial-password — FR-26, AC-18, BR-12, BR-35.
// ---------------------------------------------------------------------------
userRoutes.post("/:id/initial-password", async (req: Request, res: Response) => {
  const actor = req.user!;
  const userId = readId(req.params.id);
  if (userId === null) return sendError(res, 404, "USER_NOT_FOUND", MESSAGES.notFound);

  const initialPassword = readPassword(bodyOf(req).initialPassword);
  if (initialPassword === null) {
    return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.initialPassword, "initialPassword");
  }

  try {
    const prisma = getPrisma();
    if ((await prisma.user.count({ where: { id: userId } })) === 0) {
      return sendError(res, 404, "USER_NOT_FOUND", MESSAGES.notFound);
    }

    // Whoever was using the old password stops (BR-12). On an Administrator's
    // own account the session making this request survives, exactly as a
    // password change keeps it: their next request lands on Change Password
    // rather than on Login (api-spec.md §9).
    const keep = userId === actor.id ? readSessionId(req) : null;
    const [data] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(initialPassword), mustChangePassword: true },
        select: ADMIN_USER,
      }),
      prisma.session.deleteMany({ where: { userId, ...(keep ? { id: { not: keep } } : {}) } }),
    ]);

    // Never echoed (BR-07, AC-18).
    res.json({ data });
  } catch (error) {
    console.error("Error setting an initial password:", error);
    sendInternalError(res);
  }
});
