import type { ActionStatus, CurrentStatus, Role } from "@prisma/client";
import { hashPassword, normaliseEmail } from "../src/password.js";
import { getPrisma } from "../src/prisma.js";
import { nextTicketNumber } from "../src/ticketNumber.js";

// Lab 3, Issue #29 — the one local-development password every seeded account
// uses. BR-45: development-only, documented in the README, never a real
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
  // BR-45: every password below is the same documented local-development
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

  // Lab 3, Issue #31 — Tickets for the IT Staff Ticket Queue.
  //
  // specification.md §7 requires them to span Requesters, statuses, priorities,
  // and both assigned and unassigned ownership, so every filter and sort on the
  // queue has something to distinguish. Example Public Comments and Internal
  // Notes on some of them are seeded further down (Issue #32).
  //
  // These are separate from `prisma/demo-tickets.ts`, which Lab 2 kept outside
  // the seed for My Tickets screenshots. They carry their own marker so neither
  // that script's cleanup nor the e2e cleanup ever removes them, and they leave
  // Sarah Johnson and David Lee without tickets so the Lab 2 empty state stays
  // demonstrable. The Lab 2 Tickets already in the developer database are not
  // touched either — they are migration evidence (AC-08).
  //
  // Idempotent the same way the accounts are: a ticket already present is left
  // exactly as it is, so a status someone changed while trying out the queue is
  // not reset by the next seed.
  const SEED_MARKER = "[seed]";
  const DAY_MS = 24 * 60 * 60 * 1000;

  type Priority = "LOW" | "MEDIUM" | "HIGH";
  const tickets: {
    requester: string;
    summary: string;
    description: string;
    category: string;
    system: string;
    requestedPriority: Priority;
    itPriority: Priority;
    status: CurrentStatus;
    owner: string | null;
    createdDaysAgo: number;
    updatedDaysAgo: number;
  }[] = [
    // New — BR-27: a Ticket starts unassigned, so both are.
    { requester: "michael.brown@example.edu", summary: "Shared drive permissions reset after the weekend", description: "Every folder on the department drive now shows read-only for my account.", category: "Account and Access", system: "Other / Not Listed", requestedPriority: "HIGH", itPriority: "HIGH", status: "NEW", owner: null, createdDaysAgo: 0.2, updatedDaysAgo: 0.2 },
    { requester: "jennifer.anderson@example.edu", summary: "Projector in room 402 shows no signal", description: "The projector powers on but reports no input from the lectern laptop.", category: "Hardware", system: "Other / Not Listed", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "NEW", owner: null, createdDaysAgo: 0.6, updatedDaysAgo: 0.6 },

    // Open — one still waiting to be claimed, one already picked up.
    { requester: "michael.brown@example.edu", summary: "Email signature images appear as attachments", description: "Recipients see the logo in my signature as a separate attachment.", category: "Software", system: "Email", requestedPriority: "LOW", itPriority: "LOW", status: "OPEN", owner: null, createdDaysAgo: 3, updatedDaysAgo: 1.5 },
    { requester: "former.student@example.edu", summary: "Need final transcript access before account closes", description: "I still need to download my final transcript before graduation.", category: "Account and Access", system: "LEB2 App", requestedPriority: "MEDIUM", itPriority: "HIGH", status: "OPEN", owner: "somsak.wattana@example.edu", createdDaysAgo: 9, updatedDaysAgo: 2 },

    // In Progress — the state a queue is scanned for.
    { requester: "michael.brown@example.edu", summary: "VPN drops when switching to mobile hotspot", description: "The VPN session ends each time my laptop moves from office Wi-Fi to a hotspot.", category: "Network", system: "VPN", requestedPriority: "HIGH", itPriority: "HIGH", status: "IN_PROGRESS", owner: "nattapong.sri@example.edu", createdDaysAgo: 4, updatedDaysAgo: 0.4 },
    { requester: "jennifer.anderson@example.edu", summary: "Grade submission rejects decimal scores", description: "Entering 7.5 in the grade column shows an invalid number message.", category: "Software", system: "Grade Submission App", requestedPriority: "HIGH", itPriority: "MEDIUM", status: "IN_PROGRESS", owner: "somsak.wattana@example.edu", createdDaysAgo: 6, updatedDaysAgo: 1 },
    { requester: "michael.brown@example.edu", summary: "Laptop fan runs at full speed when idle", description: "The fan stays loud even with no applications open.", category: "Hardware", system: "Corporate Laptop", requestedPriority: "LOW", itPriority: "LOW", status: "IN_PROGRESS", owner: "anong.kittisak@example.edu", createdDaysAgo: 12, updatedDaysAgo: 5 },

    // Waiting for Requester.
    { requester: "jennifer.anderson@example.edu", summary: "Campus Wi-Fi certificate warning on new phone", description: "My new phone warns that the Wi-Fi certificate is not trusted.", category: "Network", system: "Campus Wi-Fi", requestedPriority: "MEDIUM", itPriority: "LOW", status: "WAITING_FOR_REQUESTER", owner: "preecha.thongchai@example.edu", createdDaysAgo: 8, updatedDaysAgo: 3 },
    { requester: "michael.brown@example.edu", summary: "Printer asks for a PIN that was never issued", description: "The second-floor printer now requires a PIN before releasing jobs.", category: "Hardware", system: "Printer", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "WAITING_FOR_REQUESTER", owner: "nattapong.sri@example.edu", createdDaysAgo: 15, updatedDaysAgo: 7 },

    // Resolved.
    { requester: "jennifer.anderson@example.edu", summary: "LEB2 quiz timer resets on page refresh", description: "Refreshing a quiz page restarts the countdown from the beginning.", category: "Software", system: "LEB2 App", requestedPriority: "HIGH", itPriority: "HIGH", status: "RESOLVED", owner: "somsak.wattana@example.edu", createdDaysAgo: 20, updatedDaysAgo: 4 },
    { requester: "former.student@example.edu", summary: "Cannot reset password from off campus", description: "The password reset page only loads when connected to campus Wi-Fi.", category: "Account and Access", system: "Campus Wi-Fi", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "RESOLVED", owner: "preecha.thongchai@example.edu", createdDaysAgo: 25, updatedDaysAgo: 10 },

    // Closed — one owned by the inactive technician: BR-26 keeps the owner on
    // the record after the account is deactivated.
    { requester: "michael.brown@example.edu", summary: "Monitor flickers when docked", description: "The external monitor flickers every few seconds when the laptop is docked.", category: "Hardware", system: "Corporate Laptop", requestedPriority: "LOW", itPriority: "LOW", status: "CLOSED", owner: "retired.technician@example.edu", createdDaysAgo: 40, updatedDaysAgo: 30 },
    { requester: "jennifer.anderson@example.edu", summary: "Mailbox full warning despite archiving", description: "Outlook still reports a full mailbox after archiving last year's mail.", category: "Software", system: "Email", requestedPriority: "MEDIUM", itPriority: "LOW", status: "CLOSED", owner: "anong.kittisak@example.edu", createdDaysAgo: 35, updatedDaysAgo: 21 },

    // Reopened.
    { requester: "michael.brown@example.edu", summary: "VPN certificate expired again", description: "The VPN client reports an expired certificate a week after it was renewed.", category: "Network", system: "VPN", requestedPriority: "HIGH", itPriority: "HIGH", status: "REOPENED", owner: "nattapong.sri@example.edu", createdDaysAgo: 18, updatedDaysAgo: 0.8 },

    // Cancelled — one never claimed, one withdrawn after it was.
    { requester: "jennifer.anderson@example.edu", summary: "Request for a second monitor", description: "Asked for a second monitor; no longer needed after moving desks.", category: "Hardware", system: "Other / Not Listed", requestedPriority: "LOW", itPriority: "LOW", status: "CANCELLED", owner: null, createdDaysAgo: 14, updatedDaysAgo: 13 },
    { requester: "former.student@example.edu", summary: "Software licence for statistics package", description: "Requested a licence, then found the package in the computer lab instead.", category: "Software", system: "Other / Not Listed", requestedPriority: "MEDIUM", itPriority: "MEDIUM", status: "CANCELLED", owner: "preecha.thongchai@example.edu", createdDaysAgo: 22, updatedDaysAgo: 19 },
  ];

  const userIds = new Map(
    (await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );
  const categoryIds = new Map((await prisma.category.findMany()).map((c) => [c.name, c.id]));
  const systemIds = new Map((await prisma.relatedSystem.findMany()).map((r) => [r.name, r.id]));
  const idOf = (map: Map<string, number>, key: string) => {
    const id = map.get(key);
    if (id === undefined) throw new Error(`seed: "${key}" was not found`);
    return id;
  };

  const now = Date.now();
  for (const t of tickets) {
    const existing = await prisma.ticket.findFirst({
      where: { summary: t.summary, description: { contains: SEED_MARKER } },
      select: { id: true },
    });
    if (existing) continue;

    const createdAt = new Date(now - t.createdDaysAgo * DAY_MS);
    await prisma.$transaction(async (tx) => {
      // The real generator, so seeded numbers share the one sequence and a
      // later Ticket can never collide with them (BR-01).
      const ticketNumber = await nextTicketNumber(tx, createdAt.getFullYear());
      await tx.ticket.create({
        data: {
          ticketNumber,
          requesterId: idOf(userIds, t.requester),
          ownerId: t.owner === null ? null : idOf(userIds, t.owner),
          categoryId: idOf(categoryIds, t.category),
          relatedSystemId: idOf(systemIds, t.system),
          summary: t.summary,
          description: `${t.description} ${SEED_MARKER}`,
          requestedPriority: t.requestedPriority,
          itPriority: t.itPriority,
          currentStatus: t.status,
          createdAt,
          // Spread out so the queue's default order — Last Updated, newest
          // first — reads like a working desk rather than one burst of rows.
          updatedAt: new Date(now - t.updatedDaysAgo * DAY_MS),
        },
      });
    });
  }

  // Lab 3, Issue #32 — example Public Comments and Internal Notes
  // (specification.md §7), on a few of the Tickets above. Written as a working
  // conversation, and containing nothing sensitive. Comments come from the
  // Ticket's Requester or from staff; notes only ever from staff (BR-04).
  //
  // Idempotent in the same spirit as everything else here: an entry already
  // present on its Ticket is left alone.
  const threads: {
    ticket: string;
    kind: "comment" | "note";
    author: string;
    body: string;
    daysAgo: number;
  }[] = [
    { ticket: "VPN drops when switching to mobile hotspot", kind: "comment", author: "michael.brown@example.edu", body: "It happens every time I walk out of the office building.", daysAgo: 3.6 },
    { ticket: "VPN drops when switching to mobile hotspot", kind: "comment", author: "nattapong.sri@example.edu", body: "Thanks. Which version of the VPN client is installed on your laptop?", daysAgo: 3.4 },
    { ticket: "VPN drops when switching to mobile hotspot", kind: "note", author: "nattapong.sri@example.edu", body: "Probably the reconnect problem in the older client. Confirm the version before escalating to the network team.", daysAgo: 3.3 },
    { ticket: "Campus Wi-Fi certificate warning on new phone", kind: "comment", author: "preecha.thongchai@example.edu", body: "Please send a screenshot of the certificate details shown on the warning.", daysAgo: 3.1 },
    { ticket: "Campus Wi-Fi certificate warning on new phone", kind: "note", author: "preecha.thongchai@example.edu", body: "Waiting for the screenshot before contacting the network team.", daysAgo: 3 },
    { ticket: "LEB2 quiz timer resets on page refresh", kind: "comment", author: "somsak.wattana@example.edu", body: "A fix has been deployed. Please tell us if it happens again.", daysAgo: 4.2 },
    { ticket: "Grade submission rejects decimal scores", kind: "note", author: "anong.kittisak@example.edu", body: "Raised with the application vendor. Their reference number will be added here.", daysAgo: 1.1 },
  ];

  const seededTickets = new Map(
    (
      await prisma.ticket.findMany({
        where: { description: { contains: SEED_MARKER } },
        select: { id: true, summary: true },
      })
    ).map((t) => [t.summary, t.id]),
  );
  const seededUserIds = new Map(
    (await prisma.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );

  for (const entry of threads) {
    const ticketId = seededTickets.get(entry.ticket);
    if (ticketId === undefined) continue; // the Ticket was removed by hand; nothing to attach to
    const authorId = idOf(seededUserIds, entry.author);
    const data = { ticketId, authorId, body: entry.body, createdAt: new Date(now - entry.daysAgo * DAY_MS) };

    if (entry.kind === "comment") {
      const present = await prisma.publicComment.count({ where: { ticketId, body: entry.body } });
      if (present === 0) await prisma.publicComment.create({ data });
    } else {
      const present = await prisma.internalNote.count({ where: { ticketId, body: entry.body } });
      if (present === 0) await prisma.internalNote.create({ data });
    }
  }

  // -------------------------------------------------------------------------
  // Lab 4, Issue #46 — Actions Taken (lab-04/specification.md §7).
  //
  // The handout's §5.3 asks for Tickets with zero, one and several Actions, and
  // for data that makes every dashboard metric demonstrable both non-zero and
  // zero. So: one Ticket carries four Actions by two different staff members,
  // two carry exactly one, and every other seeded Ticket deliberately carries
  // none. All four statuses appear, one Action is assigned to somebody other
  // than its performer (BR-02, BR-04), and one requires follow-up with its note
  // (BR-07).
  //
  // Idempotent like the threads above: an Action already present is left as it
  // is, so a status someone changed while trying the screen is not reset.
  // -------------------------------------------------------------------------
  const actions: {
    ticket: string;
    performedBy: string;
    assignedTo: string;
    description: string;
    result: string | null;
    status: ActionStatus;
    followUpRequired: boolean;
    followUpNote: string | null;
    attachmentNotes: string | null;
    daysAgo: number;
  }[] = [
    // Several Actions on one Ticket, by two staff members.
    {
      ticket: "VPN drops when switching to mobile hotspot",
      performedBy: "nattapong.sri@example.edu", assignedTo: "nattapong.sri@example.edu",
      description: "Collected the VPN client logs from the laptop and read the reconnect section.",
      result: "Client is two versions behind; the reconnect handler is the known faulty one.",
      status: "COMPLETED", followUpRequired: false, followUpNote: null,
      attachmentNotes: "vpn-client-log.txt on this ticket.", daysAgo: 3.2,
    },
    {
      ticket: "VPN drops when switching to mobile hotspot",
      performedBy: "nattapong.sri@example.edu", assignedTo: "somsak.wattana@example.edu",
      description: "Asked the network team to confirm the hotspot subnet is allowed through the new gateway.",
      result: null,
      status: "IN_PROGRESS", followUpRequired: true,
      followUpNote: "Chase the network team if there is no answer by Friday.",
      attachmentNotes: null, daysAgo: 2.1,
    },
    {
      ticket: "VPN drops when switching to mobile hotspot",
      performedBy: "somsak.wattana@example.edu", assignedTo: "somsak.wattana@example.edu",
      description: "Scheduled the client upgrade with the user for the next maintenance window.",
      result: null,
      status: "PLANNED", followUpRequired: false, followUpNote: null,
      attachmentNotes: null, daysAgo: 1.2,
    },
    {
      ticket: "VPN drops when switching to mobile hotspot",
      performedBy: "somsak.wattana@example.edu", assignedTo: "somsak.wattana@example.edu",
      description: "Considered reimaging the laptop before the upgrade.",
      result: null,
      status: "CANCELLED", followUpRequired: false, followUpNote: null,
      attachmentNotes: null, daysAgo: 1.1,
    },
    // Exactly one Action.
    {
      ticket: "Grade submission rejects decimal scores",
      performedBy: "somsak.wattana@example.edu", assignedTo: "somsak.wattana@example.edu",
      description: "Reproduced the rejection with 7.5 and captured the request the browser sends.",
      result: "The form posts the value with a comma separator; raised with the vendor.",
      status: "COMPLETED", followUpRequired: true,
      followUpNote: "Re-test once the vendor confirms the fix is deployed.",
      attachmentNotes: "grade-submit-request.har on this ticket.", daysAgo: 1.0,
    },
    {
      ticket: "LEB2 quiz timer resets on page refresh",
      performedBy: "somsak.wattana@example.edu", assignedTo: "somsak.wattana@example.edu",
      description: "Deployed the timer fix to the LEB2 staging and production instances.",
      result: "Timer now survives a refresh; confirmed with two test accounts.",
      status: "COMPLETED", followUpRequired: false, followUpNote: null,
      attachmentNotes: null, daysAgo: 4.1,
    },
  ];

  for (const entry of actions) {
    const ticketId = seededTickets.get(entry.ticket);
    if (ticketId === undefined) continue; // the Ticket was removed by hand
    const present = await prisma.actionTaken.count({ where: { ticketId, description: entry.description } });
    if (present > 0) continue;

    await prisma.actionTaken.create({
      data: {
        ticketId,
        performedById: idOf(seededUserIds, entry.performedBy),
        assignedToId: idOf(seededUserIds, entry.assignedTo),
        actionAt: new Date(now - entry.daysAgo * DAY_MS),
        description: entry.description,
        result: entry.result,
        status: entry.status,
        followUpRequired: entry.followUpRequired,
        followUpNote: entry.followUpNote,
        attachmentNotes: entry.attachmentNotes,
      },
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
