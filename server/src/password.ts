import bcrypt from "bcryptjs";

// Lab 3, Issue #29 — credential handling.
//
// Everything that turns what a person types into something the database can
// hold lives here, which is why email normalisation sits alongside the
// password functions: at login the address is half the credential, and the
// rule that decides whether an account is found (BR-36) belongs with the rule
// that decides whether the password matches (BR-07).

// BR-08. The upper bound is bcrypt's own input limit, made explicit rather
// than silently truncating: bcrypt ignores bytes past 72, so a 100-character
// password would quietly become a 72-character one and two different
// passwords could unlock the same account.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

// specification.md §11. Ten is the working cost; four is a test-speed
// decision and never applies anywhere else. The suites create an account per
// case, and a 100 ms hash each would dominate their runtime.
const COST = process.env.NODE_ENV === "test" ? 4 : 10;

export function isPasswordLengthValid(plain: string): boolean {
  return plain.length >= PASSWORD_MIN_LENGTH && plain.length <= PASSWORD_MAX_LENGTH;
}

// BR-07: a salted one-way hash, and nothing else, is ever stored.
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// BR-14 — the login handler compares against this when no account was found,
// so an unknown address costs the same hashing work as a wrong password and
// the two cannot be told apart by timing. It is computed once, at the same
// cost as a real hash, rather than hard-coded: a constant baked in at cost 10
// would make every failed login in the test suite 25x slower than a real one,
// which is the tell it exists to remove.
let dummyHash: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = bcrypt.hash("no account with this address", COST);
  return dummyHash;
}

// BR-36. Addresses are stored already trimmed and lower-cased, which is what
// makes the plain unique index enough for case-insensitive uniqueness —
// Postgres UNIQUE is case-sensitive on its own. Every write and every lookup
// goes through this one function so the two can never drift apart.
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
