import request from "supertest";
import { app } from "../../src/app.js";
import { TEST_PASSWORD } from "./users.js";

// Lab 3, Issue #30 — test fixtures sign in for real.
//
// The suites could insert a Session row and hand themselves the id, and that
// would be faster. They do not, because every authorization test in this
// project exists to prove a gate works, and a fixture that forges its own
// identity walks around the gate rather than through it. Signing in exercises
// the same path a browser does.

/**
 * Signs in and returns the `Cookie` header value to replay.
 *
 * Throws rather than returning null on failure: a fixture that cannot sign in
 * is a broken fixture, and every assertion after it would fail for the wrong
 * reason — 401 everywhere, with nothing to say which account was at fault.
 */
export async function signIn(email: string, password: string = TEST_PASSWORD): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `test fixture could not sign in as ${email}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  if (!setCookie?.length) throw new Error(`login as ${email} returned no Set-Cookie`);
  return setCookie[0].split(";")[0];
}
