const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Issue #12 — Data model foundation & Requester context
// ---------------------------------------------------------------------------
// The `Requester` type and `fetchRequesters` are gone with the Development
// Requester selector: `GET /api/requesters` no longer exists (api-spec.md §6,
// AC-25). The signed-in user is `AuthUser`, further down.

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
  // Any of the eight (BR-30): a Requester's own Ticket moves through them too.
  currentStatus: CurrentStatus;
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

// Lab 3, Issue #30 — every Requester-scoped call now carries the session
// cookie instead of an `X-Requester-Id` header. `credentials: "include"` is
// what makes the browser send it across origins (client :5173, API :3000), so
// a call that forgets it is not merely insecure — it is unauthenticated
// (api-spec.md §1, BR-03).
const withSession: RequestInit = { credentials: "include" };

// Categories and Related Systems stay public (api-spec.md §3): they are
// neither personal nor sensitive, and the Create Ticket screen needs them
// before anything role-specific happens.
//
// They are still sent with the session, because api-spec.md §1 makes that the
// client's rule for *every* request, not only the protected ones. §3 says the
// server does not require a session here; it does not say the client must
// withhold one. Two fetch shapes would be a standing invitation to reach for
// the wrong one on an endpoint that later stops being public.
async function fetchReference(path: string): Promise<ReferenceItem[]> {
  const res = await fetch(`${API_URL}${path}`, { ...withSession });
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

export async function createTicket(ticket: NewTicket): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets`, {
    method: "POST",
    ...withSession,
    headers: { "Content-Type": "application/json" },
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
  ticketId: number,
  file: File,
): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    ...withSession,
    body: form,
  });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body.data as AttachmentMeta;
}

// ---------------------------------------------------------------------------
// Issue #14 — My Tickets
// ---------------------------------------------------------------------------

/** A row in the ticket list: the Ticket fields without its attachments (api-spec.md §4). */
export type TicketSummary = Omit<Ticket, "attachments">;

export interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export type TicketSortField = "ticketNumber" | "createdAt" | "updatedAt";
export type SortDirection = "asc" | "desc";

export interface TicketListQuery {
  search?: string;
  category?: number | "";
  requestedPriority?: RequestedPriority | "";
  itPriority?: RequestedPriority | "";
  status?: "NEW" | "";
  sortBy?: TicketSortField;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
}

/**
 * BR-18: the server treats every query parameter leniently, so blank values are
 * simply left out rather than sent as empty strings for it to ignore.
 */
export async function fetchTickets(
  query: TicketListQuery = {},
): Promise<{ data: TicketSummary[]; pagination: Pagination }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  const res = await fetch(`${API_URL}/api/tickets${search ? `?${search}` : ""}`, {
    ...withSession,
  });
  if (!res.ok) throw await toApiError(res);

  const body = await res.json();
  return { data: body.data as TicketSummary[], pagination: body.pagination as Pagination };
}

// ---------------------------------------------------------------------------
// Issue #15 — Requester Ticket Detail & Attachments
// ---------------------------------------------------------------------------

/** api-spec.md §4: the full Ticket, attachments included, removed ones too (BR-29). */
export async function fetchTicket(ticketId: number): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}`, {
    ...withSession,
  });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body.data as Ticket;
}

/**
 * BR-31: a removal carries its reason. The verb is DELETE but the row survives,
 * so the response is the updated metadata rather than an empty body (BR-29).
 */
export async function removeAttachment(
  attachmentId: number,
  removalReason: string,
): Promise<AttachmentMeta> {
  const res = await fetch(`${API_URL}/api/attachments/${attachmentId}`, {
    method: "DELETE",
    ...withSession,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removalReason }),
  });
  if (!res.ok) throw await toApiError(res);
  const body = await res.json();
  return body.data as AttachmentMeta;
}

/**
 * The download endpoint is Requester-scoped, so it needs the X-Requester-Id
 * header — which a plain <a href> cannot send. The file is fetched here and
 * handed to the browser as an object URL instead, which also means a refusal
 * (a removed attachment, someone else's file) surfaces as an ApiError the
 * screen can show rather than as a broken navigation.
 */
