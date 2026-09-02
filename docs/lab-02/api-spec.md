# Lab 2 API Contract

This document is the authoritative, exact contract for every Lab 2 endpoint.
`specification.md` §8 is only a summary; this file is what the implementation
and tests must match verbatim — field names, param names, and status codes
here are final unless changed here first.

## 1. Conventions

- **Base path:** `/api`
- **Requester context header:** every Requester-scoped endpoint requires
  `X-Requester-Id: <integer>` on the request. This is the Lab 2 Development
  Requester testing mechanism (BR-04), **not real authentication** — see
  specification.md BR-40 and the README note required by the Definition of
  Done. There is no session; the header must be sent on every request. A
  Requester-scoped request whose `X-Requester-Id` is missing, blank, or
  not a positive integer is rejected with **400** `VALIDATION_ERROR`
  (no `field`, since the fault is in a header rather than a body field)
  — see `tests.md` API-DETAIL-04. This is the one 400 that applies to
  reads as well as writes: it is a malformed request, not the lenient
  query-parameter handling of BR-18.
- **Content type:** `application/json` for all bodies except attachment
  upload, which is `multipart/form-data`.
- **Timestamps:** ISO 8601 UTC strings (e.g. `2026-05-12T09:14:00.000Z`).
- **Error envelope** (used for every non-2xx response):
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Summary must be between 5 and 150 characters.",
      "field": "summary"
    }
  }
  ```
  `field` is omitted when the error isn't tied to one request field (e.g. a
  404 or 500). This envelope covers **every** non-2xx response, including
  the two Express would otherwise answer with its own HTML error page: an
  unmatched path returns **404** `NOT_FOUND`, and a body that cannot be
  parsed as JSON returns **400** `VALIDATION_ERROR` before any route runs
  (`tests.md` API-ERR-01). `code` is a stable machine-readable string; `message` is
  human-readable and safe to show directly in the UI.
- **Pagination envelope** (used by the ticket list endpoint):
  ```json
  {
    "data": [ /* array of items */ ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "totalItems": 42,
      "totalPages": 5
    }
  }
  ```

## 2. Enums

- `RequestedPriority`: `LOW` | `MEDIUM` | `HIGH`
- `ITPriority`: `LOW` | `MEDIUM` | `HIGH` | `null` (always `null` in Lab 2 —
  set only by IT Staff in a later sprint, per BR-02)
- `CurrentStatus`: `NEW` (the only value ever produced in Lab 2, per BR-02;
  the column is an enum so later sprints can add more without a migration
  that changes column type)

## 3. Reference Data Endpoints

### `GET /api/categories`
- Requester context: not required (public reference data).
- Query params: none.
- 200 response:
  ```json
  { "data": [ { "id": 1, "name": "Hardware" }, ... ] }
  ```
- Only `isActive: true` Categories are returned; `isActive` itself is not
  included in the response (irrelevant to the client).

### `GET /api/related-systems`
- Requester context: not required.
- Query params: none.
- 200 response: same shape as Categories:
  ```json
  { "data": [ { "id": 1, "name": "VPN" }, ... ] }
  ```
- Only active Related Systems returned (BR list includes `Other / Not
  Listed` as a normal seeded row — no special client handling needed).

### `GET /api/requesters`
- Requester context: not required (this endpoint is what powers the
  Development Requester Selection screen itself).
- Query params: none.
- 200 response:
  ```json
  { "data": [ { "id": 3, "name": "Jennifer Anderson" }, ... ] }
  ```
- Only `isActive: true` Requesters are returned (BR-05, BR-35). `email` is
  intentionally omitted from this public list response.
- 500 response: safe generic error envelope; the Requester Selection
  screen shows BR-08's failure state on any non-2xx response here.
- Empty `data: []` array (not an error) is the trigger for BR-09's empty
  state — the client checks array length, not a special status code.

## 4. Ticket Endpoints

### `POST /api/tickets`
- Requester context: **required** (`X-Requester-Id`). The authenticated —
  in Lab 2, selected — Requester becomes `requesterId` on the created
  Ticket; the client never sends `requesterId` in the body.
- Request body:
  ```json
  {
    "categoryId": 2,
    "relatedSystemId": 7,
    "summary": "Laptop battery drains quickly",
    "description": "The battery drains much faster than usual...",
    "requestedPriority": "MEDIUM"
  }
  ```
- Validation (400 on failure, per BR-19–BR-23):
  - `categoryId`: required, must reference an active Category → else 400
    `INVALID_CATEGORY`
  - `relatedSystemId`: required, must reference an active RelatedSystem →
    else 400 `INVALID_RELATED_SYSTEM`
  - `summary`: required, trimmed, 5–150 chars → else 400 `VALIDATION_ERROR`
    (`field: "summary"`)
  - `description`: required, trimmed, 10–2000 chars → else 400
    `VALIDATION_ERROR` (`field: "description"`)
  - `requestedPriority`: required, one of the enum values → else 400
    `VALIDATION_ERROR` (`field: "requestedPriority"`)
- 201 response:
  ```json
  {
    "data": {
      "id": 118,
      "ticketNumber": "TKT-2026-000118",
      "requesterId": 3,
      "categoryId": 2,
      "relatedSystemId": 7,
      "summary": "Laptop battery drains quickly",
      "description": "The battery drains much faster than usual...",
      "requestedPriority": "MEDIUM",
      "itPriority": null,
      "currentStatus": "NEW",
      "createdAt": "2026-05-12T09:14:00.000Z",
      "updatedAt": "2026-05-12T09:14:00.000Z",
      "attachments": []
    }
  }
  ```
- This endpoint does **not** accept attachments in the same request.
  Attachments are uploaded afterward via `POST /api/tickets/:id/attachments`
  (BR-25, BR-34) — the client calls Create Ticket first, then fires 0–5
  attachment uploads against the returned `id`, each independently
  best-effort per BR-25/BR-34.
- 500 response: safe generic error, no partial Ticket persisted (BR-24).

### `GET /api/tickets`
- Requester context: **required**. Only Tickets where `requesterId`
  matches the header value are ever considered (BR-11).
- Query params (all optional; every one is lenient per BR-18 — invalid or
  unrecognized values fall back to defaults, never a 400):

  | Param | Type | Default | Notes |
  |---|---|---|---|
  | `search` | string | — (no filter) | matches `ticketNumber` or `summary`, case-insensitive partial (BR-13) |
  | `category` | integer (Category id) | — | BR-14 |
  | `requestedPriority` | `LOW`\|`MEDIUM`\|`HIGH` | — | BR-14 |
  | `itPriority` | `LOW`\|`MEDIUM`\|`HIGH` | — | BR-14 |
  | `status` | `NEW` | — | BR-14 |
  | `sortBy` | `ticketNumber`\|`createdAt`\|`updatedAt` | `createdAt` | BR-15 |
  | `sortDir` | `asc`\|`desc` | `desc` | BR-15 |
  | `page` | integer ≥ 1 | `1` | BR-17 |
  | `pageSize` | `10`\|`25`\|`50` | `10` | BR-16 |

  Filters combine with AND logic (BR-14). Ties on `sortBy` break by
  `ticketNumber desc` (BR-15's secondary sort).
- 200 response: the pagination envelope (§1) with `data` = array of Ticket
  summaries (same shape as the create response's `data`, minus the
  `attachments` array — My Tickets doesn't need attachment detail per row).
- `page` beyond the last page returns `data: []` with accurate `pagination`
  metadata, not an error (BR-17).

### `GET /api/tickets/:id`
- Requester context: **required**.
- If the Ticket doesn't exist, or exists but `requesterId` doesn't match
  the header value: **404** `TICKET_NOT_FOUND` (BR-12 — identical response
  for both cases, no way to distinguish them from the response).
- 200 response: full Ticket object (same shape as Create Ticket's `data`),
  with `attachments` populated as an array of Attachment metadata objects
  (§5) — including soft-removed ones, per BR-29 (metadata visible, file
  not downloadable).

## 5. Attachment Endpoints

Attachment metadata object shape (used in Ticket Detail's `attachments`
array and in the two attachment-specific GETs below):
```json
{
  "id": 44,
  "ticketId": 118,
  "originalFilename": "screenshot.png",
  "mimeType": "image/png",
  "sizeBytes": 214532,
  "uploadedAt": "2026-05-12T09:20:00.000Z",
  "removedAt": null,
  "removedReason": null
}
```
`storedFilename` is never included in any API response (internal only, per
BR-32).

### `POST /api/tickets/:id/attachments`
- Requester context: **required**; must own the Ticket at `:id` or **404**
  `TICKET_NOT_FOUND` (BR-11, same ownership rule as above).
- Request: `multipart/form-data` with a single `file` field.
- Validation:
  - Type not in JPG/JPEG/PNG/WEBP/PDF → **415** `UNSUPPORTED_FILE_TYPE`
  - Size > 5 MB → **413** `FILE_TOO_LARGE`
  - Ticket already has 5 active attachments → **409** `ATTACHMENT_LIMIT_REACHED`
    (BR-28)
- 201 response: `{ "data": <attachment metadata object> }`
- 500 response on upload failure: no attachment record stored, existing
  attachments and the Ticket itself are unaffected (BR-33).

### `GET /api/attachments/:id`
- Requester context: **required**; must own the parent Ticket or **404**
  `ATTACHMENT_NOT_FOUND` (BR-11).
- 200 response: `{ "data": <attachment metadata object> }` — returned even
  if `removedAt` is set (metadata stays visible per BR-29).

### `GET /api/attachments/:id/download`
- Requester context: **required**; ownership check as above → 404 if not
  owned.
- If `removedAt` is set (soft-removed): **404** `ATTACHMENT_NOT_FOUND`
  regardless of ownership — a removed attachment is never downloadable by
  anyone, including its owner (BR-30). This is the one case where an
  *owned* resource still 404s; it is intentional.
- 200 response: the raw file bytes with `Content-Type` set to the stored
  `mimeType` and `Content-Disposition: attachment; filename="<originalFilename>"`.

### `DELETE /api/attachments/:id`
- Requester context: **required**; must own the parent Ticket or **404**
  `ATTACHMENT_NOT_FOUND` (same rule as `GET /api/attachments/:id`).
- Request body:
  ```json
  { "removalReason": "Uploaded the wrong screenshot by mistake" }
  ```
- Validation: `removalReason` required, trimmed, 5–200 chars (BR-31) → else
  400 `VALIDATION_ERROR` (`field: "removalReason"`).
- Already-removed attachment (`removedAt` already set) → **409**
  `ALREADY_REMOVED` (idempotency guard; removal is not repeatable).
- 200 response: `{ "data": <attachment metadata object with removedAt and
  removedReason now populated> }` — this is a soft update, never a hard
  delete (BR-29), so the HTTP verb is DELETE but the row is never removed.

## 6. Status Code Reference

| Status | Code strings used | Meaning |
|---|---|---|
| 200 | — | Successful retrieval or soft-update |
| 201 | — | Ticket or Attachment created |
| 400 | `VALIDATION_ERROR`, `INVALID_CATEGORY`, `INVALID_RELATED_SYSTEM` | Request body failed validation |
| 404 | `TICKET_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `NOT_FOUND` | Missing resource, ownership failure (BR-12), removed-attachment download attempt, or an unmatched API path |
| 409 | `ATTACHMENT_LIMIT_REACHED`, `ALREADY_REMOVED` | Conflicting state |
| 413 | `FILE_TOO_LARGE` | Attachment exceeds 5 MB |
| 415 | `UNSUPPORTED_FILE_TYPE` | Attachment type not allowed |
| 500 | `INTERNAL_ERROR` | Unexpected server error; message is always generic, never a raw stack trace or DB error string |
