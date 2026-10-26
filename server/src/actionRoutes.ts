import { Router } from "express";
import type { Request, Response } from "express";
import type { ActionStatus, Prisma, User } from "@prisma/client";
import { signedIn, staffOnly } from "./auth.js";
import { getPrisma } from "./prisma.js";
import { readId, sendError, sendInternalError } from "./requesterContext.js";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  FOLLOW_UP_MAX,
  FOLLOW_UP_MIN,
  TEXT_MAX,
  canChangeActionStatus,
  completionNeedsResult,
  isFinalActionStatus,
  readActionAt,
  readDescription,
  resolveFollowUp,
} from "./actionRules.js";

// Lab 4, Issue #46 — Actions Taken (lab-04/api-spec.md §5).
//
// The work log under a Ticket. Three endpoints and no more: list, create,
// update. There is no delete, because an Action is retired by cancelling it
// and the Ticket's history stays complete (BR-13).
//
// Identity comes from the session on every one of them: `performedBy` is the
// caller at creation and is never read from the body (BR-03), and a Requester
// reaching somebody else's Ticket is answered 404 rather than 403 so the
// Ticket's existence is not disclosed (BR-15).

export const actionRoutes = Router();

const ACTOR_SUMMARY = { select: { id: true, name: true, role: true } } as const;

// The Action object of api-spec.md §4: selected field by field so a column
// added later cannot leak into a response by accident.
const ACTION_SHAPE = {
  id: true,
  ticketId: true,
  actionAt: true,
  description: true,
  result: true,
  status: true,
  followUpRequired: true,
  followUpNote: true,
  attachmentNotes: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  performedBy: ACTOR_SUMMARY,
  assignedTo: ACTOR_SUMMARY,
} as const;

function readText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0) return null;
  return text.length <= max ? text : undefined;
}

const MESSAGES = {
  ticketNotFound: "Ticket not found.",
  actionNotFound: "Action not found.",
  description: `An action description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`,
  result: `A result must be ${TEXT_MAX} characters or fewer.`,
  resultRequired: "A result is required to complete an action.",
  attachmentNotes: `Attachment notes must be ${TEXT_MAX} characters or fewer.`,
  followUpFlag: "Choose whether follow-up is required.",
  followUpNote: `A follow-up note is required, between ${FOLLOW_UP_MIN} and ${FOLLOW_UP_MAX} characters.`,
  actionAt: "The action date must be a real date, not in the future, and not before the ticket was created.",
  assignee: "Choose an active IT Staff or Administrator to carry out the action.",
  status: "Choose a valid action status.",
  createCancelled: "A new action cannot start as cancelled.",
  transition: "That action status change is not allowed.",
  final: "This action is completed or cancelled and can no longer be changed.",
  versionRequired: "Send the version you read so a concurrent change is not overwritten.",
  stale: "This action changed after you opened it. Reload to see the current version.",
} as const;

/** The Tickets this caller may read (BR-15, mirroring Lab 3 BR-16/BR-17). */
function readableTickets(user: User): Prisma.TicketWhereInput {
  return user.role === "REQUESTER" ? { requesterId: user.id } : {};
}

function readStatus(value: unknown): ActionStatus | null {
  return value === "PLANNED" || value === "IN_PROGRESS" || value === "COMPLETED" || value === "CANCELLED"
    ? value
    : null;
}

