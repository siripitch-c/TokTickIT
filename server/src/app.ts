import express, { Request, Response } from "express";
import cors from "cors";
import { getPrisma } from "./prisma.js";
import { nextTicketNumber } from "./ticketNumber.js";
import { readRequesterId, sendError, sendInternalError } from "./requesterContext.js";
import {
  ATTACHMENT_TYPE_HELP,
  allowedExtensionFor,
  attachmentUpload,
  deleteStoredFile,
  storeAttachmentFile,
  toDisplayFilename,
} from "./uploads.js";
import type { Attachment } from "@prisma/client";
import type { NextFunction } from "express";
import { MulterError } from "multer";
// getPrisma() is your lazy database handle. Call it INSIDE a route when you
// need the DB (Issue 4). It is intentionally unused until then.
void getPrisma;

// The Express app is exported separately from app.listen() (see index.ts) so
// Supertest can import `app` without opening a port. Do not merge these files.
export const app = express();

app.use(cors());          // already wired: lets the Vite dev server call this API
app.use(express.json());

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

// ---------------------------------------------------------------------------
// Issue #12 — Data model foundation & Requester context
// GET /api/requesters — api-spec.md §3. No requester context header needed;
// this endpoint powers the Selection screen itself (BR-05, BR-35).
// Only active Requesters are returned; email is intentionally omitted.
// ---------------------------------------------------------------------------
app.get("/api/requesters", async (req, res) => {
  try {
    const prisma = getPrisma();
    const requesters = await prisma.requester.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true }, // email intentionally omitted (api-spec.md §3)
    });
    res.json({ data: requesters });
  } catch (error) {
    console.error("Error fetching requesters:", error);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
  }
});

// ---------------------------------------------------------------------------
// Issue #13 — Create Ticket
// POST /api/tickets — api-spec.md §4. Requester-scoped: ownership comes from
// the X-Requester-Id header (BR-10), never from the request body. Unlike the
// lenient GET query params of BR-18, request bodies are validated strictly and
// return 400 on the first failure (BR-19..BR-23).
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

function readPositiveInt(value: unknown): number | null {
  const id = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

app.post("/api/tickets", async (req, res) => {
  const requesterId = readRequesterId(req);
  if (requesterId === null) {
    return sendError(res, 400, "VALIDATION_ERROR", "A valid X-Requester-Id header is required.");
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // Reference ids get their own error codes (api-spec.md §4) so the client can
  // tell "pick a category" apart from "your text is too short".
  const categoryId = readPositiveInt(body.categoryId);
  if (categoryId === null) {
    return sendError(res, 400, "INVALID_CATEGORY", "Please choose a category.", "categoryId");
  }
  const relatedSystemId = readPositiveInt(body.relatedSystemId);
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

    // BR-01: number and row commit together. itPriority/currentStatus/timestamps
    // are all left to the schema defaults, so nothing the client sent for them
    // can take effect (BR-02, BR-03).
    const data = { requesterId, categoryId, relatedSystemId, summary, description, requestedPriority };
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
};

// BR-01: the ticketNumber unique constraint is a safety net behind the atomic
// counter, so one retry is enough — a second collision would mean the counter
// itself is broken and should surface as a 500 rather than loop.
async function createTicketWithNumber(prisma: ReturnType<typeof getPrisma>, data: NewTicketData) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const ticketNumber = await nextTicketNumber(tx, new Date().getFullYear());
        return tx.ticket.create({ data: { ...data, ticketNumber } });
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

app.post("/api/tickets/:id/attachments", receiveAttachment, async (req, res) => {
  const requesterId = readRequesterId(req);
  if (requesterId === null) {
    return sendError(res, 400, "VALIDATION_ERROR", "A valid X-Requester-Id header is required.");
  }

  const ticketId = Number(req.params.id);
  if (!Number.isInteger(ticketId) || ticketId < 1) {
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
    // slot back even though its row and metadata remain (BR-29).
    const activeCount = await prisma.attachment.count({ where: { ticketId, removedAt: null } });
    if (activeCount >= MAX_ACTIVE_ATTACHMENTS) {
      return sendError(
        res,
        409,
        "ATTACHMENT_LIMIT_REACHED",
        `A ticket can have at most ${MAX_ACTIVE_ATTACHMENTS} attachments. Remove one before adding another.`,
        "file",
      );
    }

    const storedFilename = storeAttachmentFile(file.buffer, extension);
    try {
      const attachment = await prisma.attachment.create({
        data: {
          ticketId,
          originalFilename,
          storedFilename,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
      });
      res.status(201).json({ data: toAttachmentResponse(attachment) });
    } catch (error) {
      // BR-33: a failed upload stores nothing at all — not a row, and not the
      // file that would otherwise be left orphaned on disk.
      deleteStoredFile(storedFilename);
      throw error;
    }
  } catch (error) {
    console.error("Error uploading attachment:", error);
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

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // express.json() rejects a malformed body with status 400 before any route
  // sees it; anything else here is unexpected and stays generic (api-spec.md §6).
  const status = (error as { status?: number } | null)?.status;
  if (status === 400) {
    return sendError(res, 400, "VALIDATION_ERROR", "The request body could not be read as JSON.");
  }
  console.error("Unhandled error:", error);
  sendInternalError(res);
});

export default app;