import { getPrisma } from "../src/prisma.js";

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

  // Issue #12 — Development Requesters (specification.md §7: >=4 active,
  // >=1 inactive). Upsert on email keeps this idempotent.
  const requesters: { name: string; email: string; isActive: boolean }[] = [
    { name: "Jennifer Anderson", email: "jennifer.anderson@example.edu", isActive: true },
    { name: "Michael Brown", email: "michael.brown@example.edu", isActive: true },
    { name: "Sarah Johnson", email: "sarah.johnson@example.edu", isActive: true },
    { name: "David Lee", email: "david.lee@example.edu", isActive: true },
    { name: "Former Student", email: "former.student@example.edu", isActive: false },
  ];

  for (const r of requesters) {
    await prisma.requester.upsert({
      where: { email: r.email },
      update: {},
      create: r,
    });
  }

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
