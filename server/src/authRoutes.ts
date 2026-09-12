import { Router } from "express";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionId,
  requireAuth,
  setSessionCookie,
  toSafeUser,
} from "./auth.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  getDummyHash,
  hashPassword,
  isPasswordLengthValid,
  normaliseEmail,
  verifyPassword,
} from "./password.js";
import { getPrisma } from "./prisma.js";
import { sendError, sendInternalError } from "./requesterContext.js";

// Lab 3, Issue #29 — the authentication endpoints of api-spec.md §4.
//
// These four are the only routes exempt from the password-change gate, because
// they are the way into and out of it (BR-02).

export const authRoutes = Router();

// BR-06: one message for every way a login can fail. The interface must not
// soften it for any of the three cases, since that would restore exactly the
// distinction this removes.
const CREDENTIALS_MESSAGE = "Email or password is incorrect.";

function readNonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// POST /api/auth/login — FR-01, FR-02, AC-01
// ---------------------------------------------------------------------------
authRoutes.post("/login", async (req, res) => {
  try {
    const rawEmail = readNonBlank(req.body?.email);
    if (!rawEmail) {
      // A blank submission is a 400, not a 401: nothing was actually
      // attempted, so there is no credential to have got wrong.
      return sendError(res, 400, "VALIDATION_ERROR", "Email is required.", "email");
    }
    const password = readNonBlank(req.body?.password);
    if (!password) {
      return sendError(res, 400, "VALIDATION_ERROR", "Password is required.", "password");
    }

    const prisma = getPrisma();
    const email = normaliseEmail(rawEmail);
    const user = await prisma.user.findUnique({ where: { email } });

    // BR-14: every failing branch performs the same bcrypt comparison, against
    // a fixed dummy hash when no account was found, so an unknown address and
    // a wrong password cannot be told apart by how long the answer takes.
    const hash = user ? user.passwordHash : await getDummyHash();
    const passwordMatches = await verifyPassword(password, hash);

    // BR-01: an inactive account is refused even with the right password, and
    // is refused with the same words, so the response never reveals that the
    // address belongs to a real but disabled account (AC-05).
    if (!user || !user.isActive || !passwordMatches) {
      console.warn(
        `auth: failed login for ${email} from ${req.ip ?? "unknown"} at ${new Date().toISOString()}`,
      );
      return sendError(res, 401, "INVALID_CREDENTIALS", CREDENTIALS_MESSAGE);
    }

    const sessionId = await createSession(user.id);
    setSessionCookie(res, sessionId);
    return res.status(200).json({ data: toSafeUser(user) });
  } catch (error) {
    console.error("auth: login failed:", error);
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — FR-04, AC-06
// ---------------------------------------------------------------------------
authRoutes.post("/logout", requireAuth, async (req, res) => {
  try {
    const id = readSessionId(req);
    if (id) await destroySession(id);
    clearSessionCookie(res);
    // No body: nothing about a destroyed session is worth returning.
    return res.status(204).end();
  } catch (error) {
    console.error("auth: logout failed:", error);
    return sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me — FR-03, BR-13
// ---------------------------------------------------------------------------
authRoutes.get("/me", requireAuth, (req, res) => {
  // requireAuth answers 401 when there is no valid session, so this never
  // returns 200 with a null user — the client cannot confuse "not signed in"
  // with "signed in as nobody".
  return res.status(200).json({ data: toSafeUser(req.user!) });
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password — FR-05, FR-06, AC-02
//
// One endpoint for both the mandatory first-login change and a voluntary one;
// it does not distinguish them, because the rules are identical.
// ---------------------------------------------------------------------------
authRoutes.post("/change-password", requireAuth, async (req, res) => {
  try {
    const user = req.user!;

    const currentPassword = readNonBlank(req.body?.currentPassword);
    if (!currentPassword) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Your current password is required.",
        "currentPassword",
      );
    }
    const newPassword = readNonBlank(req.body?.newPassword);
    if (!newPassword) {
      return sendError(res, 400, "VALIDATION_ERROR", "A new password is required.", "newPassword");
    }
    const confirmPassword = readNonBlank(req.body?.confirmPassword);
    if (!confirmPassword) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Please type the new password again.",
        "confirmPassword",
      );
    }

    // Required even during a mandatory change: the user typed it on the Login
    // screen moments earlier, and requiring it means an unattended signed-in
    // browser cannot have its password silently replaced.
    //
    // A wrong value is 400, not 401 — the session itself is perfectly valid,
    // so answering 401 would tell the client to send the user back to Login.
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Your current password is incorrect.",
        "currentPassword",
      );
    }

    // BR-08
    if (!isPasswordLengthValid(newPassword)) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
        "newPassword",
      );
    }
    // BR-09
    if (newPassword === currentPassword) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Your new password must be different from your current one.",
        "newPassword",
      );
    }
    if (confirmPassword !== newPassword) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "The two passwords do not match.",
        "confirmPassword",
      );
    }

    const prisma = getPrisma();
    const passwordHash = await hashPassword(newPassword);
    const currentSessionId = readSessionId(req);

    // A password change is exactly when other open sessions should stop, so
    // every session but this one is dropped (BR-12). The current one survives:
    // the person changing the password is not the one to lock out.
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
      prisma.session.deleteMany({
        where: { userId: user.id, id: { not: currentSessionId ?? "" } },
      }),
    ]);

    return res.status(200).json({ data: toSafeUser(updated) });
  } catch (error) {
    console.error("auth: change-password failed:", error);
    return sendInternalError(res);
  }
});
