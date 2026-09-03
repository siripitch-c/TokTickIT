const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Issue #12 — Data model foundation & Requester context
// ---------------------------------------------------------------------------
export interface Requester {
  id: number;
  name: string;
}

// api-spec.md §3: GET /api/requesters -> { data: [...] }, active only, no
// requester context header required. Throws on any non-2xx response so the
// caller can show BR-08's safe error state.
export async function fetchRequesters(): Promise<Requester[]> {
  const res = await fetch(`${API_URL}/api/requesters`);
  if (!res.ok) {
    throw new Error("Failed to load Development Requesters");
  }
  const body = await res.json();
  return body.data as Requester[];
}

// ---------------------------------------------------------------------------
// Issue #13 — Create Ticket
// ---------------------------------------------------------------------------
export interface ReferenceItem {
  id: number;
  name: string;
}

export type RequestedPriority = "LOW" | "MEDIUM" | "HIGH";

export interface AttachmentMeta {
  id: number;
  ticketId: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  removedAt: string | null;
  removedReason: string | null;
}

export interface Ticket {
  id: number;
  ticketNumber: string;
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
  itPriority: RequestedPriority | null;
  currentStatus: "NEW";
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentMeta[];
}

export interface NewTicket {
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
}

/**
 * Carries the api-spec.md §1 error envelope through to the UI, so a screen can
 * put a server-side validation message on the field it belongs to instead of
 * showing one generic banner (BR-23: the server is authoritative).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const SAFE_FALLBACK_MESSAGE = "Something went wrong. Please try again.";

// api-spec.md §1: every non-2xx carries { error: { code, message, field? } }.
// A response that fails to parse still has to surface as a safe ApiError
// rather than a raw crash (BR-24's "safe error" requirement).
async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const error = body?.error;
    if (error?.code && error?.message) {
      return new ApiError(response.status, error.code, error.message, error.field);
    }
  } catch {
    // fall through to the generic error below
  }
  return new ApiError(response.status, "INTERNAL_ERROR", SAFE_FALLBACK_MESSAGE);
}

// The Lab 2 Development Requester context header (api-spec.md §1) — a testing
// mechanism, not authentication (BR-04/BR-40).
function requesterHeaders(requesterId: number): Record<string, string> {
  return { "X-Requester-Id": String(requesterId) };
}

async function fetchReference(path: string): Promise<ReferenceItem[]> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body.data as ReferenceItem[];
}

export function fetchCategories(): Promise<ReferenceItem[]> {
  return fetchReference("/api/categories");
}

export function fetchRelatedSystems(): Promise<ReferenceItem[]> {
  return fetchReference("/api/related-systems");
}

export async function createTicket(requesterId: number, ticket: NewTicket): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...requesterHeaders(requesterId) },
    body: JSON.stringify(ticket),
  });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body.data as Ticket;
}

/**
 * BR-25/BR-34: attachments are uploaded one at a time against an already-saved
 * Ticket, and each one succeeds or fails on its own — a failure here never
 * rolls back the Ticket or the uploads that already worked.
 */
export async function uploadAttachment(
  requesterId: number,
  ticketId: number,
  file: File,
): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: requesterHeaders(requesterId),
    body: form,
  });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body.data as AttachmentMeta;
}
