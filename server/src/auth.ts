import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Role, User } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendError } from "./requesterContext.js";

// Lab 3, Issue #29 — authenticated sessions (api-spec.md §1 and §3).
//
// The identity mechanism Lab 2 used, an unverified `X-Requester-Id` header, is
// replaced here by a session the server issues and can revoke. The header is
// not read by anything in this module: BR-03 requires the acting user to come
// from the session and from nothing the client can choose.

export const SESSION_COOKIE = "tt_session";

// BR-11. Long enough for a working day, short enough that a session abandoned
// on a shared machine expires the same day (specification.md §11).
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** The moment a session issued now stops being valid (BR-11). */
export function sessionExpiry(issuedAt: Date = new Date()): Date {
  return new Date(issuedAt.getTime() + SESSION_TTL_MS);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** A 256-bit opaque identifier — not a token that encodes anything (§11). */
function newSessionId(): string {
  return randomBytes(32).toString("hex");
}

// Express 4 does not parse cookies, and this application needs exactly one, so
// it reads that one rather than taking on a dependency to read them all.
// Values are hex, so no unescaping is required.
export function readSessionId(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

// The environments that run over plain http, and are therefore the only ones
// that may issue a cookie without `Secure`. An unset NODE_ENV counts as
// development, because that is what running `npm run dev` locally looks like.
//
// Stated as a list of exceptions rather than `=== "production"` so that a new
// environment name is secure by default: getting `Secure` wrongly *on* breaks
// a developer's login loudly and immediately, while getting it wrongly *off*
// sends a session cookie over plain http and nobody notices.
const PLAINTEXT_ENVIRONMENTS = new Set([undefined, "development", "test"]);

// BR-15. `sameSite: "lax"` is the CSRF control: the browser will not attach
// the cookie to a state-changing request started by another site, which is why
// this contract carries no CSRF token.
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: !PLAINTEXT_ENVIRONMENTS.has(process.env.NODE_ENV),
  };
}

export function setSessionCookie(res: Response, id: string): void {
  res.cookie(SESSION_COOKIE, id, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Issues a session, replacing any this user already had.
 *
 * api-spec.md §4: logging in again replaces the previous session rather than
 * adding one, so a browser never accumulates them and a user cannot quietly
 * hold a dozen live sessions.
 */
export async function createSession(userId: number): Promise<string> {
  const prisma = getPrisma();
  const id = newSessionId();
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.session.create({ data: { id, userId, expiresAt: sessionExpiry() } }),
  ]);
  return id;
}

/** BR-10: logout deletes the row, so replaying the cookie is unauthenticated. */
export async function destroySession(id: string): Promise<void> {
  await getPrisma().session.deleteMany({ where: { id } });
}

/**
 * Resolves the caller, or null when the request is unauthenticated.
 *
 * BR-11: an expired session is removed as it is encountered, so the table does
 * not accumulate dead rows and a replay of the same cookie cannot resurrect
 * one. BR-12: a deactivated account's sessions are deleted when it is
 * deactivated, but this also refuses an inactive user defensively — the gate
 * should not depend on that cleanup having run.
 */
async function resolveUser(req: Request): Promise<User | null> {
  const id = readSessionId(req);
  if (!id) return null;

  const prisma = getPrisma();
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session) return null;

  if (isExpired(session.expiresAt)) {
    await prisma.session.deleteMany({ where: { id } });
    return null;
  }
  if (!session.user.isActive) return null;

  return session.user;
}

// The safe user object of api-spec.md §4 — the only user shape any endpoint
// returns for the caller themselves. `passwordHash` is absent by construction
// rather than by deletion, so a future field cannot leak in by being forgotten
// (BR-07).
type SafeUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Gate 2 of api-spec.md §3 — no valid session is 401, never 403. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await resolveUser(req);
  if (!user) {
    sendError(res, 401, "UNAUTHENTICATED", "You are not signed in.");
    return;
  }
  req.user = user;
  next();
}

/**
 * Gate 3 — BR-02, AC-02.
 *
 * A user holding an initial password reaches nothing but the three operations
 * that let them leave that state: read the current user, change the password,
 * and log out. This is the enforcement point; the client's redirect is only
 * its visible half, which is the whole distinction the handout draws between
 * feedback and a security control.
 */
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.mustChangePassword) {
    sendError(
      res,
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Choose a new password before using the application.",
    );
    return;
  }
  next();
}

/**
 * Gate 4 — the role check the authorization matrix in specification.md §5
 * describes.
 *
 * It answers 403, never 404: a caller in the wrong role is told plainly,
 * because the *existence* of a queue or a user list is not a secret. Hiding
 * another user's resource is a different job, done by the ownership checks
 * inside each route, and those answer 404 (BR-16, BR-19).
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      sendError(res, 403, "FORBIDDEN", "You do not have access to this operation.");
      return;
    }
    next();
  };
}

/**
 * The three gates every Requester-scoped Lab 2 route now runs behind, in the
 * order api-spec.md §3 fixes: authenticated, past the password change, and
 * holding the Requester role. Exported as one array so no route can apply two
 * of the three and quietly lose the third.
 */
export const requesterOnly = [requireAuth, requirePasswordChanged, requireRole("REQUESTER")];

/**
 * The IT Staff Ticket endpoints of api-spec.md §7, in the same gate order.
 *
 * Administrators hold these too: the authorization matrix in specification.md
 * §5 grants them the Ticket operations, and a role that may own a Ticket has to
 * be able to find one in the queue.
 */
export const staffOnly = [
  requireAuth,
  requirePasswordChanged,
  requireRole("IT_STAFF", "ADMINISTRATOR"),
];
