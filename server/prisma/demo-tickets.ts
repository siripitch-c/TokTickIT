import { getPrisma } from "../src/prisma.js";
import { nextTicketNumber } from "../src/ticketNumber.js";

// Issue #14 — demo tickets for exercising My Tickets by hand.
//
// This is NOT part of `prisma db seed`: the seed carries reference data that
// every environment needs, while these are sample tickets for local testing
// and screenshots. Run it explicitly:
//
//   npx tsx prisma/demo-tickets.ts
//
// Safe to run repeatedly — it removes the demo tickets it created previously
// (matched on the marker below) before inserting a fresh set, so counts stay
// predictable instead of doubling each run.
//
// The shape is chosen to exercise the specification directly:
//   - Michael Brown: 13 tickets  -> AC-09's "one Requester has many", and two
//     pages at the default page size of 10 (BR-16)
//   - Jennifer Anderson: 3       -> the other side of AC-09's cross-Requester check
//   - Sarah Johnson / David Lee: 0 -> BR-37's empty state
// Summaries and categories vary so search and filters have something to
// distinguish (BR-13, BR-14).

const MARKER = "[demo]";

type Sample = { summary: string; description: string; category: string; system: string; priority: "LOW" | "MEDIUM" | "HIGH" };

const MICHAEL: Sample[] = [
  { summary: "VPN disconnects every few minutes", description: "The VPN client drops the connection roughly every five minutes while working from home.", category: "Network", system: "VPN", priority: "HIGH" },
  { summary: "Cannot sign in to campus Wi-Fi", description: "Wi-Fi authentication fails with an incorrect password error even after resetting my password.", category: "Network", system: "Campus Wi-Fi", priority: "HIGH" },
  { summary: "Laptop battery drains within an hour", description: "The corporate laptop battery goes from full to empty in under an hour of light use.", category: "Hardware", system: "Corporate Laptop", priority: "MEDIUM" },
  { summary: "Printer on the second floor jams constantly", description: "Every print job larger than five pages jams halfway through and has to be cleared manually.", category: "Hardware", system: "Printer", priority: "LOW" },
  { summary: "LEB2 page will not load course materials", description: "Opening a course in LEB2 shows a blank panel where the materials list should be.", category: "Software", system: "LEB2 App", priority: "MEDIUM" },
  { summary: "Grade submission times out on save", description: "Saving grades for a large section times out and the entered values are lost.", category: "Software", system: "Grade Submission App", priority: "HIGH" },
  { summary: "Email attachments over 5 MB are rejected", description: "Sending a report with a 6 MB attachment returns a delivery failure notice every time.", category: "Software", system: "Email", priority: "MEDIUM" },
  { summary: "Password reset link never arrives", description: "The reset email does not arrive in the inbox or the spam folder after several attempts.", category: "Account and Access", system: "Email", priority: "HIGH" },
  { summary: "Locked out after too many sign-in attempts", description: "My account locked after mistyping the password and I cannot find how to unlock it.", category: "Account and Access", system: "Email", priority: "MEDIUM" },
  { summary: "Need access to the shared department drive", description: "I was moved to a new department and no longer have access to the shared drive I need.", category: "Account and Access", system: "Other / Not Listed", priority: "LOW" },
  { summary: "External monitor is not detected", description: "The docking station no longer passes video through to the external monitor after an update.", category: "Hardware", system: "Corporate Laptop", priority: "LOW" },
  { summary: "VPN is very slow when connected", description: "File transfers over the VPN run at a fraction of the speed of a direct connection.", category: "Network", system: "VPN", priority: "MEDIUM" },
  { summary: "Software update fails partway through", description: "The update installer reaches ninety percent and then rolls itself back with no error shown.", category: "Software", system: "Corporate Laptop", priority: "LOW" },
];

const JENNIFER: Sample[] = [
  { summary: "Wi-Fi drops in the west building", description: "The connection drops whenever I move between the second and third floor of the west building.", category: "Network", system: "Campus Wi-Fi", priority: "MEDIUM" },
  { summary: "Cannot open PDF attachments in email", description: "PDF attachments open as a blank window instead of showing the document.", category: "Software", system: "Email", priority: "LOW" },
  { summary: "Keyboard keys stopped responding", description: "The left half of the keyboard stopped responding after liquid was spilled near it.", category: "Hardware", system: "Corporate Laptop", priority: "HIGH" },
];

async function main() {
  const prisma = getPrisma();

  const removed = await prisma.ticket.deleteMany({ where: { description: { contains: MARKER } } });
  if (removed.count > 0) console.log(`removed ${removed.count} demo tickets from a previous run`);

  const categories = new Map((await prisma.category.findMany()).map((c) => [c.name, c.id]));
  const systems = new Map((await prisma.relatedSystem.findMany()).map((s) => [s.name, s.id]));

  const plan: [string, Sample[]][] = [
    ["michael.brown@example.edu", MICHAEL],
    ["jennifer.anderson@example.edu", JENNIFER],
  ];

  for (const [email, samples] of plan) {
    const requester = await prisma.requester.findUnique({ where: { email } });
    if (!requester) {
      console.log(`skipped ${email} — not seeded; run "npx prisma db seed" first`);
      continue;
    }

    for (const sample of samples) {
      const categoryId = categories.get(sample.category);
      const relatedSystemId = systems.get(sample.system);
      if (!categoryId || !relatedSystemId) {
        throw new Error(`Seed data missing "${sample.category}" or "${sample.system}"`);
      }

      // Reuses the real generator so demo numbers share the production
      // sequence rather than inventing their own format.
      await prisma.$transaction(async (tx) => {
        const ticketNumber = await nextTicketNumber(tx, new Date().getFullYear());
        await tx.ticket.create({
          data: {
            ticketNumber,
            requesterId: requester.id,
            categoryId,
            relatedSystemId,
            summary: sample.summary,
            description: `${sample.description} ${MARKER}`,
            requestedPriority: sample.priority,
          },
        });
      });
    }
    console.log(`${requester.name}: ${samples.length} tickets`);
  }

  console.log("Sarah Johnson / David Lee: 0 tickets (empty state)");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect();
  process.exit(1);
});