export async function downloadAttachment(
  attachment: Pick<AttachmentMeta, "id" | "originalFilename">,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/attachments/${attachment.id}/download`, {
    ...withSession,
  });
  if (!res.ok) throw await toApiError(res);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.originalFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Released on the next tick so the click has taken the blob first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// ---------------------------------------------------------------------------
// Lab 3, Issue #30 — authentication (api-spec.md §4).
//
// Every call here sends `credentials: "include"`, which is what makes the
// browser attach and store the `tt_session` cookie across origins: the client
// is on :5173 and the API on :3000, so without it the cookie is silently
// dropped and every request looks unauthenticated (api-spec.md §1).
// ---------------------------------------------------------------------------

export type Role = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

/** The safe user object of api-spec.md §4 — never carries a password hash. */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

// Lab 2's `ApiError` and `toApiError` above already carry the envelope's
// `field` through to the screen, which is exactly what ui-spec.md §5 needs for
// a wrong current password: 400 with `field: "currentPassword"` has to land
// under that control, not as a screen-level failure. They are reused here
// rather than duplicated.

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()).data as AuthUser;
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
  // Deliberately not throwing on a non-2xx: the only failure that matters here
  // is one the user could act on, and there is none. A session that was
  // already gone, or an API that cannot be reached, both end the same way —
  // the client drops its user and shows Login.
}

/**
 * The signed-in user, or null when there is no session.
 *
 * 401 is an answer, not a failure: it is how the server says "nobody is signed
 * in", which is exactly what the application asks on every page load. Anything
 * else is a real failure and throws, so a broken API cannot be mistaken for a
 * signed-out state (BR-13).
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw await toApiError(res);
  return (await res.json()).data as AuthUser;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<AuthUser> {
  const res = await fetch(`${API_URL}/api/auth/change-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()).data as AuthUser;
}

// ---------------------------------------------------------------------------
// Lab 3, Issue #31 — IT Staff Ticket Queue (api-spec.md §7)
// ---------------------------------------------------------------------------

/** specification.md BR-30 — every status a Ticket can hold. */
export type CurrentStatus =
  | "NEW"
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_FOR_REQUESTER"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED"
  | "CANCELLED";

export const CURRENT_STATUSES: CurrentStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
];

/** api-spec.md §5 — the only shape a person is named in. Never an email. */
export interface ActorSummary {
  id: number;
  name: string;
  role: Role;
}

/** A queue row: the §5 Ticket object without `attachments` (§7). */
export interface StaffTicket {
  id: number;
  ticketNumber: string;
  requesterId: number;
  requester: ActorSummary;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
  itPriority: RequestedPriority | null;
  currentStatus: CurrentStatus;
  ownerId: number | null;
  owner: ActorSummary | null;
  requesterResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QueueSortField = "ticketNumber" | "createdAt" | "updatedAt" | "itPriority";

export interface StaffQueueQuery {
  search?: string;
  category?: number;
  requestedPriority?: RequestedPriority;
  itPriority?: RequestedPriority;
  status?: CurrentStatus;
  owner?: number | "unassigned";
  sortBy?: QueueSortField;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
}

export async function fetchStaffTickets(
  query: StaffQueueQuery = {},
): Promise<{ data: StaffTicket[]; pagination: Pagination }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  const res = await fetch(`${API_URL}/api/staff/tickets${search ? `?${search}` : ""}`, {
    ...withSession,
  });
  if (!res.ok) throw await toApiError(res);

  const body = await res.json();
  return { data: body.data as StaffTicket[], pagination: body.pagination as Pagination };
}

/** FR-16 — active IT Staff and Administrators, for the Owner filter and, in #32, reassignment. */
export async function fetchAssignees(): Promise<ActorSummary[]> {
  const res = await fetch(`${API_URL}/api/staff/assignees`, { ...withSession });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()).data as ActorSummary[];
}
