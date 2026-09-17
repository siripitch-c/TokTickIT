import { readFileSync } from "node:fs";
import type { Role } from "@prisma/client";
import { hashPassword, normaliseEmail, verifyPassword } from "../src/password.js";
import { getPrisma } from "../src/prisma.js";

// Lab 3, Issue #34 — the accounts the end-to-end suite signs in as, made fresh
// for every run by the Playwright global setup, after `e2e-cleanup.ts` has
// removed the previous run's.
//
// The suite does not sign in as the seeded people. Their passwords are whatever
// the developer last chose while trying the application, so a suite relying on
// them would fail for reasons that have nothing to do with the code. The one
// exception is the seeded Administrator: BR-38's refusal only exists for the last
// active Administrator acting on their own account (api-spec.md §9), so E2E-10
// has to be that account — and this checks it can be before a single test runs.
//
// The list lives in `e2e/support/accounts.json`, which the specs read too.
//   npm run e2e:setup --prefix server

interface FixtureFile {
  password: string;
  accounts: Record<string, { email: string; name: string; role: Role; isActive: boolean; mustChangePassword: boolean }>;
  administrator: { email: string; password: string };
}

const fixtures = JSON.parse(
  readFileSync(new URL("../../e2e/support/accounts.json", import.meta.url), "utf8"),
) as FixtureFile;

async function main(): Promise<void> {
  const prisma = getPrisma();

  // BR-46 in spirit: a development-only password, written in the repository on
  // purpose, for accounts that exist only while the suite runs.
  const passwordHash = await hashPassword(fixtures.password);
  for (const account of Object.values(fixtures.accounts)) {
    const email = normaliseEmail(account.email);
    const data = {
      name: account.name,
      role: account.role,
      isActive: account.isActive,
      mustChangePassword: account.mustChangePassword,
      passwordHash,
    };
    await prisma.user.upsert({ where: { email }, update: data, create: { ...data, email } });
  }

  const adminEmail = normaliseEmail(fixtures.administrator.email);
  const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const problems: string[] = [];
  if (!admin) {
    problems.push(`${adminEmail} does not exist. Run the seed: npm run prisma:seed --prefix server`);
  } else {
    if (admin.role !== "ADMINISTRATOR" || !admin.isActive) {
      problems.push(`${adminEmail} must be an active Administrator.`);
    }
    if (admin.mustChangePassword) {
      problems.push(`${adminEmail} must not be waiting for a password change.`);
    }
    if (!(await verifyPassword(fixtures.administrator.password, admin.passwordHash))) {
      problems.push(`${adminEmail} must still use the development password documented in the README.`);
    }
  }
  const otherAdministrators = await prisma.user.count({
    where: { role: "ADMINISTRATOR", isActive: true, email: { not: adminEmail } },
  });
  if (otherAdministrators > 0) {
    problems.push(
      `${adminEmail} must be the only active Administrator, because E2E-10 reaches the ` +
        `last-Administrator refusal; ${otherAdministrators} other active Administrator(s) found.`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`the end-to-end suite cannot start:\n- ${problems.join("\n- ")}`);
  }
  console.log(`e2e setup: ${Object.keys(fixtures.accounts).length} account(s) ready.`);
}

main()
  .catch((error) => {
    console.error("e2e setup failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
