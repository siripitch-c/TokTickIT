# Lab 2 Test Plan and Results

## 1. Test Strategy

- **Unit tests** cover pure logic with no I/O (e.g. the Ticket Number format
  helper) — run with the server's unit test runner, no database needed.
- **API/integration tests** run against an isolated test PostgreSQL
  database and a temporary uploads directory, exercising real Prisma
  queries and real file I/O — nothing here is mocked except external
  network calls (there are none in Lab 2).
- **UI component tests** run with the client test runner (mocked fetch
  layer only — components, validation, and state logic are real).
- **E2E tests** run with Playwright against the full stack (real server,
  real seeded PostgreSQL) to prove cross-screen flows actually work.
- **Visual/responsive tests** are Playwright screenshots at three
  viewports, checked against `ui-spec.md` by the checklist in §5.
- No required test may be skipped, disabled, or commented out in the
  final `main` branch (Definition of Done, `specification.md` §10).
- Every test's title/comment includes its ID from this document (e.g.
  `// BR-19, API-CREATE-05`) so the mapping in §2–3 stays reviewable
  against the actual code, not just this file.

## 2. Planned Tests

### Unit

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UNIT-01 | Ticket Number formatter produces `TKT-YYYY-NNNNNN` | Matches format regex for several sample sequence numbers | `server/tests/lab-02/ticket-number.unit.test.ts` |

### API — Reference data & Requester context

| ID | What it tests | Expected result | File |
|---|---|---|---|
| API-REQ-01 | `GET /api/requesters` returns only active Requesters | Inactive seeded Requester is absent from response | `server/tests/lab-02/requesters.api.test.ts` |
| API-REQ-02 | `GET /api/requesters` with zero active Requesters | Returns `data: []`, not an error | `server/tests/lab-02/requesters.api.test.ts` |
| API-REQ-03 | Requester later set `isActive:false` | Their existing Tickets remain in DB but that Requester no longer appears in `/api/requesters` | `server/tests/lab-02/requesters.api.test.ts` |
| API-REF-01 | `GET /api/categories`, `GET /api/related-systems` | Return only active rows, correct shape | `server/tests/lab-02/reference-data.api.test.ts` |

### API — Create Ticket

| ID | What it tests | Expected result | File |
|---|---|---|---|
| API-CREATE-01 | Valid body | `201`, ticket persisted, unique `ticketNumber` returned | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-CREATE-02 | Defaults on creation | `currentStatus:"NEW"`, `itPriority:null` | same file |
| API-CREATE-03 | Client-supplied `createdAt`/`updatedAt`/`requesterId`/`ticketNumber` in body | Ignored; server-generated values used instead | same file |
| API-CREATE-04 | `requesterId` immutable after creation | No update endpoint accepts a `requesterId` change | same file |
| API-CREATE-05 | Summary boundary (4, 5, 150, 151 chars; whitespace-only) | 5–150 pass (trimmed), others `400 VALIDATION_ERROR field:summary` | same file |
| API-CREATE-06 | Description boundary (9, 10, 2000, 2001 chars) | 10–2000 pass, others `400` | same file |
| API-CREATE-07 | Missing/invalid `categoryId`, `relatedSystemId`, `requestedPriority` | Each independently returns `400` with correct `field` and code | same file |
| API-CREATE-08 | 20 concurrent creation requests | All 20 get unique `ticketNumber`s, no collision, no lost update (BR-01 atomicity) | same file |
| API-CREATE-09 | Two rapid duplicate submissions (simulating double-click at the API layer) | Server-side does not itself dedupe identical bodies — documents that duplicate prevention is a UI-layer control (BR-22); this test only proves atomic numbering, not idempotency | same file |
| API-CREATE-10 | Simulated DB failure during creation | `500`, no partial Ticket row persisted | same file |

### API — My Tickets (list)

| ID | What it tests | Expected result | File |
|---|---|---|---|
| API-LIST-01 | Requester A has 12 tickets, B has 3 | A's list has exactly 12 items, none of B's | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-LIST-02 | `search` matches ticket number (partial) and summary (partial, case-insensitive) | Correct subset returned for each | same file |
| API-LIST-03..06 | Each filter (`category`, `requestedPriority`, `itPriority` incl. unset, `status`) individually and combined (AND) | Correct filtered subset each time | same file |
| API-LIST-07 | Default sort with tied `createdAt` | Secondary sort by `ticketNumber desc` breaks the tie deterministically | same file |
| API-LIST-08 | `sortBy=ticketNumber&sortDir=asc` then switch to `sortBy=createdAt&sortDir=desc` | Order changes correctly both times | same file |
| API-LIST-09 | `pageSize` values 10/25/50/invalid/999 | Valid values honored; invalid falls back to 10 | same file |
| API-LIST-10 | `page` beyond last page | `data: []`, accurate `pagination` metadata, not an error | same file |
| API-LIST-11 | Unknown query key, invalid enum value, non-numeric `page` | All ignored/defaulted, never `400` (BR-18) | same file |

