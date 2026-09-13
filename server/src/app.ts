import express, { Request, Response } from "express";
import cors from "cors";
import { requesterOnly, signedIn, staffOnly } from "./auth.js";
import { authRoutes } from "./authRoutes.js";
import { getPrisma } from "./prisma.js";
import { CURRENT_STATUSES, STATUS_LABEL, canTransition } from "./statusTransitions.js";
import { nextTicketNumber } from "./ticketNumber.js";
import { readId, sendError, sendInternalError } from "./requesterContext.js";
import {
  ATTACHMENT_TYPE_HELP,
  allowedExtensionFor,
  attachmentUpload,
  deleteStoredFile,
  storeAttachmentFile,
  storedFileExists,
  storedFilePath,
  toDisplayFilename,
} from "./uploads.js";
import type { Attachment, CurrentStatus, Prisma, User } from "@prisma/client";
import type { NextFunction } from "express";
import { MulterError } from "multer";
// getPrisma() is your lazy database handle. Call it INSIDE a route when you
// need the DB (Issue 4). It is intentionally unused until then.
void getPrisma;

// The Express app is exported separately from app.listen() (see index.ts) so
// Supertest can import `app` without opening a port. Do not merge these files.
export const app = express();

// Lab 3, Issue #29 — the session cookie makes this a credentialed request, and
// a wildcard origin is incompatible with those: the browser refuses to send
// the cookie unless the API names the origin exactly (api-spec.md §1). The
// value is configurable so a different dev port does not require a code edit.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

// The four authentication endpoints (api-spec.md §4). They are mounted before
// everything else because they are the only routes exempt from the
// password-change gate — they are the way out of it (BR-02).
app.use("/api/auth", authRoutes);

// ---------------------------------------------------------------------------
// Issue 2 — API health check
// Make the test in tests/lab-01/health.test.ts pass.
// It must return HTTP 200 with JSON: { status: "ok", service: "TokTickIT API" }
// ---------------------------------------------------------------------------
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: "TokTickIT API" });
});

// ---------------------------------------------------------------------------
// Issue 4 — Category list
// Add:  GET /api/categories
//   -> read categories from PostgreSQL via getPrisma().category.findMany(...)
//   -> return each { id, name } in a predictable (id) order
//   -> on failure, respond 500 with a safe message (no internal details)
// ---------------------------------------------------------------------------
app.get("/api/categories", async (req, res) => {
  try {
    const prisma = getPrisma();
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true }, // isActive itself is never returned to the client (api-spec.md §3)
    });
    res.json({ data: categories });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
  }
});

// ---------------------------------------------------------------------------
// Issue #13 — Create Ticket
// GET /api/related-systems — api-spec.md §3. Public reference data, same
// contract and shape as /api/categories: active rows only, { id, name } only.
// ---------------------------------------------------------------------------
app.get("/api/related-systems", async (req, res) => {
  try {
    const prisma = getPrisma();
    const relatedSystems = await prisma.relatedSystem.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true },
    });
    res.json({ data: relatedSystems });
  } catch (error) {
    console.error("Error fetching related systems:", error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
  }
});

// GET /api/requesters is gone. It existed only to populate the Development
// Requester selector, and it handed a list of real people to any caller with
// no session at all. Lab 3 takes identity from the session instead, so the
// endpoint has no caller and no reason to exist (api-spec.md §6, AC-25,
// MIG-06).

// ---------------------------------------------------------------------------
// Lab 3, Issue #32 — the one Ticket object, and which Tickets a caller may
// read. Shared by every route below that returns or reads a Ticket.
// ---------------------------------------------------------------------------
// api-spec.md §5 — the actor summary, the only shape a person is named in.
// Email is absent on purpose: the Administrator user list is the one place
// addresses are returned.
const ACTOR_SUMMARY = { select: { id: true, name: true, role: true } } as const;

// Lab 3, Issue #32 — api-spec.md §5 defines one Ticket object "identical for
// every role", so there is one shape to test and no branch that could leak by
// mistake. Every endpoint that returns a Ticket includes its people this way.
const TICKET_PEOPLE = { requester: ACTOR_SUMMARY, owner: ACTOR_SUMMARY } as const;

/**
 * The Tickets this caller may read (api-spec.md §6): a Requester their own, IT
 * Staff and Administrators any (BR-16, BR-17). A where-clause rather than a
 * check after loading, so a Ticket the caller may not read is never loaded.
 */
function readableTickets(user: User): Prisma.TicketWhereInput {
  return user.role === "REQUESTER" ? { requesterId: user.id } : {};
}

/**
 * One Ticket in the api-spec.md §5 shape — people and attachments included —
 * or null. Every endpoint that answers with a single Ticket builds it here, so
 * the shape cannot differ between the detail read and the operations.
 */
async function loadTicket(where: Prisma.TicketWhereInput) {
  const ticket = await getPrisma().ticket.findFirst({
    where,
    include: {
      ...TICKET_PEOPLE,
      // BR-29: removed attachments come too. Their metadata stays part of the
      // ticket's history; only the file behind them becomes unavailable.
      // Oldest first, so the list reads in the order they were added.
      attachments: { orderBy: { uploadedAt: "asc" } },
    },
  });
  if (!ticket) return null;
  const { attachments, ...fields } = ticket;
  return { ...fields, attachments: attachments.map(toAttachmentResponse) };
}