/** BR-04: an Action may only be assigned to an active IT Staff or Administrator. */
async function assigneeIsEligible(userId: number): Promise<boolean> {
  const count = await getPrisma().user.count({
    where: { id: userId, isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
  });
  return count === 1;
}

// ---------------------------------------------------------------------------
// GET /api/tickets/:id/actions — api-spec.md §5.
// Oldest action time first with the id as tie-break (BR-11), so the panel reads
// as a work log from the top down and two Actions recorded in the same second
// keep the order they were written.
// ---------------------------------------------------------------------------
actionRoutes.get("/tickets/:id/actions", signedIn, async (req: Request, res: Response) => {
  const user = req.user!;
  const ticketId = readId(req.params.id);
  if (ticketId === null) return sendError(res, 404, "TICKET_NOT_FOUND", MESSAGES.ticketNotFound);

  try {
    const ticket = await getPrisma().ticket.findFirst({
      where: { id: ticketId, ...readableTickets(user) },
      select: { id: true },
    });
    if (!ticket) return sendError(res, 404, "TICKET_NOT_FOUND", MESSAGES.ticketNotFound);

    const data = await getPrisma().actionTaken.findMany({
      where: { ticketId },
      select: ACTION_SHAPE,
      orderBy: [{ actionAt: "asc" }, { id: "asc" }],
    });
    res.json({ data });
  } catch (error) {
    console.error("Error listing actions taken:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// POST /api/tickets/:id/actions — api-spec.md §5. IT Staff and Administrator
// only (BR-14); a Requester is refused 403 because the existence of the Ticket
// is not the secret here — their own read of it is allowed.
// ---------------------------------------------------------------------------
actionRoutes.post("/tickets/:id/actions", staffOnly, async (req: Request, res: Response) => {
  const user = req.user!;
  const ticketId = readId(req.params.id);
  if (ticketId === null) return sendError(res, 404, "TICKET_NOT_FOUND", MESSAGES.ticketNotFound);

  try {
    const ticket = await getPrisma().ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, createdAt: true },
    });
    if (!ticket) return sendError(res, 404, "TICKET_NOT_FOUND", MESSAGES.ticketNotFound);

    const body = req.body ?? {};

    const description = readDescription(body.description);
    if (description === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.description, "description");

    const actionAt = readActionAt(body.actionAt, ticket.createdAt);
    if (actionAt === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.actionAt, "actionAt");

    const status = body.status === undefined ? "PLANNED" : readStatus(body.status);
    if (status === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.status, "status");
    // Cancelling something that was never planned is not a record anybody needs
    // (api-spec.md §5).
    if (status === "CANCELLED") return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.createCancelled, "status");

    const result = readText(body.result, TEXT_MAX);
    if (result === undefined && body.result !== undefined) {
      return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.result, "result");
    }
    // BR-06: a result is what "completed" means; without one the row would
    // claim finished work it cannot describe.
    if (completionNeedsResult(status, result)) {
      return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.resultRequired, "result");
    }

    const attachmentNotes = readText(body.attachmentNotes, TEXT_MAX);
    if (attachmentNotes === undefined && body.attachmentNotes !== undefined) {
      return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.attachmentNotes, "attachmentNotes");
    }

    if (typeof body.followUpRequired !== "boolean") {
      return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.followUpFlag, "followUpRequired");
    }
    const followUp = resolveFollowUp(body.followUpRequired, readText(body.followUpNote, FOLLOW_UP_MAX), null);
    if (!followUp.ok) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.followUpNote, "followUpNote");

    // BR-04: defaults to the caller, and must be an active staff account.
    const assignedToId = body.assignedToId === undefined ? user.id : readId(body.assignedToId);
    if (assignedToId === null || !(await assigneeIsEligible(assignedToId))) {
      return sendError(res, 400, "INVALID_ASSIGNEE", MESSAGES.assignee, "assignedToId");
    }

    const data = await getPrisma().actionTaken.create({
      data: {
        ticketId,
        actionAt,
        description,
        result: result ?? null,
        status,
        // BR-03: the performer is the session user. A performedById in the body
        // is not read, so it cannot be used to write the log in someone's name.
        performedById: user.id,
        assignedToId,
        followUpRequired: body.followUpRequired,
        followUpNote: followUp.note,
        attachmentNotes: attachmentNotes ?? null,
      },
      select: ACTION_SHAPE,
    });
    // BR-12: the Ticket's own status is untouched. Status moves only through
    // the status endpoint, under the matrix.
    res.status(201).json({ data });
  } catch (error) {
    console.error("Error creating an action taken:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/actions/:id — api-spec.md §5. Update, reassign, complete or
// cancel. Every call carries the version it read (BR-26, BR-28): an
// unconditional write is exactly the silent overwrite the rule exists to stop.
// ---------------------------------------------------------------------------
actionRoutes.patch("/actions/:id", staffOnly, async (req: Request, res: Response) => {
  const actionId = readId(req.params.id);
  if (actionId === null) return sendError(res, 404, "ACTION_NOT_FOUND", MESSAGES.actionNotFound);

  try {
    const existing = await getPrisma().actionTaken.findUnique({
      where: { id: actionId },
      select: {
        id: true,
        version: true,
        status: true,
        result: true,
        followUpRequired: true,
        followUpNote: true,
        ticket: { select: { createdAt: true } },
      },
    });
    if (!existing) return sendError(res, 404, "ACTION_NOT_FOUND", MESSAGES.actionNotFound);

    const body = req.body ?? {};

    if (!Number.isInteger(body.version)) {
      return sendError(res, 400, "VERSION_REQUIRED", MESSAGES.versionRequired, "version");
    }
    if (body.version !== existing.version) {
      return sendError(res, 409, "STALE_UPDATE", MESSAGES.stale, "version");
    }
    // BR-05: Completed and Cancelled are final. Checked before the field
    // validation below, so the answer is the real reason rather than whichever
    // field happened to be wrong as well.
    if (isFinalActionStatus(existing.status)) {
      return sendError(res, 409, "ACTION_FINAL", MESSAGES.final, "status");
    }

    // Scalars only: the write below is an `updateMany`, which carries the
    // version in its WHERE and therefore cannot take nested relation syntax.
    const changes: Prisma.ActionTakenUncheckedUpdateManyInput = {};

    if (body.description !== undefined) {
      const description = readDescription(body.description);
      if (description === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.description, "description");
      changes.description = description;
    }

    if (body.actionAt !== undefined) {
      const actionAt = readActionAt(body.actionAt, existing.ticket.createdAt);
      if (actionAt === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.actionAt, "actionAt");
      changes.actionAt = actionAt;
    }

    let result = existing.result;
    if (body.result !== undefined) {
      const next = readText(body.result, TEXT_MAX);
      if (next === undefined) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.result, "result");
      result = next;
      changes.result = next;
    }

    if (body.attachmentNotes !== undefined) {
      const notes = readText(body.attachmentNotes, TEXT_MAX);
      if (notes === undefined) {
        return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.attachmentNotes, "attachmentNotes");
      }
      changes.attachmentNotes = notes;
    }

    if (body.followUpRequired !== undefined || body.followUpNote !== undefined) {
      if (body.followUpRequired !== undefined && typeof body.followUpRequired !== "boolean") {
        return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.followUpFlag, "followUpRequired");
      }
      const required =
        body.followUpRequired === undefined ? existing.followUpRequired : (body.followUpRequired as boolean);
      const note = body.followUpNote === undefined ? undefined : readText(body.followUpNote, FOLLOW_UP_MAX);
      const followUp = resolveFollowUp(required, note, existing.followUpNote);
      if (!followUp.ok) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.followUpNote, "followUpNote");
      changes.followUpRequired = required;
      changes.followUpNote = followUp.note;
    }

    if (body.assignedToId !== undefined) {
      const assignedToId = readId(body.assignedToId);
      if (assignedToId === null || !(await assigneeIsEligible(assignedToId))) {
        return sendError(res, 400, "INVALID_ASSIGNEE", MESSAGES.assignee, "assignedToId");
      }
      changes.assignedToId = assignedToId;
    }

    if (body.status !== undefined) {
      const status = readStatus(body.status);
      if (status === null) return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.status, "status");
      if (!canChangeActionStatus(existing.status, status)) {
        return sendError(res, 409, "INVALID_ACTION_TRANSITION", MESSAGES.transition, "status");
      }
      if (completionNeedsResult(status, result)) {
        return sendError(res, 400, "VALIDATION_ERROR", MESSAGES.resultRequired, "result");
      }
      changes.status = status;
    }

    // The version is part of the WHERE, not only of the check above: two
    // requests that passed the check at the same moment still cannot both
    // write, because the second updates no row (BR-26).
    const updated = await getPrisma().actionTaken.updateMany({
      where: { id: actionId, version: existing.version },
      data: { ...changes, version: { increment: 1 } },
    });
    if (updated.count === 0) return sendError(res, 409, "STALE_UPDATE", MESSAGES.stale, "version");

    const data = await getPrisma().actionTaken.findUnique({ where: { id: actionId }, select: ACTION_SHAPE });
    res.json({ data });
  } catch (error) {
    console.error("Error updating an action taken:", error);
    sendInternalError(res);
  }
});
