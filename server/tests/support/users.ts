import type { Role } from "@prisma/client";
import { hashPassword, normaliseEmail } from "../../src/password.js";
import { getPrisma } from "../../src/prisma.js";

// Lab 3, Issue #29 — test fixtures for the User model.
//
// Lab 2's suites built their own throwaway Requesters inline, which stopped
// compiling when `Requester` became `User` and `passwordHash` became required.
// Rather than repeat the hash in eight places, every suite now goes through
// this helper — so when a rule about accounts changes, it changes once.

export const TEST_PASSWORD = "TestPassword123!";

// Hashed once per process. bcrypt is deliberately slow, and these suites
// create several accounts each; at the test cost factor (specification.md §11)
// one hash is a few milliseconds, but one per fixture would still add up
// across the whole run for no benefit — every fixture wants the same password.
let cached: Promise<string> | null = null;

function testPasswordHash(): Promise<string> {
  if (!cached) cached = hashPassword(TEST_PASSWORD);
  return cached;
}

export async function upsertTestUser(opts: {
  email: string;
  name: string;
  role?: Role;
  isActive?: boolean;
  mustChangePassword?: boolean;
}) {
  const email = normaliseEmail(opts.email);
  const role: Role = opts.role ?? "REQUESTER";
  const isActive = opts.isActive ?? true;
  const mustChangePassword = opts.mustChangePassword ?? false;

  // `update` re-asserts the state the caller asked for, because these fixtures
  // survive between runs: a suite that deactivates an account must find it
  // active again next time, not inherit the previous run's leftovers.
  return getPrisma().user.upsert({
    where: { email },
    update: { name: opts.name, role, isActive, mustChangePassword },
    create: {
      email,
      name: opts.name,
      role,
      isActive,
      mustChangePassword,
      passwordHash: await testPasswordHash(),
    },
  });
}