// ---------------------------------------------------------------------------
// Issue #13 — Create Ticket
// POST /api/tickets — api-spec.md §4. Requester-scoped: ownership comes from
// the session (Lab 3 BR-03), never from the request body. Unlike the lenient
// GET query params of BR-18, request bodies are validated strictly and return
// 400 on the first failure (BR-19..BR-23).
// ---------------------------------------------------------------------------
const SUMMARY_MIN = 5;
const SUMMARY_MAX = 150;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 2000;
const REQUESTED_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

// Trims first, then measures — BR-19/BR-20 length limits apply to real content,
// so "   " is an empty Summary, not an 8-character one.
function readBoundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}

app.post("/api/tickets", requesterOnly, async (req: Request, res: Response) => {
  // Lab 3, Issue #30 — identity comes from the session and from nothing the
  // client can choose (BR-03). `requesterOnly` has already established that
  // this caller is authenticated, past the mandatory password change, active,
  // and holds the Requester role, so there is nothing left to re-check here.
  const requesterId = req.user!.id;

  const body = (req.body ?? {}) as Record<string, unknown>;

  // Reference ids get their own error codes (api-spec.md §4) so the client can
  // tell "pick a category" apart from "your text is too short".
  const categoryId = readId(body.categoryId);
  if (categoryId === null) {
    return sendError(res, 400, "INVALID_CATEGORY", "Please choose a category.", "categoryId");
  }
  const relatedSystemId = readId(body.relatedSystemId);
  if (relatedSystemId === null) {
    return sendError(res, 400, "INVALID_RELATED_SYSTEM", "Please choose a related system.", "relatedSystemId");
  }

  const summary = readBoundedText(body.summary, SUMMARY_MIN, SUMMARY_MAX);
  if (summary === null) {
    return sendError(res, 400, "VALIDATION_ERROR", `Summary must be between ${SUMMARY_MIN} and ${SUMMARY_MAX} characters.`, "summary");
  }
  const description = readBoundedText(body.description, DESCRIPTION_MIN, DESCRIPTION_MAX);
  if (description === null) {
    return sendError(res, 400, "VALIDATION_ERROR", `Description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`, "description");
  }

  const requestedPriority = REQUESTED_PRIORITIES.find((p) => p === body.requestedPriority);
  if (requestedPriority === undefined) {
    return sendError(res, 400, "VALIDATION_ERROR", "Please choose a requested priority.", "requestedPriority");
  }

  try {
    const prisma = getPrisma();

    // An inactive Category/RelatedSystem is rejected exactly like an unknown
    // one (BR-21) — the client only ever offers active rows anyway.
    const [category, relatedSystem] = await Promise.all([
      prisma.category.findFirst({ where: { id: categoryId, isActive: true }, select: { id: true } }),
      prisma.relatedSystem.findFirst({ where: { id: relatedSystemId, isActive: true }, select: { id: true } }),
    ]);
    if (!category) {
      return sendError(res, 400, "INVALID_CATEGORY", "Please choose a category.", "categoryId");
    }
    if (!relatedSystem) {
      return sendError(res, 400, "INVALID_RELATED_SYSTEM", "Please choose a related system.", "relatedSystemId");
    }

    // BR-01: number and row commit together. currentStatus and the timestamps
    // are left to the schema defaults, and IT Priority starts as the Requested
    // Priority (Lab 3 BR-29), so nothing the client sent for any of them can
    // take effect (BR-02, BR-03).
    const data = {
      requesterId,
      categoryId,
      relatedSystemId,
      summary,
      description,
      requestedPriority,
      itPriority: requestedPriority,
    };
    const ticket = await createTicketWithNumber(prisma, data);

    res.status(201).json({ data: { ...ticket, attachments: [] } });
  } catch (error) {
    console.error("Error creating ticket:", error);
    sendInternalError(res);
  }
});

type NewTicketData = {
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: (typeof REQUESTED_PRIORITIES)[number];
  itPriority: (typeof REQUESTED_PRIORITIES)[number];
};