### API — Ticket Detail

| ID | What it tests | Expected result | File |
|---|---|---|---|
| API-DETAIL-01 | Owner requests their own ticket | `200` with full ticket + attachments array (including removed) | `server/tests/lab-02/ticket-detail.api.test.ts` |
| API-DETAIL-02 | Requester B requests Requester A's ticket ID | `404 TICKET_NOT_FOUND`, identical shape to a truly nonexistent ID | same file |
| API-DETAIL-03 | Nonexistent ticket ID | `404`, same response shape as API-DETAIL-02 (not distinguishable) | same file |
| API-DETAIL-04 | Missing `X-Requester-Id` header | `400` | same file |

### API — Attachments

| ID | What it tests | Expected result | File |
|---|---|---|---|
| API-ATT-01 | Upload each allowed type (JPG/JPEG/PNG/WEBP/PDF) and one disallowed type | Allowed succeed `201`; disallowed `415 UNSUPPORTED_FILE_TYPE` | `server/tests/lab-02/attachments.api.test.ts` |
| API-ATT-02 | Upload at 5 MB, 5 MB + 1 byte | At-limit succeeds; over-limit `413 FILE_TOO_LARGE` | same file |
| API-ATT-03 | Ticket with 5 active attachments, attempt a 6th | `409 ATTACHMENT_LIMIT_REACHED`, no 6th row created | same file |
| API-ATT-04 | Uploaded file's stored path/filename | Differs from `originalFilename`; not derived unsanitized from user input; no path-traversal characters accepted | same file |
| API-ATT-05 | Attachment metadata shape | Contains all required fields (§api-spec.md §5); `storedFilename` never present in any response | same file |
| API-ATT-06 | Requester B accesses/downloads/removes Requester A's attachment | `404 ATTACHMENT_NOT_FOUND` on all three operations | same file |
| API-ATT-07 | Remove an attachment with a valid reason | `200`, `removedAt`/`removedReason` set, row still present (not hard-deleted) | same file |
| API-ATT-08 | Download a removed attachment (including by its owner) | `404`, even for the owning Requester | same file |
| API-ATT-09 | Remove without a reason; reason of 4 and 201 chars | Blocked `400 VALIDATION_ERROR field:removalReason` in all three cases | same file |
| API-ATT-10 | Owner downloads an active attachment | `200`, correct bytes, correct `Content-Disposition` filename | same file |
| API-ATT-11 | Ticket created successfully, then one of its attachment uploads fails (simulated) | Ticket and any already-successful attachments remain; failed one is not partially stored | same file |
| API-ATT-12 | Add attachment to an existing ticket, simulated failure | No attachment row stored; existing ticket/attachments unaffected; error returned | same file |
| API-ATT-13 | Remove an already-removed attachment again | `409 ALREADY_REMOVED` | same file |

### UI — Requester context

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-CTX-01 | Selector screen initial render | Shows testing-only notice, dropdown, disabled Continue until a value is chosen | `client/src/tests/lab-02/RequesterSelection.test.tsx` |
| UI-CTX-02 | Loading/empty/error states | Correct state rendered for each mocked API outcome | same file |
| UI-CTX-03 | Selecting a Requester and navigating away/back | Selection persists (client storage) | same file |
| UI-CTX-04 | Change Requester action | Returns to selector; after new selection, My Tickets/Create Ticket reload with new context, no stale data | same file |
| UI-CTX-05 | Icon-only controls (e.g. Change Requester icon variant) and keyboard focus | Accessible label present; focus outline visible via keyboard nav | same file |

### UI — Create Ticket

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-CREATE-01 | Reference data (categories/related systems) loading/error | Correct loading and safe-error states | `client/src/tests/lab-02/CreateTicket.test.tsx` |
| UI-CREATE-02..05 | Empty/invalid Summary, Description, Category, Related System, Priority | Field-level message shown, no API call made | same file |
| UI-CREATE-06 | Valid submission | API called with correct payload; success view shows Ticket Number | same file |
| UI-CREATE-07 | Rapid double-click Submit | Button disabled/busy after first click; only one API call fires | same file |
| UI-CREATE-08 | Simulated API failure on submit | Safe error shown; all entered field values remain in the form | same file |
| UI-CREATE-09 | Select 0, 5, and 6 attachments before submit | 0–5 accepted; 6th blocked client-side with a message | same file |
| UI-CREATE-10 | Select a disallowed type / oversized file | Client-side rejects with a clear message before any upload attempt | same file |

