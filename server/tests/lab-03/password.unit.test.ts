import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  isPasswordLengthValid,
  normaliseEmail,
  verifyPassword,
} from "../../src/password.js";

// tests.md UNIT-01, UNIT-02, UNIT-05. Pure logic, no database.

describe("password hashing", () => {
  it("UNIT-01 / BR-07: a hash verifies its own password, rejects another, and never equals the plaintext", async () => {
    const plain = "correct horse battery staple";
    const hash = await hashPassword(plain);

    expect(await verifyPassword(plain, hash)).toBe(true);
    expect(await verifyPassword("something else entirely", hash)).toBe(false);

    // The stored value must not contain the password in any recoverable form.
    expect(hash).not.toBe(plain);
    expect(hash).not.toContain(plain);
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("UNIT-01 / BR-07: the same password hashed twice gives different hashes that both verify", async () => {
    // A salted hash is the point: two accounts sharing a password must not
    // share a stored value, or the database itself would reveal the collision.
    const plain = "the same password twice";
    const [a, b] = [await hashPassword(plain), await hashPassword(plain)];

    expect(a).not.toBe(b);
    expect(await verifyPassword(plain, a)).toBe(true);
    expect(await verifyPassword(plain, b)).toBe(true);
  });

  it("UNIT-02 / BR-08: rejects 7 and 73 characters, accepts 8 and 72", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(72);

    expect(isPasswordLengthValid("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isPasswordLengthValid("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isPasswordLengthValid("a".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isPasswordLengthValid("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });

  it("UNIT-02 / BR-08: the 72-character bound is bcrypt's own limit, not an arbitrary one", async () => {
    // This is why the bound exists at all: bcrypt ignores input past 72 bytes,
    // so without the explicit limit two different long passwords would unlock
    // the same account. The rule turns a silent truncation into a rejection.
    const atLimit = "a".repeat(72);
    const beyond = atLimit + "difference-that-bcrypt-cannot-see";
    const hash = await hashPassword(atLimit);

    expect(await verifyPassword(beyond, hash)).toBe(true);
    expect(isPasswordLengthValid(beyond)).toBe(false);
  });
});

describe("email normalisation", () => {
  it("UNIT-05 / BR-36: trims surrounding whitespace and folds case", () => {
    expect(normaliseEmail("  Jennifer.Anderson@Example.EDU  ")).toBe(
      "jennifer.anderson@example.edu",
    );
    expect(normaliseEmail("already.lower@example.edu")).toBe("already.lower@example.edu");
  });

  it("UNIT-05 / BR-36: capitalisation never decides whether two addresses are the same account", () => {
    const written = normaliseEmail("Somsak.Wattana@Example.edu");
    const typedAtLogin = normaliseEmail("somsak.wattana@EXAMPLE.EDU");
    expect(written).toBe(typedAtLogin);
  });

  it("UNIT-05 / BR-36: inner whitespace is left alone — only the ends are trimmed", () => {
    // Normalising is not validating. An address with a space inside is invalid
    // and is rejected by the endpoint's validation, not silently repaired here.
    expect(normaliseEmail("  not valid@example.edu ")).toBe("not valid@example.edu");
  });
});
