# Lab 2 Sprint Engineering Specification

## 1. Sprint goal

Deliver the Requester-facing TokTickIT MVP. A temporary Development Requester selects an identity, creates an IT ticket with permitted evidence, receives a traceable backend-generated number, and can later find and manage only that Requester's tickets and attachments. This selector is test context only; it is not authentication.

## 2. Scope

Included: requester selection/switching; Create Ticket; My Tickets search, filters, sort and paging; read-only requester Ticket Detail; attachment upload/download/soft removal; PostgreSQL/Prisma data increment; Zen Green reusable UI; automated, E2E, responsive and visual evidence.

Excluded: login/logout/passwords/tokens/sessions/roles; IT Staff queue, claim/reassign or IT-priority changes; comments, internal notes and actions; all status transitions after `New`; administration of users/reference data.

## 3. Functional requirements

- FR-01 The selector lists active Development Requesters and establishes a context before any ticket route is usable.
- FR-02 The shell shows the current Requester and a Change Requester action; switching reloads scoped data and resets Create Ticket.
- FR-03 A Requester creates a ticket with category, related system, requested priority, summary, description and zero to five attachments.
- FR-04 Successful creation returns and displays a unique official Ticket Number.
- FR-05 My Tickets lists only the current Requester's tickets with pagination.
- FR-06 Search matches Ticket Number or Summary.
- FR-07 Filters support Category, Requested Priority, IT Priority and Current Status.
- FR-08 Sort supports Ticket Number, Created Date and Last Updated in either direction.
- FR-09 An owner can open a read-only Ticket Detail with its attachment list.
- FR-10 The API never returns or changes another Requester's ticket or attachment.
- FR-11 An owner can add a permitted attachment while fewer than five active attachments exist.
- FR-12 An owner can download an active attachment.
- FR-13 An owner can soft-remove an attachment with a reason; removed metadata remains visible but its content is unavailable.
- FR-14 Every data-fetching screen has loading, empty/no-results where applicable, and safe error/retry states.
- FR-15 Create Ticket preserves entered values after validation or server failure.

## 4. Business rules

### Defaults and identity

- BR-01 Backend generates unique `TKT-YYYY-NNNNNN`; its sequence allocation is atomic (database sequence/transaction) and a unique constraint is the final guard.
- BR-02 A ticket starts `currentStatus=NEW`, `itPriority=null`; `createdAt` and `updatedAt` are server-generated and read-only.
- BR-03 The selector is explicitly temporary testing context, replaced by authentication in Lab 3.
- BR-04 Only `Requester.isActive=true` records are returned or selectable. If none exist, show a blocking empty state; on fetch failure show blocking retry.
- BR-05 Store the selected requester ID in session-scoped client storage. Restore it only if it still identifies an active Requester.
- BR-06 Change Requester clears scoped client cache, reloads My Tickets, and resets any Create Ticket draft; previous data must not remain visible.

### Ownership and list queries

- BR-07 `requesterId` is required on every requester-scoped endpoint. The server filters list queries and verifies ticket/attachment ownership; UI checks alone are insufficient.
- BR-08 A missing, foreign, removed-content, or unauthorized ticket/attachment is returned as safe `404`, not `403`; no existence is leaked.
- BR-09 Search is case-insensitive partial matching against Ticket Number or Summary only.
- BR-10 Filters use one value per field and AND logic: categoryId, requestedPriority, itPriority (including `UNSET`), currentStatus.
- BR-11 Default order is `createdAt desc, ticketNumber desc`. Supported primary fields are `ticketNumber`, `createdAt`, `updatedAt`; direction is `asc|desc`.
- BR-12 `page` is positive integer, default 1; `pageSize` is 10, 25 or 50, default 10. Unknown keys, invalid enum values, invalid sort field/direction and non-numeric/out-of-range page/pageSize are ignored and their defaults applied. A syntactically malformed query string/body remains 400. A page beyond the last returns an empty items array and accurate metadata.
- BR-13 My Tickets with zero owned records is an empty state with Create Ticket CTA; zero matches after search/filter against non-empty ownership is a distinct no-results state.

### Ticket validation and failure behavior

- BR-14 requesterId is derived from selected context and is immutable after creation.
- BR-15 Category and Related System are required active records; Requested Priority is required `LOW|MEDIUM|HIGH`.
- BR-16 Summary is required after trim, 5-150 characters. Description is required after trim, 10-2000 characters. Client validates before request; server revalidates authoritatively.
- BR-17 Submit disables immediately and exposes a busy state until resolution, allowing only one create request.
- BR-18 Validation/server failure creates no partial Ticket and preserves fields/draft. Successful Ticket creation commits before attachment uploads. If a later file fails, retain the Ticket and successful files, show its number, and flag each failed file separately.

### Attachments

