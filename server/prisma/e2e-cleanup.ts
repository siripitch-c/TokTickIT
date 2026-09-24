import { getPrisma } from "../src/prisma.js";
import { deleteStoredFile } from "../src/uploads.js";

// Issue #17 — removes everything the end-to-end suite created, so a run leaves
// the database as it found it rather than adding tickets to the data the app is
// demonstrated with. Tickets are matched on the [e2e] marker their descriptions
// carry, the same way the demo data carries [demo].
//
// Lab 3, Issue #34 — the suite also creates accounts, every one with an `e2e-`
// email prefix (tests.md §6): its own fixtures (`e2e-setup.ts`) and the accounts
// E2E-09 and E2E-10 create through User Management. They go too, with anything
// they wrote. Users are never deleted in the running application (BR-39); these
// are test fixtures, removed by a development script.
//
// Run by the Playwright global setup and teardown, and safe to run by hand:
//   npm run e2e:cleanup --prefix server

const MARKER = "[e2e]";
const ACCOUNT_PREFIX = "e2e-";

async function main(): Promise<void> {
  const prisma = getPrisma();

  const users = await prisma.user.findMany({
    where: { email: { startsWith: ACCOUNT_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  const tickets = await prisma.ticket.findMany({
    where: { OR: [{ description: { contains: MARKER } }, { requesterId: { in: userIds } }] },
    select: { id: true },
  });

  if (tickets.length === 0 && users.length === 0) {
    console.log("e2e cleanup: nothing to remove.");
    return;
  }

  const ticketIds = tickets.map((ticket) => ticket.id);
  const attachments = await prisma.attachment.findMany({
    where: { ticketId: { in: ticketIds } },
    select: { storedFilename: true },
  });

  // Attachment rows first: the relation has no cascade, so the tickets cannot
  // go while rows still point at them. Files come last — a file left on disk
  // with no row is invisible, but a row pointing at a missing file is a 500
  // waiting to happen.
  // Lab 3, Issue #32: comments and notes point at their Ticket with no cascade
  // either, so they go first too — and Issue #34 adds anything an e2e account
  // wrote, wherever it wrote it, because the author relation has no cascade.
  await prisma.publicComment.deleteMany({
    where: { OR: [{ ticketId: { in: ticketIds } }, { authorId: { in: userIds } }] },
  });
  await prisma.internalNote.deleteMany({
    where: { OR: [{ ticketId: { in: ticketIds } }, { authorId: { in: userIds } }] },
  });
  await prisma.attachment.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });

  // The suite only claims its own tickets, which are gone by now. A surviving
  // ticket still owned by an e2e account would stop that account being removed,
  // so it is unassigned — and said out loud, because it means a test reached
  // data it should not have.
  const released = await prisma.ticket.updateMany({ where: { ownerId: { in: userIds } }, data: { ownerId: null } });
  if (released.count > 0) {
    console.warn(`e2e cleanup: unassigned ${released.count} ticket(s) outside the suite that an e2e account owned.`);
  }

  // Sessions cascade with their user.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const attachment of attachments) deleteStoredFile(attachment.storedFilename);

  console.log(
    `e2e cleanup: removed ${ticketIds.length} ticket(s), ${attachments.length} attachment(s) and ${userIds.length} account(s).`,
  );
}

main()
  .catch((error) => {
    console.error("e2e cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
