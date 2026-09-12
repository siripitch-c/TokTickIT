import type { Role } from "@prisma/client";
import { hashPassword, normaliseEmail } from "../src/password.js";
import { getPrisma } from "../src/prisma.js";

// Lab 3, Issue #29 — the one local-development password every seeded account
// uses. BR-46: development-only, documented in the README, never a real
// personal password, and never a production credential.
const DEV_PASSWORD = "ChangeMe123!";

// Issue 3 — seed the four supported categories.
// The four names are: Account and Access, Hardware, Software, Network.
// Requirement: running the seed twice must NOT create duplicates.
// Hint: prisma.category.upsert({ where:{name}, update:{}, create:{name} }).
async function main() {
  const prisma = getPrisma();
  
  const categories = [
    "Account and Access",
    "Hardware",
    "Software",
    "Network"
  ];

  for (const name of categories) {
    await prisma.category.upsert({
      where: { name: name },
      update: {},
      create: { name: name },
    });
  }

  // Issue #12 — Related Systems (specification.md §7: >=6 active, plus a
  // catch-all "Other / Not Listed" so Related System can stay required).
  const relatedSystems = [
    "Email",
    "Campus Wi-Fi",
    "VPN",
    "LEB2 App",
    "Grade Submission App",
    "Printer",
    "Corporate Laptop",
    "Other / Not Listed",
  ];

  for (const name of relatedSystems) {
    await prisma.relatedSystem.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Issue #12, extended by Lab 3 Issue #29 — the accounts the application runs
  // on. lab-03/specification.md §7 and the handout §5.3 require at least four
  // active Requesters and one inactive, three active IT Staff and one
  // inactive, and one active Administrator.
  //
  // The first five rows are the Lab 2 Development Requesters. On the developer
  // database they already exist as migrated `User` rows, and `update: {}` is
  // what keeps this seed from overwriting them — their `mustChangePassword`
  // flag is migration evidence (MIG-03) and must survive a re-seed. On a fresh
  // clone the same five rows are created here instead.
  //
  // BR-46: every password below is the same documented local-development
  // value. It is not a secret, it is not anyone's real password, and it is
  // recorded in the README.
  const password = await hashPassword(DEV_PASSWORD);

  const users: {
    name: string;
    email: string;
    role: Role;
    isActive: boolean;
    mustChangePassword: boolean;
  }[] = [
    // Requesters — four active, one inactive.
    { name: "Jennifer Anderson", email: "jennifer.anderson@example.edu", role: "REQUESTER", isActive: true, mustChangePassword: false },
    { name: "Michael Brown", email: "michael.brown@example.edu", role: "REQUESTER", isActive: true, mustChangePassword: false },
    { name: "Sarah Johnson", email: "sarah.johnson@example.edu", role: "REQUESTER", isActive: true, mustChangePassword: false },
    // Seeded deliberately unchanged so the mandatory first-login flow (BR-02,
    // AC-02) can be demonstrated on a fresh database without an Administrator
    // having to reset somebody first.
    { name: "David Lee", email: "david.lee@example.edu", role: "REQUESTER", isActive: true, mustChangePassword: true },
    { name: "Former Student", email: "former.student@example.edu", role: "REQUESTER", isActive: false, mustChangePassword: false },

    // IT Staff — three active, one inactive. The inactive one exists so that
    // BR-25 can be tested: a deactivated account must not be offered as a
    // Ticket Owner (API-TICKET-04, API-QUEUE-12).
    { name: "Somsak Wattana", email: "somsak.wattana@example.edu", role: "IT_STAFF", isActive: true, mustChangePassword: false },
    { name: "Nattapong Sri", email: "nattapong.sri@example.edu", role: "IT_STAFF", isActive: true, mustChangePassword: false },
    { name: "Preecha Thongchai", email: "preecha.thongchai@example.edu", role: "IT_STAFF", isActive: true, mustChangePassword: false },
    { name: "Retired Technician", email: "retired.technician@example.edu", role: "IT_STAFF", isActive: false, mustChangePassword: false },

    // Administrator — one active. A second is deliberately absent: with only
    // one, the last-active-Administrator guard (BR-38, AC-19) is reachable by
    // hand on the developer database, not only in a test fixture.
    { name: "Anong Kittisak", email: "anong.kittisak@example.edu", role: "ADMINISTRATOR", isActive: true, mustChangePassword: false },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: normaliseEmail(u.email) },
      update: {},
      create: { ...u, email: normaliseEmail(u.email), passwordHash: password },
    });
  }

  // Tickets spread across statuses, priorities and ownership, plus example
  // Public Comments and Internal Notes, are also required by the handout §5.3.
  // They are seeded by Issue #31 and Issue #32, where the Queue and the
  // operational Ticket Detail that read them are built — seeding them now
  // would add demo rows that nothing yet displays. The Tickets already in the
  // developer database are the Lab 2 ones, and this seed deliberately leaves
  // them untouched so they stay usable as migration evidence (AC-08).

  console.log("Seeding finished.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