- BR-19 Allowed types are JPG/JPEG, PNG, WEBP and PDF, verified client and server; each is at most 5 MiB.
- BR-20 A Ticket has at most five active (`removedAt IS NULL`) attachments. A sixth returns 409; removing one permits a later upload.
- BR-21 Store generated/sanitized filenames only; retain original filename as display metadata. Never construct a storage path from user input.
- BR-22 Attachment metadata includes originalFilename, storedFilename, mimeType, sizeBytes, uploadedAt, removedAt and removedReason.
- BR-23 Deletion is soft only: require confirmation and a trimmed 5-200 character reason, set removedAt/reason, and retain read-only metadata.
- BR-24 Removed files can never download or preview, including direct URL requests. Active-file download sends the original filename.
- BR-25 Every attachment metadata, upload, download and removal route repeats parent-ticket ownership verification. Upload failure leaves existing Ticket and attachments unchanged and offers retry.

### UI, accessibility and Lab 3 evolution

- BR-26 Priority/status badges always present text plus color. Icon-only controls have accessible name and tooltip; all interactive controls retain visible keyboard focus.
- BR-27 Responsive breakpoints: desktop >=992px, tablet 768-991px, mobile <768px. Mobile uses stacked forms/cards and has no horizontal scrolling.
- BR-28 Requester email is unique and `Ticket.requesterId` is a stable FK intended to map to Lab 3 authenticated identity without schema rewrite. Existing tickets of a later-inactivated Requester remain stored but cannot be selected in Lab 2.

## 5. Data design and seed

`Requester(id, name, email unique, isActive default true, createdAt)`; `RelatedSystem(id, name unique, isActive default true, createdAt)`; `Category` retains Lab 1 active reference data.

`Ticket(id, ticketNumber unique, requesterId FK, categoryId FK, relatedSystemId FK, summary, description, requestedPriority enum, itPriority enum nullable, currentStatus enum default NEW, createdAt, updatedAt)`.

`Attachment(id, ticketId FK, originalFilename, storedFilename, mimeType, sizeBytes, uploadedAt, removedAt nullable, removedReason nullable)`.

Use FK indexes, Ticket indexes on `createdAt` and `(requesterId,createdAt)`, and an Attachment ticket FK index. Introduce all new models/relations in one migration. Seed idempotently via upsert: the four categories Account and Access, Hardware, Software, Network; at least Email, Campus Wi-Fi, VPN, LEB2 App, Grade Submission App, Printer, Corporate Laptop, Other / Not Listed; >=4 active and >=1 inactive Requesters.

## 6. API contract summary

See [api-spec.md](api-spec.md). Required routes: `GET /api/categories`, `GET /api/related-systems`, `GET /api/requesters`, `POST|GET /api/tickets`, `GET /api/tickets/:id`, `POST /api/tickets/:id/attachments`, and `GET|DELETE /api/attachments/:id` plus `GET /api/attachments/:id/download`.

## 7. UI summary

See [ui-spec.md](ui-spec.md). Use Zen Green `#006B3C`, secondary `#0B7A46`, pale `#EAF6EF`, page `#F5F7F6`, readable validation below fields, white editable fields and distinct soft gray-green read-only fields.

## 8. Acceptance criteria

- AC-01 Valid submission saves one Ticket and displays its official number.
- AC-02 Ticket routes without selected context redirect to selector.
- AC-03 Requester B receives 404 for Requester A ticket.
- AC-04 Empty Summary gives field error and sends no request.
- AC-05 Mobile valid flow shows number without clipping/overflow.
- AC-06 Unreachable backend retains valid entered values and shows safe error.
- AC-07 Sixth active attachment is rejected without storage.
- AC-08 Direct download of removed attachment is rejected.
- AC-09 A's 12 tickets never include B's 3 in count/list.
- AC-10 Search miss shows no-results, not empty state.
- AC-11 Inactive Requester is absent from selector.
- AC-12 Switching requester reloads only new context's tickets.
- AC-13 Missing removal reason blocks removal with validation.
- AC-14 Create screen is unclipped/no-overflow on desktop, tablet and mobile.
- AC-15 Changing Ticket Number asc to Created Date desc reorders without full reload.
- AC-16 Double-click while pending creates exactly one Ticket.
- AC-17 Owner downloads an active attachment successfully.

## 9. Definition of done

All FR/BR/AC above are implemented and mapped to passing tests in `tests.md`; no required test is skipped/disabled. Server and client tests run from a clean clone; Playwright E2E and screenshot artifacts pass. API ownership cross-context tests cover Ticket and Attachment. README setup/test instructions, Prisma migration/seed, docs, UI visual checklist and accessible responsive screens are current. Each of the seven issues is implemented on its feature branch, peer-reviewed into `lab2-staging`; integration passes; a reviewed release PR merges staging to main. Submit one readable PDF with exact headings Answer Part 1 through Answer Part 9 and working links.

## 10. Assumptions and decisions

`Other / Not Listed` keeps Related System required. `createdAt` is Ticket Date in local display format. The chosen summary/description limits prevent trivial input while preserving a concise list title and detailed problem body. Header/query requester context intentionally models Lab 2 selection only; it is not a claim of real authentication security.