### UI — My Tickets

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-LIST-01 | Loading/API-error states | Correct state shown | `client/src/tests/lab-02/MyTickets.test.tsx` |
| UI-LIST-02 | Zero owned tickets | Empty state with Create Ticket CTA | same file |
| UI-LIST-03 | Search/filter producing zero matches on a non-empty list | Distinct no-results state (not the empty state from UI-LIST-02) | same file |
| UI-LIST-04 | Search, each filter, and Clear Filters | List updates correctly; Clear Filters resets to unfiltered | same file |
| UI-LIST-05 | Sort header click, page navigation, page-size change | List reorders/pages correctly without full reload | same file |
| UI-LIST-06 | Desktop table vs. mobile card rendering | Correct layout per viewport, no clipped columns | same file |
| UI-LIST-07 | Requester switch while on My Tickets | List reloads to the new Requester's tickets only | same file |

### UI — Ticket Detail & Attachments

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-DETAIL-01 | Owned ticket load | Read-only fields render correctly, including local-format Ticket Date | `client/src/tests/lab-02/RequesterTicketDetail.test.tsx` |
| UI-DETAIL-02 | Not-found/foreign ticket | Safe not-found state, no data flash | same file |
| UI-DETAIL-03 | Add attachment: busy/success/error states | Correct state transitions per BR-33 | `client/src/tests/lab-02/AttachmentSection.test.tsx` |
| UI-DETAIL-04 | Download an active attachment | Triggers download with correct filename | same file |
| UI-DETAIL-05 | Remove without reason / with valid reason | Blocked vs. succeeds; confirmation step required before either | same file |
| UI-DETAIL-06 | 6th attachment attempted from Detail screen | Blocked client-side, matches API-ATT-03 | same file |
| UI-DETAIL-07 | Removed attachment display | Shows filename/size/dates/reason, no download/preview control rendered | same file |
| UI-DETAIL-08 | Icon-only attachment controls | Accessible label + tooltip present; focus visible | same file |

### E2E (Playwright)

| ID | What it tests | Expected result | File |
|---|---|---|---|
| E2E-01 | Full happy path: select Requester → create ticket → see number → find in My Tickets → open Detail | Each step succeeds with real data | `e2e/lab-02/requester-ticket-flow.spec.ts` |
| E2E-02 | Navigate directly to `/my-tickets` with no Requester selected | Redirected to Requester Selection | same file |
| E2E-03 | Add, download, and soft-remove an attachment from Detail | Each action visibly succeeds; removed one is no longer downloadable | same file |
| E2E-04 | Requester A creates a ticket; switch to Requester B | B's My Tickets does not show A's ticket; direct URL to A's ticket ID 404s for B | same file |
| E2E-05 | Search with no matches | No-results state shown | same file |
| E2E-06 | Kill the backend mid-flow, submit a ticket | Safe error shown, values retained, no crash | same file |
| E2E-07 | Full flow at mobile viewport (375px) | No clipping/overflow at any step | same file |

### Visual (Playwright screenshots)

| ID | Viewport | Screens captured |
|---|---|---|
| VIS-01 | Desktop 1440px | Selector, Create Ticket (initial/error/success), My Tickets, Ticket Detail |
| VIS-02 | Tablet 768px | Same four screens |
| VIS-03 | Mobile 375px | Same four screens |

## 3. Acceptance-Criterion Traceability

| AC | Evidence IDs |
|---|---|
| AC-01 | API-CREATE-01, UI-CREATE-06, E2E-01 |
| AC-02 | UI-CTX-01, E2E-02 |
| AC-03 | API-DETAIL-02, E2E-04 |
| AC-04 | UI-CREATE-02 |
| AC-05 | E2E-07 |
| AC-06 | UI-CREATE-08, API-CREATE-10, E2E-06 |
| AC-07 | API-ATT-03, UI-DETAIL-06 |
| AC-08 | API-ATT-08, E2E-03 |
| AC-09 | API-LIST-01, E2E-04 |
| AC-10 | UI-LIST-03, E2E-05 |
| AC-11 | API-REQ-01, UI-CTX-02 |
| AC-12 | UI-CTX-04, UI-LIST-07 |
| AC-13 | API-ATT-09, UI-DETAIL-05 |
| AC-14 | VIS-01, VIS-02, VIS-03 |
| AC-15 | API-LIST-08, UI-LIST-05 |
| AC-16 | UI-CREATE-07, API-CREATE-08 |
| AC-17 | API-ATT-10, E2E-03 |

