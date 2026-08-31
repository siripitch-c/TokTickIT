# Lab 2 API Contract

## Conventions

All responses are JSON except downloads. Requester-scoped calls require header `X-Requester-Id: <positive integer>`; missing/invalid context is `400`. The server applies it, never a client-side ownership check. Safe errors use `{ "error": { "code": "...", "message": "safe user-facing text", "fields": { "field": "message" } } }`; omit `fields` when not applicable. Never expose storage filenames/paths. All timestamps are ISO-8601 UTC.

## Reference data

`GET /api/categories`, `GET /api/related-systems`, `GET /api/requesters` return `200 {items:[{id,name,...}]}` and active records only. Requesters contain `id,name,email`; inactive records are excluded. `500` returns a safe generic error.

## Tickets

### POST /api/tickets

Requires requester header. JSON body: `{categoryId,relatedSystemId,requestedPriority,summary,description}`. Trim summary/description server-side; validate active references, priority and lengths from BR-16. Ignore/reject client-supplied ticketNumber, requesterId, IT priority, status and timestamps (`400`). Return `201 {ticket:{id,ticketNumber,requesterId,category,relatedSystem,summary,description,requestedPriority,itPriority:null,currentStatus:"NEW",createdAt,updatedAt}}`. Validation is `400` with field messages; unexpected persistence failure is `500` and persists no Ticket. Attachments are uploaded separately after this response.

### GET /api/tickets

Requires requester header. Query: `search`, `categoryId`, `requestedPriority=LOW|MEDIUM|HIGH`, `itPriority=LOW|MEDIUM|HIGH|UNSET`, `currentStatus=NEW`, `sortBy=ticketNumber|createdAt|updatedAt`, `sortDir=asc|desc`, `page`, `pageSize`.

Invalid/unknown query values are ignored and defaulted: sort `createdAt desc` then `ticketNumber desc`; page `1`; pageSize `10` (allowed 10/25/50). Filter comparison is AND. `UNSET` maps to `itPriority IS NULL`. Return `200 {items:[TicketListItem],pagination:{page,pageSize,totalCount,totalPages,hasPreviousPage,hasNextPage}}`; beyond last page returns `items:[]` with correct metadata. A malformed query encoding/request is `400`; unexpected error is `500`.

### GET /api/tickets/:id

Requires requester header and a positive numeric path ID. Return owned detail and all attachment metadata (including removed records) in `200 {ticket:{...,attachments:[Attachment]}}`. Invalid ID is `400`; absent/foreign ticket is indistinguishable `404`; server failure `500`.

## Attachments

`Attachment` response fields are `id,ticketId,originalFilename,mimeType,sizeBytes,uploadedAt,removedAt,removedReason,isRemoved`. `storedFilename` is never public.

### POST /api/tickets/:id/attachments

Requires requester header, owned positive ticket ID and `multipart/form-data` field `file` (one file per request). Validate type by MIME plus extension/signature as feasible, <= 5 MiB, and fewer than five active attachments before writing. Store with generated filename. Return `201 {attachment}`. Invalid/missing file `400`; foreign/missing ticket `404`; sixth active file `409`; oversized `413`; unsupported type `415`; unexpected upload failure `500` with no attachment row/file retained.

### GET /api/attachments/:id

Requires requester header. Return owned attachment metadata even after soft removal: `200 {attachment}`. Invalid ID `400`; absent/foreign `404`; `500` safe error.

### GET /api/attachments/:id/download

Requires requester header. For an owned active attachment, return `200` file bytes with safe `Content-Type` and `Content-Disposition: attachment; filename="<original filename>"`. Missing, foreign, soft-removed or unavailable-on-disk resource returns `404`; no preview route is provided. Never return removed content.

### DELETE /api/attachments/:id

Requires requester header. Body `{reason}`; trim and require 5-200 characters. Return `200 {attachment}` after setting `removedAt` and `removedReason`, never deleting the row/file record. Invalid reason/ID `400`; foreign/missing/already-removed `404`; failure `500`. Client must present a confirmation step before this call.

## Status matrix

`200` retrieval/update; `201` ticket/attachment creation; `400` invalid input/context; `404` missing or failed ownership/removal-content lookup; `409` active attachment cap; `413` oversized upload; `415` unsupported type; `500` safe unexpected error. No endpoint uses `403` for requester ownership.