// BR-01: the ticketNumber unique constraint is a safety net behind the atomic
// counter, so one retry is enough — a second collision would mean the counter
// itself is broken and should surface as a 500 rather than loop.
async function createTicketWithNumber(prisma: ReturnType<typeof getPrisma>, data: NewTicketData) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const ticketNumber = await nextTicketNumber(tx, new Date().getFullYear());
        return tx.ticket.create({ data: { ...data, ticketNumber }, include: TICKET_PEOPLE });
      });
    } catch (error) {
      const isDuplicateNumber =
        typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
      if (!isDuplicateNumber || attempt === 1) throw error;
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Issue #14 — My Tickets
// GET /api/tickets — api-spec.md §4. Ownership is a where-clause, not a
// post-filter: a Ticket belonging to someone else is never read in the first
// place (BR-11). Unlike the write endpoints, every query parameter here is
// lenient — an unknown key, an invalid enum, an unparseable number or an
// unrecognised sort field is ignored and the documented default substituted,
// and this endpoint never answers 400 for a query-parameter problem (BR-18).
// ---------------------------------------------------------------------------
const SORT_FIELDS = ["ticketNumber", "createdAt", "updatedAt"] as const;

// `contains` becomes a LIKE pattern, where % and _ are wildcards and \ is the
// escape character. Without this a Requester searching for "50%" matches every
// ticket, and "month_end" matches any character where the underscore is —
// neither of which is the partial match BR-13 describes. The value itself is
// still a bound parameter, so this is about correctness, not injection.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
const PAGE_SIZES = [10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;

app.get("/api/tickets", requesterOnly, async (req: Request, res: Response) => {
  // Lab 3, Issue #30 — identity comes from the session and from nothing the
  // client can choose (BR-03). `requesterOnly` has already established that
  // this caller is authenticated, past the mandatory password change, active,
  // and holds the Requester role, so there is nothing left to re-check here.
  const requesterId = req.user!.id;

  const query = req.query as Record<string, unknown>;

  const search = typeof query.search === "string" && query.search.trim() !== "" ? query.search.trim() : null;
  const categoryId = readId(query.category);
  const requestedPriority = REQUESTED_PRIORITIES.find((p) => p === query.requestedPriority);
  const itPriority = REQUESTED_PRIORITIES.find((p) => p === query.itPriority);
  const currentStatus = query.status === "NEW" ? ("NEW" as const) : undefined;

  const sortBy = SORT_FIELDS.find((f) => f === query.sortBy) ?? "createdAt";
  const sortDir = query.sortDir === "asc" ? "asc" : "desc";
  const page = readId(query.page) ?? 1;
  const pageSizeCandidate = Number(query.pageSize);
  const pageSize = PAGE_SIZES.includes(pageSizeCandidate) ? pageSizeCandidate : DEFAULT_PAGE_SIZE;

  try {
    const prisma = getPrisma();

    const where = {
      requesterId,
      ...(categoryId !== null ? { categoryId } : {}),
      ...(requestedPriority ? { requestedPriority } : {}),
      ...(itPriority ? { itPriority } : {}),
      ...(currentStatus ? { currentStatus } : {}),
      // BR-13: Ticket Number or Summary, partial and case-insensitive.
      // Description is deliberately not searched (specification.md §11).
      ...(search
        ? {
            OR: [
              { ticketNumber: { contains: escapeLikePattern(search), mode: "insensitive" as const } },
              { summary: { contains: escapeLikePattern(search), mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const totalItems = await prisma.ticket.count({ where });
    const totalPages = Math.ceil(totalItems / pageSize);
    const pagination = { page, pageSize, totalItems, totalPages };

    // BR-17: a page past the end is an empty result with accurate metadata,
    // not an error. Answering it here also keeps an absurd page number from
    // reaching the database as an out-of-range OFFSET.
    if (page > totalPages) {
      return res.json({ data: [], pagination });
    }

    const data = await prisma.ticket.findMany({
      where,
      // BR-15: ties on the chosen field resolve by ticketNumber desc, so the
      // order is total and a row cannot drift between pages.
      orderBy:
        sortBy === "ticketNumber"
          ? [{ ticketNumber: sortDir }]
          : [{ [sortBy]: sortDir }, { ticketNumber: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: TICKET_PEOPLE,
    });

    res.json({ data, pagination });
  } catch (error) {
    console.error("Error listing tickets:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// Issue #15 — Requester Ticket Detail
// GET /api/tickets/:id — api-spec.md §4. Ownership is part of the lookup, so a
// Ticket belonging to someone else is never read and cannot be half-returned.
// It answers exactly as a nonexistent id does (BR-12): a Requester who does not
// own a ticket learns nothing about whether it exists. Reachable by direct URL
// as well as from the list, and the check runs either way (BR-38).
// ---------------------------------------------------------------------------
app.get("/api/tickets/:id", signedIn, async (req: Request, res: Response) => {
  // Lab 3, Issue #32 — role-aware, as api-spec.md §6 specifies: a Requester
  // reads only their own Ticket (404 otherwise, BR-16), and IT Staff and
  // Administrators read any (BR-17). One endpoint rather than a staff copy, so
  // the ownership rule lives in exactly one place. Identity still comes from
  // the session and from nothing else (BR-03).
  const user = req.user!;

  const ticketId = readId(req.params.id);
  if (ticketId === null) {
    return sendError(res, 404, "TICKET_NOT_FOUND", "Ticket not found.");
  }

  try {
    const ticket = await loadTicket({ id: ticketId, ...readableTickets(user) });
    if (!ticket) {
      return sendError(res, 404, "TICKET_NOT_FOUND", "Ticket not found.");
    }
    res.json({ data: ticket });
  } catch (error) {
    console.error("Error fetching ticket:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// Issue #13 — Attachment upload
// POST /api/tickets/:id/attachments — api-spec.md §5. Ownership is re-checked
// here exactly as it is on the Ticket itself (BR-11): an attachment inherits
// its parent Ticket's owner, so a Requester who cannot see the Ticket cannot
// add to it either. Download and soft removal arrive with Issue #15.
// ---------------------------------------------------------------------------
const MAX_ACTIVE_ATTACHMENTS = 5;

// storedFilename is internal and must never reach a client (BR-32, api-spec.md §5).
function toAttachmentResponse(attachment: Attachment) {
  return {
    id: attachment.id,
    ticketId: attachment.ticketId,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt,
    removedAt: attachment.removedAt,
    removedReason: attachment.removedReason,
  };
}

// multer reports an over-limit file as an error while reading the request, so
// it is translated here rather than in the route body (BR-27 -> 413).
function receiveAttachment(req: Request, res: Response, next: NextFunction) {
  attachmentUpload.single("file")(req, res, (error: unknown) => {
    if (error instanceof MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return sendError(res, 413, "FILE_TOO_LARGE", "Each attachment must be 5 MB or smaller.", "file");
      }
      return sendError(res, 400, "VALIDATION_ERROR", "The uploaded file could not be read.", "file");
    }
    if (error) {
      console.error("Error receiving attachment:", error);
      return sendInternalError(res);
    }
    next();
  });
}

app.post("/api/tickets/:id/attachments", requesterOnly, receiveAttachment, async (req: Request, res: Response) => {
  // Lab 3, Issue #30 — identity comes from the session and from nothing the
  // client can choose (BR-03). `requesterOnly` has already established that
  // this caller is authenticated, past the mandatory password change, active,
  // and holds the Requester role, so there is nothing left to re-check here.
  const requesterId = req.user!.id;

  const ticketId = readId(req.params.id);
  if (ticketId === null) {
    return sendError(res, 404, "TICKET_NOT_FOUND", "Ticket not found.");
  }

  const file = req.file;
  if (!file) {
    return sendError(res, 400, "VALIDATION_ERROR", "Please choose a file to attach.", "file");
  }

  try {
    const prisma = getPrisma();

    // BR-12: a Ticket owned by someone else is reported as missing, so ticket
    // existence never leaks across Requesters.
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, requesterId },
      select: { id: true },
    });
    if (!ticket) {
      return sendError(res, 404, "TICKET_NOT_FOUND", "Ticket not found.");
    }

    const originalFilename = toDisplayFilename(file.originalname);
    const extension = allowedExtensionFor(file.mimetype, originalFilename);
    if (extension === null) {
      return sendError(res, 415, "UNSUPPORTED_FILE_TYPE", `That file type is not allowed. ${ATTACHMENT_TYPE_HELP}`, "file");
    }

    // BR-28 counts active attachments only — a soft-removed one has given its
    // slot back even though its row and metadata remain (BR-29). Counting and
    // inserting happen inside one transaction that first locks the parent
    // Ticket row, because counting outside a transaction is the same
    // read-then-write race BR-01 rules out for the Ticket Number: two uploads
    // arriving together would both see four attachments and both insert a
    // fifth (tests.md API-ATT-14).
    let storedFilename: string | null = null;
    try {
      const attachment = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;

        const activeCount = await tx.attachment.count({ where: { ticketId, removedAt: null } });
        if (activeCount >= MAX_ACTIVE_ATTACHMENTS) throw new AttachmentLimitReached();

        storedFilename = storeAttachmentFile(file.buffer, extension);
        return tx.attachment.create({
          data: {
            ticketId,
            originalFilename,
            storedFilename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
          },
        });
      });

      res.status(201).json({ data: toAttachmentResponse(attachment) });
    } catch (error) {
      // BR-33: a failed upload stores nothing at all — not a row, and not the
      // file that would otherwise be left orphaned on disk.
      if (storedFilename !== null) deleteStoredFile(storedFilename);
      if (error instanceof AttachmentLimitReached) {
        return sendError(
          res,
          409,
          "ATTACHMENT_LIMIT_REACHED",
          `A ticket can have at most ${MAX_ACTIVE_ATTACHMENTS} attachments. Remove one before adding another.`,
          "file",
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("Error uploading attachment:", error);
    sendInternalError(res);
  }
});

// Signals BR-28 from inside the transaction, so the limit check can roll the
// transaction back rather than responding from within it.
class AttachmentLimitReached extends Error {}

// ---------------------------------------------------------------------------
// Issue #15 — Attachment metadata, download and soft removal (api-spec.md §5).
//
// All three share one lookup: an Attachment is reached through the Ticket that
// owns it, so "not yours" and "does not exist" are the same 404 and neither
// leaks the other (BR-11, BR-12). None of them ever returns storedFilename.
// ---------------------------------------------------------------------------
const REMOVAL_REASON_MIN = 5;
const REMOVAL_REASON_MAX = 200;

/** The owned Attachment, or null — the caller answers 404 either way (BR-12). */
async function findOwnedAttachment(attachmentId: number, requesterId: number) {
  return getPrisma().attachment.findFirst({
    where: { id: attachmentId, ticket: { requesterId } },
  });
}

/**
 * An Attachment on a Ticket this caller may read, or null (api-spec.md §6,
 * FR-21, AC-26). Reading and downloading widen with the Ticket in Lab 3;
 * uploading and removing stay the Requester's and keep `findOwnedAttachment`.
 */
async function findReadableAttachment(attachmentId: number, user: User) {
  return getPrisma().attachment.findFirst({
    where: { id: attachmentId, ticket: readableTickets(user) },
  });
}

app.get("/api/attachments/:id", signedIn, async (req: Request, res: Response) => {
  try {
    const attachmentId = readId(req.params.id);
    const attachment = attachmentId === null ? null : await findReadableAttachment(attachmentId, req.user!);
    if (!attachment) {
      return sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    }

    // Returned even when removed: BR-29 keeps the metadata readable so the
    // Requester can still see what was removed, when, and why.
    res.json({ data: toAttachmentResponse(attachment) });
  } catch (error) {
    console.error("Error fetching attachment:", error);
    sendInternalError(res);
  }
});

app.get("/api/attachments/:id/download", signedIn, async (req: Request, res: Response) => {
  try {
    const attachmentId = readId(req.params.id);
    const attachment = attachmentId === null ? null : await findReadableAttachment(attachmentId, req.user!);

    // BR-30: a removed attachment is never downloadable by anyone, its owner
    // included. This is the one case where an owned resource still answers 404,
    // and it is deliberate — the file is gone as far as the API is concerned.
    if (!attachment || attachment.removedAt !== null) {
      return sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    }

    if (!storedFileExists(attachment.storedFilename)) {
      // The row says the file should be here. If it is not, that is a server
      // fault, not a missing resource — do not disguise it as a 404.
      console.error("Attachment record has no file on disk:", attachment.id);
      return sendInternalError(res);
    }

    // The stored MIME type rather than one guessed from the randomised name on
    // disk, and the display filename rather than that name (BR-32). The
    // filename* form carries non-ASCII names that the quoted form cannot.
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${attachment.originalFilename.replace(/"/g, "")}"; ` +
        `filename*=UTF-8''${encodeURIComponent(attachment.originalFilename)}`,
    );
    res.sendFile(storedFilePath(attachment.storedFilename));
  } catch (error) {
    console.error("Error downloading attachment:", error);
    sendInternalError(res);
  }
});

app.delete("/api/attachments/:id", requesterOnly, async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.id;

    const attachmentId = readId(req.params.id);
    const attachment = attachmentId === null ? null : await findOwnedAttachment(attachmentId, requesterId);
    if (!attachment) {
      return sendError(res, 404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    }

    // BR-31: a removal has to say why, in 5-200 characters, measured after
    // trimming so spaces cannot stand in for a reason.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.removalReason === "string" ? body.removalReason.trim() : "";
    if (reason.length < REMOVAL_REASON_MIN || reason.length > REMOVAL_REASON_MAX) {
      return sendError(
        res,
        400,
        "VALIDATION_ERROR",
        `A removal reason of ${REMOVAL_REASON_MIN} to ${REMOVAL_REASON_MAX} characters is required.`,
        "removalReason",
      );
    }

    // Removal is not repeatable: a second attempt must not overwrite the first
    // reason or move the removal date.
    if (attachment.removedAt !== null) {
      return sendError(res, 409, "ALREADY_REMOVED", "This attachment has already been removed.");
    }

    // BR-29: a soft update. The verb is DELETE, but the row stays and keeps its
    // metadata; only the file becomes unreachable.
    const removed = await getPrisma().attachment.update({
      where: { id: attachment.id },
      data: { removedAt: new Date(), removedReason: reason },
    });

    res.json({ data: toAttachmentResponse(removed) });
  } catch (error) {
    console.error("Error removing attachment:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// Lab 3, Issue #32 — Ticket operations, the Requester resolution signal, and
// the two threads (api-spec.md §7 and §8).
//
// Every refusal below follows the gate order of api-spec.md §3: a caller in the
// wrong role gets 403, and a caller in the right role reaching a Ticket they
// may not see gets 404. The two places where the role decides between those —
// Internal Notes and the resolution signal — say why where they do it.
// ---------------------------------------------------------------------------

function ticketNotFound(res: Response): void {
  sendError(res, 404, "TICKET_NOT_FOUND", "Ticket not found.");
}

async function ticketExists(where: Prisma.TicketWhereInput): Promise<boolean> {
  return (await getPrisma().ticket.count({ where })) > 0;
}

function writeBody(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

// PATCH /api/tickets/:id/owner — FR-15, AC-10, AC-11, BR-25..BR-28.
// A claim is this same call with the caller's own id: one state change, one
// set of rules.
app.patch("/api/tickets/:id/owner", staffOnly, async (req: Request, res: Response) => {
  const ticketId = readId(req.params.id);
  if (ticketId === null) return ticketNotFound(res);

  // A number that could name a user, or `null` to release the Ticket (BR-28).
  // A string such as "7" is refused rather than coerced: request bodies are
  // validated strictly (BR-42).
  const raw = writeBody(req).ownerId;
  const ownerId = typeof raw === "number" ? readId(raw) : null;
  if (raw !== null && ownerId === null) {
    return sendError(res, 400, "VALIDATION_ERROR", "Choose an owner, or Unassigned.", "ownerId");
  }

  try {
    const prisma = getPrisma();
    if (!(await ticketExists({ id: ticketId }))) return ticketNotFound(res);

    if (ownerId !== null) {
      // BR-25 is checked on the incoming owner only. Someone deactivated after
      // they were assigned stays on the record (BR-26) — nothing here looks at
      // the value already stored. One message for an unknown, inactive or
      // Requester account alike: the caller has no need to tell them apart.
      const assignable = await prisma.user.count({
        where: { id: ownerId, isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
      });
      if (assignable === 0) {
        return sendError(res, 400, "INVALID_OWNER", "That person cannot be made the owner of a ticket.", "ownerId");
      }
    }

    // BR-28: any IT Staff or Administrator may do this, not only the owner.
    await prisma.ticket.update({ where: { id: ticketId }, data: { ownerId } });
    res.json({ data: await loadTicket({ id: ticketId }) });
  } catch (error) {
    console.error("Error changing the ticket owner:", error);
    sendInternalError(res);
  }
});

// PATCH /api/tickets/:id/it-priority — FR-17, AC-12, BR-29.
app.patch("/api/tickets/:id/it-priority", staffOnly, async (req: Request, res: Response) => {
  const ticketId = readId(req.params.id);
  if (ticketId === null) return ticketNotFound(res);

  // `null` is refused along with anything else: once set, a Ticket always has
  // an IT Priority (api-spec.md §7).
  const itPriority = REQUESTED_PRIORITIES.find((p) => p === writeBody(req).itPriority);
  if (!itPriority) {
    return sendError(res, 400, "VALIDATION_ERROR", "Choose an IT Priority of Low, Medium or High.", "itPriority");
  }

  try {
    if (!(await ticketExists({ id: ticketId }))) return ticketNotFound(res);
    // Only IT Priority is written. Requested Priority is what the Requester
    // said, and it never changes after creation (BR-29, AC-12).
    await getPrisma().ticket.update({ where: { id: ticketId }, data: { itPriority } });
    res.json({ data: await loadTicket({ id: ticketId }) });
  } catch (error) {
    console.error("Error changing the IT priority:", error);
    sendInternalError(res);
  }
});

// PATCH /api/tickets/:id/status — FR-18, AC-13, BR-31, BR-32.
app.patch("/api/tickets/:id/status", staffOnly, async (req: Request, res: Response) => {
  const ticketId = readId(req.params.id);
  if (ticketId === null) return ticketNotFound(res);

  const next = CURRENT_STATUSES.find((s) => s === writeBody(req).currentStatus);
  if (!next) {
    return sendError(res, 400, "VALIDATION_ERROR", "Choose a status.", "currentStatus");
  }

  // The message names both ends of the attempted move. That is the Ticket's own
  // state, not another user's data (api-spec.md §7).
  const conflict = (from: CurrentStatus) =>
    sendError(
      res,
      409,
      "INVALID_STATUS_TRANSITION",
      `A ticket cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[next]}.`,
    );

  try {
    const prisma = getPrisma();
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { currentStatus: true } });
    if (!ticket) return ticketNotFound(res);

    // BR-31 — including its lack of self-transitions, so setting the status a
    // Ticket already has is a conflict rather than a silent success. The
    // confirmation BR-33 asks for is the client's: a flag a client could set
    // unconditionally would not be a safeguard.
    if (!canTransition(ticket.currentStatus, next)) return conflict(ticket.currentStatus);

    // Conditional on the status just read. Of two people moving the same Ticket
    // at the same moment, the second gets a 409 describing the state the first
    // left behind, instead of overwriting it with a move the matrix might not
    // allow from there.
    const moved = await prisma.ticket.updateMany({
      where: { id: ticketId, currentStatus: ticket.currentStatus },
      data: { currentStatus: next },
    });
    if (moved.count === 0) {
      const now = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { currentStatus: true } });
      return conflict(now?.currentStatus ?? ticket.currentStatus);
    }

    res.json({ data: await loadTicket({ id: ticketId }) });
  } catch (error) {
    console.error("Error changing the ticket status:", error);
    sendInternalError(res);
  }
});

// BR-34: the signal stops applying once staff have resolved, closed or
// cancelled the Ticket.
const PAST_RESOLUTION: CurrentStatus[] = ["RESOLVED", "CLOSED", "CANCELLED"];

// POST /api/tickets/:id/appears-resolved — FR-12, AC-16, BR-05, BR-34.
app.post("/api/tickets/:id/appears-resolved", signedIn, async (req: Request, res: Response) => {
  const user = req.user!;

  // Two refusals that differ on purpose (api-spec.md §7). IT Staff and
  // Administrators may see the Ticket, so a plain 403 tells them nothing new.
  // Another Requester must not learn the Ticket exists, so they get the 404 the
  // ownership check below gives any Ticket that is not theirs.
  if (user.role !== "REQUESTER") {
    return sendError(res, 403, "FORBIDDEN", "You do not have access to this operation.");
  }

  const ticketId = readId(req.params.id);
  if (ticketId === null) return ticketNotFound(res);

  const notApplicable = () =>
    sendError(res, 409, "RESOLUTION_NOT_APPLICABLE", "This ticket has already been resolved, closed or cancelled.");
  const alreadyIndicated = () =>
    sendError(res, 409, "ALREADY_INDICATED", "You have already reported that this problem looks resolved.");

  try {
    const prisma = getPrisma();
    const own = { id: ticketId, requesterId: user.id };
    const ticket = await prisma.ticket.findFirst({
      where: own,
      select: { currentStatus: true, requesterResolvedAt: true },
    });
    if (!ticket) return ticketNotFound(res);
    if (PAST_RESOLUTION.includes(ticket.currentStatus)) return notApplicable();
    if (ticket.requesterResolvedAt !== null) return alreadyIndicated();

    // BR-05: the status is not touched — formally resolving stays with staff.
    // Conditional, so a double submission cannot rewrite when the Requester
    // first said it: the signal is a fact with a time, not a toggle.
    const marked = await prisma.ticket.updateMany({
      where: { ...own, requesterResolvedAt: null, currentStatus: { notIn: PAST_RESOLUTION } },
      data: { requesterResolvedAt: new Date() },
    });
    if (marked.count === 0) {
      const now = await prisma.ticket.findFirst({ where: own, select: { requesterResolvedAt: true } });
      return now?.requesterResolvedAt ? alreadyIndicated() : notApplicable();
    }

    res.json({ data: await loadTicket(own) });
  } catch (error) {
    console.error("Error recording the resolution signal:", error);
    sendInternalError(res);
  }
});

// api-spec.md §5 — the comment and note object, identical for both (BR-22).
// No `updatedAt`: both are append-only (BR-21).
const THREAD_ENTRY = { id: true, ticketId: true, author: ACTOR_SUMMARY, body: true, createdAt: true } as const;
const THREAD_BODY_MIN = 1;
const THREAD_BODY_MAX = 2000;

/** BR-23: required, trimmed, 1-2000 characters, so whitespace alone is no body. */
function readThreadBody(req: Request): string | null {
  return readBoundedText(writeBody(req).body, THREAD_BODY_MIN, THREAD_BODY_MAX);
}

// GET /api/tickets/:id/comments — BR-04, AC-14.
app.get("/api/tickets/:id/comments", signedIn, async (req: Request, res: Response) => {
  const ticketId = readId(req.params.id);
  if (ticketId === null) return ticketNotFound(res);

  try {
    // BR-16: a Requester's view of somebody else's Ticket is a Ticket that
    // does not exist, whichever part of it they ask for.
    if (!(await ticketExists({ id: ticketId, ...readableTickets(req.user!) }))) return ticketNotFound(res);

    const data = await getPrisma().publicComment.findMany({
      where: { ticketId },
      select: THREAD_ENTRY,
      // Oldest first, so a conversation reads downwards; the id settles two
      // comments written in the same millisecond.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    res.json({ data });
  } catch (error) {
    console.error("Error listing comments:", error);
    sendInternalError(res);
  }
});

// POST /api/tickets/:id/comments — FR-19, AC-14, BR-22..BR-24.
app.post("/api/tickets/:id/comments", signedIn, async (req: Request, res: Response) => {
  const user = req.user!;
  const ticketId = readId(req.params.id);
  if (ticketId === null) return ticketNotFound(res);

  try {
    // Access before validation, so a Ticket the caller may not see cannot be
    // probed by the difference between a 404 and a 400.
    if (!(await ticketExists({ id: ticketId, ...readableTickets(user) }))) return ticketNotFound(res);

    const body = readThreadBody(req);
    if (body === null) {
      return sendError(res, 400, "VALIDATION_ERROR", "A comment must be between 1 and 2000 characters.", "body");
    }

    const prisma = getPrisma();
    const [data] = await prisma.$transaction([
      // BR-22: the author and the time come from the session and the server
      // clock. Anything else the client sent is simply not read.
      prisma.publicComment.create({ data: { ticketId, authorId: user.id, body }, select: THREAD_ENTRY }),
      // A comment is activity everyone on the Ticket can see, so it moves Last
      // Updated and the Ticket rises in the queue's default order.
      prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } }),
    ]);
    res.status(201).json({ data });
  } catch (error) {
    console.error("Error posting a comment:", error);
    sendInternalError(res);
  }
});

/**
 * BR-20, AC-04 — to a Requester, Internal Notes do not exist.
 *
 * On their own Ticket, somebody else's, or one that never existed, the answer
 * is the 404 a missing Ticket gets: not 403, which would confirm the Ticket, and
 * not an empty list, which would confirm the endpoint. It is decided before the
 * request is read any further, so not even a validation message can tell a
 * Requester that there was something to validate.
 */
function hidesNotesFrom(user: User): boolean {
  return user.role === "REQUESTER";
}

// GET /api/tickets/:id/notes — BR-04, BR-20, AC-04, AC-15.
app.get("/api/tickets/:id/notes", signedIn, async (req: Request, res: Response) => {
  const ticketId = readId(req.params.id);
  if (hidesNotesFrom(req.user!) || ticketId === null) return ticketNotFound(res);

  try {
    if (!(await ticketExists({ id: ticketId }))) return ticketNotFound(res);

    const data = await getPrisma().internalNote.findMany({
      where: { ticketId },
      select: THREAD_ENTRY,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    res.json({ data });
  } catch (error) {
    console.error("Error listing internal notes:", error);
    sendInternalError(res);
  }
});

// POST /api/tickets/:id/notes — FR-20, AC-15, BR-20, BR-22, BR-23.
app.post("/api/tickets/:id/notes", signedIn, async (req: Request, res: Response) => {
  const user = req.user!;
  const ticketId = readId(req.params.id);
  if (hidesNotesFrom(user) || ticketId === null) return ticketNotFound(res);

  try {
    if (!(await ticketExists({ id: ticketId }))) return ticketNotFound(res);

    const body = readThreadBody(req);
    if (body === null) {
      return sendError(res, 400, "VALIDATION_ERROR", "A note must be between 1 and 2000 characters.", "body");
    }

    // Deliberately does *not* move Last Updated, unlike a comment. The
    // Requester sees that timestamp, and a Ticket that changed with nothing
    // visible having changed would tell them something hidden had happened
    // (BR-20).
    const data = await getPrisma().internalNote.create({
      data: { ticketId, authorId: user.id, body },
      select: THREAD_ENTRY,
    });
    res.status(201).json({ data });
  } catch (error) {
    console.error("Error posting an internal note:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// Lab 3, Issue #31 — IT Staff Ticket Queue
// GET /api/staff/tickets — api-spec.md §7, FR-13, AC-09, BR-40.
//
// The staff counterpart of My Tickets: every Requester's Tickets, with the same
// lenient query contract (AC-28). `GET /api/tickets` stays the Requester's own
// list rather than changing meaning with the caller, so the ownership rule for
// Requesters never shares a code path with a list that deliberately has none.
// ---------------------------------------------------------------------------
const QUEUE_SORT_FIELDS = ["ticketNumber", "createdAt", "updatedAt", "itPriority"] as const;
// BR-40: larger than the Requester list's 10, because a shared queue is
// scanned rather than browsed.
const QUEUE_DEFAULT_PAGE_SIZE = 25;

app.get("/api/staff/tickets", staffOnly, async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;

  const search = typeof query.search === "string" && query.search.trim() !== "" ? query.search.trim() : null;
  const categoryId = readId(query.category);
  const requestedPriority = REQUESTED_PRIORITIES.find((p) => p === query.requestedPriority);
  const itPriority = REQUESTED_PRIORITIES.find((p) => p === query.itPriority);
  const currentStatus = CURRENT_STATUSES.find((s) => s === query.status);

  // `unassigned` or a User id. Anything else — `me` included — is ignored and
  // the filter simply does not apply (api-spec.md §7).
  const ownerId = query.owner === "unassigned" ? null : readId(query.owner);
  const ownerFilter =
    query.owner === "unassigned" ? { ownerId: null } : ownerId !== null ? { ownerId } : {};

  const sortBy = QUEUE_SORT_FIELDS.find((f) => f === query.sortBy) ?? "updatedAt";
  const sortDir: Prisma.SortOrder = query.sortDir === "asc" ? "asc" : "desc";
  const page = readId(query.page) ?? 1;
  const pageSizeCandidate = Number(query.pageSize);
  const pageSize = PAGE_SIZES.includes(pageSizeCandidate) ? pageSizeCandidate : QUEUE_DEFAULT_PAGE_SIZE;

  try {
    const prisma = getPrisma();

    const where = {
      ...(categoryId !== null ? { categoryId } : {}),
      ...(requestedPriority ? { requestedPriority } : {}),
      ...(itPriority ? { itPriority } : {}),
      ...(currentStatus ? { currentStatus } : {}),
      ...ownerFilter,
      ...(search
        ? {
            OR: [
              { ticketNumber: { contains: escapeLikePattern(search), mode: "insensitive" as const } },
              { summary: { contains: escapeLikePattern(search), mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const totalItems = await prisma.ticket.count({ where });
    const totalPages = Math.ceil(totalItems / pageSize);
    const pagination = { page, pageSize, totalItems, totalPages };

    // Lab 2 BR-17, carried over: a page past the end is an empty result with
    // accurate metadata, not an error.
    if (page > totalPages) {
      return res.json({ data: [], pagination });
    }

    // IT Priority sorts by rank because PostgreSQL orders an enum by its
    // declaration (LOW, MEDIUM, HIGH), not alphabetically. A null — a migrated
    // Lab 2 row the backfill did not reach — goes last in both directions:
    // PostgreSQL would put it *first* in a descending sort, which would push
    // tickets nobody has triaged above the HIGH ones a queue is read for.
    const primary: Prisma.TicketOrderByWithRelationInput =
      sortBy === "itPriority"
        ? { itPriority: { sort: sortDir, nulls: "last" } }
        : { [sortBy]: sortDir };

    const data = await prisma.ticket.findMany({
      where,
      // Ties resolve by ticketNumber desc, as in Lab 2, so the order is total
      // and a row cannot drift between pages.
      orderBy: sortBy === "ticketNumber" ? [{ ticketNumber: sortDir }] : [primary, { ticketNumber: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      // No `attachments`: the queue never renders them per row, and loading
      // them for 25 Tickets at a time would be wasted work (api-spec.md §7).
      include: TICKET_PEOPLE,
    });

    res.json({ data, pagination });
  } catch (error) {
    console.error("Error listing the staff ticket queue:", error);
    sendInternalError(res);
  }
});

// GET /api/staff/assignees — api-spec.md §7, FR-16, BR-25.
//
// The narrowest list that makes the Owner filter here and the reassign control
// in Issue #32 work: actor summaries of active IT Staff and Administrators.
// It exists so IT Staff never need the Administrator user list, which carries
// email addresses and activation state.
app.get("/api/staff/assignees", staffOnly, async (_req: Request, res: Response) => {
  try {
    const data = await getPrisma().user.findMany({
      where: { isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
      select: { id: true, name: true, role: true },
      // Name first for a person reading the list; id breaks a tie between two
      // people with the same name so the order never changes between loads.
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    res.json({ data });
  } catch (error) {
    console.error("Error listing assignees:", error);
    sendInternalError(res);
  }
});

// ---------------------------------------------------------------------------
// Issue #13 — envelope coverage for the two responses Express would otherwise
// answer itself. api-spec.md §1 promises the error envelope on *every* non-2xx
// response, but an unmatched path and an unparseable JSON body were both being
// served as Express's default HTML error page. These two handlers must stay
// last: the 404 only fires when no route matched, and the error handler only
// when something threw past one.
// ---------------------------------------------------------------------------
app.use((_req: Request, res: Response) => {
  sendError(res, 404, "NOT_FOUND", "Resource not found.");
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  // res.sendFile streams: a failure part-way through arrives here with the
  // status line and headers already gone. Writing an envelope on top of that
  // would throw ERR_HTTP_HEADERS_SENT, so the connection is Express's to close.
  if (res.headersSent) {
    console.error("Error after the response had started:", error);
    return next(error);
  }

  // express.json() rejects a malformed body with status 400 before any route
  // sees it; anything else here is unexpected and stays generic (api-spec.md §6).
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return sendError(res, status, "VALIDATION_ERROR", "The request could not be read.");
  }
  console.error("Unhandled error:", error);
  sendInternalError(res);
});

export default app;