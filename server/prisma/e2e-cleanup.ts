import { getPrisma } from "../src/prisma.js";
import { deleteStoredFile } from "../src/uploads.js";

// Issue #17 — removes everything the end-to-end suite created, so a run leaves
// the database as it found it rather than adding tickets to the data the app is
// demonstrated with. Tickets are matched on the [e2e] marker their descriptions
// carry, the same way the demo data carries [demo].
//
// Run automatically by the Playwright global teardown, and safe to run by hand:
//   npm run e2e:cleanup --prefix server

const MARKER = "[e2e]";

async function main(): Promise<void> {
  const prisma = getPrisma();

  const tickets = await prisma.ticket.findMany({
    where: { description: { contains: MARKER } },
    select: { id: true },
  });

  if (tickets.length === 0) {
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
  await prisma.attachment.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  for (const attachment of attachments) deleteStoredFile(attachment.storedFilename);

  console.log(
    `e2e cleanup: removed ${ticketIds.length} ticket(s) and ${attachments.length} attachment(s).`,
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
