import { Router, type Request, type Response } from "express";
import { staffOnly } from "./auth.js";
import { getPrisma } from "./prisma.js";
import { sendInternalError } from "./requesterContext.js";
import { CURRENT_STATUSES } from "./statusTransitions.js";
import { OPEN_STATUSES, byStatusMap, resolvedWindowStart } from "./dashboardMetrics.js";
import type { Prisma } from "@prisma/client";

// Lab 4, Issue #49 — the dashboards (lab-04/api-spec.md §7).
//
// Every number here is a query against the tables that hold the answer, run
// when the request arrives (BR-24). Nothing is cached and nothing is counted on
// the client, because a cached number and the list it links to disagree the
// moment somebody else writes — and a dashboard that disagrees with its own
// drill-down is worse than no dashboard.
//
// The body carries counts and short lists only (BR-23). The lists are the ten
// rows a person can act on, not a page of the queue by another name.

export const dashboardRoutes = Router();

/** BR-21's open set, as a Prisma filter. */
const OPEN: Prisma.TicketWhereInput = { currentStatus: { in: [...OPEN_STATUSES] } };

/**
 * api-spec.md §7 — a list row. Deliberately narrower than the Ticket object:
 * enough to read the row and open it, and no description, no requester, no
 * attachments. BR-23 is a rule about what leaves the server, not only about
 * how much.
 */
const LIST_ROW = {
  id: true,
  ticketNumber: true,
  summary: true,
  currentStatus: true,
  itPriority: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, role: true } },
} as const;

const LIST_SIZE = 10;

// GET /api/dashboard/staff — FR-12..FR-16, BR-21, BR-23, BR-24, BR-25, AC-15..AC-18.
// No query parameters: what makes this dashboard "mine" is the session, not
// something a caller can ask for on somebody else's behalf.
dashboardRoutes.get("/staff", staffOnly, async (req: Request, res: Response) => {
  const user = req.user!;

  try {
    const prisma = getPrisma();
    const since = resolvedWindowStart();

    // One round trip. These are nine independent counts over the same two
    // tables, so running them together is both faster and — more importantly —
    // closer to one instant, which is what stops the by-status strip from
    // disagreeing with the cards above it.
    const [
      unassigned,
      assignedToMe,
      myOpenActions,
      waitingForRequester,
      highItPriority,
      resolvedLast7Days,
      statusCounts,
      recentlyUpdated,
      needsAttention,
    ] = await Promise.all([
      prisma.ticket.count({ where: { ...OPEN, ownerId: null } }),
      prisma.ticket.count({ where: { ...OPEN, ownerId: user.id } }),
      // FR-13: the caller's unfinished work, counted on Actions rather than on
      // Tickets — one Ticket may carry several of somebody's Actions, and the
      // card says how much work is open, not how many Tickets it sits on.
      prisma.actionTaken.count({
        where: { assignedToId: user.id, status: { in: ["PLANNED", "IN_PROGRESS"] } },
      }),
      prisma.ticket.count({ where: { currentStatus: "WAITING_FOR_REQUESTER" } }),
      prisma.ticket.count({ where: { ...OPEN, itPriority: "HIGH" } }),
      // BR-25: `since` is 00:00 Bangkok, seven Bangkok days back. `resolvedAt`
      // is read beside the status, never alone, so a Ticket that was resolved
      // and then reopened does not count — it is somebody's problem again.
      prisma.ticket.count({ where: { currentStatus: "RESOLVED", resolvedAt: { gte: since } } }),
      prisma.ticket.groupBy({ by: ["currentStatus"], _count: { _all: true } }),
      prisma.ticket.findMany({
        where: OPEN,
        select: LIST_ROW,
        orderBy: { updatedAt: "desc" },
        take: LIST_SIZE,
      }),
      // Oldest update first: the High-priority Ticket nobody has touched for a
      // week is the one that needs attention, not the one being worked on now.
      prisma.ticket.findMany({
        where: { ...OPEN, itPriority: "HIGH" },
        select: LIST_ROW,
        orderBy: { updatedAt: "asc" },
        take: LIST_SIZE,
      }),
    ]);

    const body: Record<string, unknown> = {
      metrics: {
        unassigned,
        assignedToMe,
        myOpenActions,
        waitingForRequester,
        highItPriority,
        resolvedLast7Days,
        byStatus: byStatusMap(statusCounts, CURRENT_STATUSES),
      },
      recentlyUpdated,
      needsAttention,
    };

    // FR-16, AC-18: absent rather than null for IT Staff. A key that is always
    // there and sometimes empty invites a screen to render an empty "Accounts"
    // heading; a key that is not there cannot be rendered by mistake.
    if (user.role === "ADMINISTRATOR") {
      const [activeUsers, inactiveUsers] = await Promise.all([
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ where: { isActive: false } }),
      ]);
      body.administratorMetrics = { activeUsers, inactiveUsers };
    }

    res.json(body);
  } catch (error) {
    console.error("Error building the staff dashboard:", error);
    sendInternalError(res);
  }
});