## 4. Business-Rule Traceability

| BR | Evidence IDs | BR | Evidence IDs |
|---|---|---|---|
| BR-01 | UNIT-01, API-CREATE-08 | BR-21 | API-CREATE-07 |
| BR-02 | API-CREATE-02 | BR-22 | UI-CREATE-07 |
| BR-03 | API-CREATE-03 | BR-23 | UI-CREATE-02..05, API-CREATE-05..07 |
| BR-04 | UI-CTX-01 | BR-24 | UI-CREATE-08, API-CREATE-10 |
| BR-05 | API-REQ-01, UI-CTX-02 | BR-25 | API-ATT-11 |
| BR-06 | UI-CTX-03 | BR-26 | API-ATT-01 |
| BR-07 | UI-CTX-04 | BR-27 | API-ATT-02 |
| BR-08 | UI-CTX-02 | BR-28 | API-ATT-03 |
| BR-09 | UI-CTX-02 | BR-29 | API-ATT-07 |
| BR-10 | API-CREATE-04 | BR-30 | API-ATT-08 |
| BR-11 | API-DETAIL-02, API-ATT-06 | BR-31 | API-ATT-09, UI-DETAIL-05 |
| BR-12 | API-DETAIL-02, API-DETAIL-03 | BR-32 | API-ATT-04 |
| BR-13 | API-LIST-02 | BR-33 | API-ATT-12, UI-DETAIL-03 |
| BR-14 | API-LIST-03..06 | BR-34 | API-ATT-11 |
| BR-15 | API-LIST-07, API-LIST-08 | BR-35 | API-REQ-01 |
| BR-16 | API-LIST-09 | BR-36 | API-REQ-03 |
| BR-17 | API-LIST-10 | BR-37 | UI-LIST-02, UI-LIST-03 |
| BR-18 | API-LIST-11 | BR-38 | API-DETAIL-02 |
| BR-19 | API-CREATE-05 | BR-39 | UI-CTX-05, UI-DETAIL-08, VIS-01..03 |
| BR-20 | API-CREATE-06 | BR-40 | *Not independently testable in Lab 2* — verified by schema/code review only (see §8) |

Note: former BR-34 ("attachment ownership") was folded into BR-11 during
review, since it was the same ownership check restated for attachments
specifically — `API-ATT-06` (the cross-Requester attachment-ownership
test) already appears above as BR-11's evidence, so no evidence was lost
in the merge.

## 5. Responsive and Visual Checklist

At each of VIS-01/02/03, manually confirm against `ui-spec.md`:
- [ ] Zen Green color tokens applied correctly (header, badges, fields)
- [ ] Editable vs. read-only fields are visually distinct
- [ ] Validation messages appear directly below their field
- [ ] Button hierarchy (primary/secondary/disabled/busy) is visually clear
- [ ] Keyboard focus is visible on every interactive control
- [ ] Every icon-only control has a visible tooltip on hover/focus
- [ ] No clipped labels, overlapping elements, or unintended horizontal scroll
- [ ] My Tickets: desktop table vs. mobile card layout, both fully readable
- [ ] Badges show text plus color, never color alone
- [ ] Selector, Create Ticket, My Tickets, Ticket Detail all checked, all states

Screenshots saved to `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/{desktop,tablet,mobile}.png`.

## 6. Test Commands

To be filled in exactly as implemented, then kept current in the README:
```
# server
cd server && npm test

# client
cd client && npm test

# E2E + visual
npm run test:e2e
```

## 7. Final Results

**Current status: planned only — no tests have been executed yet.**
This table is filled in as each Issue is implemented, not reconstructed
after the fact:

| Date | Commit SHA | Command | Result | Notes |
|---|---|---|---|---|
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

## 8. Known Limitations or Deferred Tests

- BR-40 (schema's forward-compatibility with Lab 3 authentication) is a
  design property, not a runtime behavior — it is checked by code/schema
  review during PR review, not by an automated test, and is noted here
  rather than silently omitted.
- API-CREATE-09 clarifies that Lab 2 does not implement server-side
  request idempotency (e.g. an idempotency key) — duplicate-submission
  prevention is a UI-layer control only (BR-22), which is an accepted
  scope boundary for an MVP sprint, not an oversight.
- Nothing else is deferred: authentication, IT Staff workflow, comments/
  notes/actions, and ticket-lifecycle changes are out of scope per
  `specification.md` §3, not deferred *required* tests.
