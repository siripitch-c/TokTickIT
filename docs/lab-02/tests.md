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
| API-ERR-01 | Unmatched API path and unparseable JSON body | Both answer with the api-spec.md §1 error envelope (`404 NOT_FOUND` / `400 VALIDATION_ERROR`), never Express's HTML page, and leak no internal detail | `server/tests/lab-02/error-envelope.api.test.ts` |

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
| API-CREATE-11 | `X-Requester-Id` naming a Requester that does not exist | `400 VALIDATION_ERROR` and no Ticket — bad input must not reach the foreign key and come back as a `500` | same file |
| API-CREATE-12 | `X-Requester-Id` naming an inactive Requester | `400 VALIDATION_ERROR` and no Ticket; BR-05/BR-35 hold server-side, not only in the selector (BR-11) | same file |
| API-CREATE-13 | Ids beyond the 32-bit `Int` range (`1e21`, `MAX_SAFE_INTEGER`, `2147483648`) in `categoryId`, `relatedSystemId` and the header | Each answered as bad input (`400`), never `500` — `Number.isInteger(1e21)` is true, so an unbounded check hands Prisma a value its `Int` column cannot hold and it raises | same file |

### API — My Tickets (list)

| ID | What it tests | Expected result | File |
|---|---|---|---|
| API-LIST-01 | Requester A has 12 tickets, B has 3 | A's list has exactly 12 items, none of B's | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-LIST-02 | `search` matches ticket number (partial) and summary (partial, case-insensitive) | Correct subset returned for each | same file |
| API-LIST-02b | `search` containing `%`, `_` or `\` | Matched literally, not as LIKE wildcards — otherwise "50%" returns every ticket and "month_end" matches any character in that position, neither of which is BR-13's partial match | same file |
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
| API-ATT-15 | Unusable `:id` in the upload path (`abc`, `-1`, `0`, out-of-range) | `404 TICKET_NOT_FOUND` in every case, never `500` | same file |
| API-ATT-14 | Three uploads race for the last free slot on a ticket that already has 4 active attachments | Exactly one `201`, two `409 ATTACHMENT_LIMIT_REACHED`, final active count 5 — the BR-28 check is serialised, not a read-then-write race | same file |

### UI — Requester context

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-CTX-01 | Selector screen initial render | Shows testing-only notice, dropdown, disabled Continue until a value is chosen | `client/tests/lab-02/RequesterSelection.test.tsx` |
| UI-CTX-02 | Loading/empty/error states | Correct state rendered for each mocked API outcome | same file |
| UI-CTX-03 | Selecting a Requester and navigating away/back | Selection persists (client storage) | same file |
| UI-CTX-04 | Change Requester action | Returns to selector; after new selection, My Tickets/Create Ticket reload with new context, no stale data | same file |
| UI-CTX-05 | Icon-only controls (e.g. Change Requester icon variant) and keyboard focus | Accessible label present; focus outline visible via keyboard nav | same file |
| UI-CTX-06 | Opening `/tickets/new` directly with no Requester selected | The selector is shown, the guarded screen never mounts, and the URL becomes `/select-requester` (AC-02, the unit-level counterpart to E2E-02) | `client/tests/lab-02/App.test.tsx` |
| UI-CTX-07 | Choosing a Requester after being redirected | The originally-requested route is restored rather than the default one | same file |
| UI-CTX-08 | An active-Requester lookup resolves *after* Change Requester was pressed | The stale response is discarded, so the previous Requester's context never reappears (BR-07) | `client/tests/lab-02/useRequesterSession.test.tsx` |
| UI-CTX-10 | The active-Requester lookup fails, then recovers | The selector shows BR-08's error state and refuses entry, the stored selection survives the outage, and pressing Retry resumes that identity instead of asking for it again (BR-06) | `client/tests/lab-02/App.test.tsx` |
| UI-CTX-09 | Mobile navigation toggle, closed and open | Label and tooltip name the action for the current state, `aria-expanded` matches, and the panel carries the same actions as the desktop header (BR-39) | `client/tests/lab-02/App.test.tsx` |

### UI — Create Ticket

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-CREATE-01 | Reference data (categories/related systems) loading/error | Correct loading and safe-error states | `client/tests/lab-02/CreateTicket.test.tsx` |
| UI-CREATE-02..05 | Empty/invalid Summary, Description, Category, Related System, Priority | Field-level message shown, no API call made | same file |
| UI-CREATE-06 | Valid submission | API called with correct payload; success view shows Ticket Number | same file |
| UI-CREATE-07 | Rapid double-click Submit | Button disabled/busy after first click; only one API call fires | same file |
| UI-CREATE-08 | Simulated API failure on submit | Safe error shown; all entered field values remain in the form | same file |
| UI-CREATE-09 | Select 0, 5, and 6 attachments before submit | 0–5 accepted; 6th blocked client-side with a message | same file |
| UI-CREATE-10 | Select a disallowed type / oversized file | Client-side rejects with a clear message before any upload attempt | same file |
| UI-CREATE-11 | "Create Another" after a successful submission | The Ticket Date resets to now rather than keeping the previous ticket's opening time, and the form is empty | same file |
| UI-CREATE-12 | Dismiss a rejected file | The red row can be removed once the mistake is corrected, instead of staying on screen for the life of the form | same file |
| UI-CREATE-13 | A dot-leading filename such as `.png` | Refused client-side, matching the server: Node's `path.extname(".png")` is `""`, so accepting it would mean a 415 after the ticket was already created | same file |

### UI — My Tickets

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-LIST-01 | Loading/API-error states | Correct state shown | `client/tests/lab-02/MyTickets.test.tsx` |
| UI-LIST-02 | Zero owned tickets | Empty state with Create Ticket CTA | same file |
| UI-LIST-03 | Search/filter producing zero matches on a non-empty list | Distinct no-results state (not the empty state from UI-LIST-02) | same file |
| UI-LIST-04 | Search, each filter, and Clear Filters | List updates correctly; Clear Filters resets to unfiltered | same file |
| UI-LIST-05 | Sort header click, page navigation, page-size change | List reorders/pages correctly without full reload | same file |
| UI-LIST-05b | `aria-sort` on the column headers | Only the sorted column reports a direction; the rest report `none`, so what a screen reader hears matches the arrow that is drawn (BR-39) | same file |
| UI-LIST-06 | Desktop table vs. mobile card rendering | Correct layout per viewport, no clipped columns. The two are alternatives, not one hidden by CSS: only one is in the DOM, so assistive technology never walks two copies of every ticket. Tests drive it by replacing `window.matchMedia` | same file |
| UI-LIST-07 | Requester switch while on My Tickets | List reloads to the new Requester's tickets only | same file |

### UI — Ticket Detail & Attachments

| ID | What it tests | Expected result | File |
|---|---|---|---|
| UI-DETAIL-01 | Owned ticket load | Read-only fields render correctly, including local-format Ticket Date | `client/tests/lab-02/RequesterTicketDetail.test.tsx` |
| UI-DETAIL-02 | Not-found/foreign ticket | Safe not-found state, no data flash | same file |
| UI-DETAIL-03 | Add attachment: busy/success/error states | Correct state transitions per BR-33 | `client/tests/lab-02/AttachmentSection.test.tsx` |
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
| E2E-06 | Take the API away mid-flow, then submit a ticket | Safe error shown, values retained, no crash | same file |

E2E-06 removes the API by failing the `POST /api/tickets` request at the
browser rather than by stopping the server process: the failure then lands
at exactly the moment being tested, after reference data has loaded, and
the run does not depend on restarting a process it did not start. What the
screen sees — a request that never answers — is the same either way.

| E2E-07 | Full flow at mobile viewport (375px) | No clipping/overflow at any step | same file |

### Visual (Playwright screenshots)

| ID | Viewport | Screens captured |
|---|---|---|
| VIS-01 | Desktop 1440px | Selector; Create Ticket initial / validation-failure / rejected-attachment / submitting / success; Ticket Detail with an attachment, its remove-confirm modal, and the panel at the 5-attachment limit; My Tickets populated and no-results |
| VIS-02 | Tablet 768px | Same screens and states |
| VIS-03 | Mobile 375px | Same screens and states |

All three are produced by `e2e/lab-02/visual.spec.ts` and are evidence for
§5: whether a screen *looks* right is a question for a reader, not a runner.
One half of AC-14 is an exception — "no unintended horizontal scrolling
occurs at any of the three viewport sizes" is measurable, so each capture
asserts it from the document before saving the image (33 checks per run).
A layout that overflows now fails the run instead of waiting to be noticed in
a picture. The clipping half of AC-14 stays a reading task.

## 3. Acceptance-Criterion Traceability

| AC | Evidence IDs |
|---|---|
| AC-01 | API-CREATE-01, UI-CREATE-06, E2E-01 |
| AC-02 | UI-CTX-01, UI-CTX-06, UI-CTX-07, E2E-02 |
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
| BR-04 | UI-CTX-01, UI-CTX-06 | BR-24 | UI-CREATE-08, API-CREATE-10 |
| BR-05 | API-REQ-01, UI-CTX-02, API-CREATE-12 | BR-25 | API-ATT-11 |
| BR-06 | UI-CTX-03, UI-CTX-10 | BR-26 | API-ATT-01, UI-CREATE-13 |
| BR-07 | UI-CTX-04, UI-CTX-08, UI-LIST-07 | BR-27 | API-ATT-02 |
| BR-08 | UI-CTX-02, UI-CTX-10 | BR-28 | API-ATT-03, API-ATT-14 |
| BR-09 | UI-CTX-02 | BR-29 | API-ATT-07, API-DETAIL-01, UI-DETAIL-07 |
| BR-10 | API-CREATE-04 | BR-30 | API-ATT-08, UI-DETAIL-07 |
| BR-11 | API-DETAIL-02, API-ATT-06, API-CREATE-12, API-LIST-01 | BR-31 | API-ATT-09, UI-DETAIL-05 |
| BR-12 | API-DETAIL-02, API-DETAIL-03, UI-DETAIL-02 | BR-32 | API-ATT-04, API-DETAIL-01 |
| BR-13 | API-LIST-02, API-LIST-02b | BR-33 | API-ATT-12, UI-DETAIL-03 |
| BR-14 | API-LIST-03..06 | BR-34 | API-ATT-11 |
| BR-15 | API-LIST-07, API-LIST-08 | BR-35 | API-REQ-01, API-CREATE-12 |
| BR-16 | API-LIST-09 | BR-36 | API-REQ-03 |
| BR-17 | API-LIST-10 | BR-37 | UI-LIST-02, UI-LIST-03 |
| BR-18 | API-LIST-11 | BR-38 | API-DETAIL-02 |
| BR-19 | API-CREATE-05 | BR-39 | UI-CTX-05, UI-CTX-09, UI-LIST-05b, UI-DETAIL-08, VIS-01..03 |
| BR-20 | API-CREATE-06 | BR-40 | *Not independently testable in Lab 2* — verified by schema/code review only (see §8) |

Note: former BR-34 ("attachment ownership") was folded into BR-11 during
review, since it was the same ownership check restated for attachments
specifically — `API-ATT-06` (the cross-Requester attachment-ownership
test) already appears above as BR-11's evidence, so no evidence was lost
in the merge.

## 5. Responsive and Visual Checklist

At each of VIS-01/02/03, manually confirm against `ui-spec.md`:
- [x] Zen Green color tokens applied correctly (header, badges, fields)
- [x] Editable vs. read-only fields are visually distinct
- [x] Validation messages appear directly below their field
- [x] Button hierarchy (primary/secondary/disabled/busy) is visually clear
- [x] Keyboard focus is visible on every interactive control
- [x] Every icon-only control has a visible tooltip on hover/focus
- [x] No clipped labels, overlapping elements, or unintended horizontal scroll
- [x] My Tickets: desktop table vs. mobile card layout, both fully readable
- [x] Badges show text plus color, never color alone
- [x] Selector, Create Ticket, My Tickets, Ticket Detail all checked, all states

Checked on 2026-09-05 against the 33 captures listed below. Items 5 and 6
cannot be read off a still image and were confirmed live in Chrome: tabbing
through My Tickets shows the 2px outline on every control (white on the green
header, per §9), and hovering the icon-only remove control shows
"Remove <filename>". Item 7 caught a real defect at 768px — the table
overflowed its wrapper by 24px and cut off the "Last Updated" header — fixed
by tightening the tablet cell padding, and now asserted automatically on every
capture so it cannot come back unnoticed.

Screenshots are saved to
`artifacts/lab-02/screenshots/<screen>/<viewport>[-<state>].png`, where
`<screen>` is one of `select-requester`, `create-ticket`, `ticket-detail`,
`my-tickets` and `<viewport>` is `desktop`, `tablet` or `mobile` — four
screens, matching VIS-01 above. (An earlier draft of this line named only
three folders and omitted the Requester Selection screen the VIS rows
require.) The states carry a suffix: `create-ticket/desktop-validation.png`,
`create-ticket/desktop-attachment-rejected.png`,
`create-ticket/desktop-busy.png`, `create-ticket/desktop-success.png`,
`ticket-detail/desktop-remove-modal.png`,
`ticket-detail/desktop-attachment-limit.png` and
`my-tickets/desktop-no-results.png` — 11 images per viewport, 33 in total.

The two attachment-refusal states are captured because §5 asks for every
state of each screen and `ui-spec.md` §5.4/§7.1 count them as states: what
BR-26/BR-27/BR-28 *do* is covered by UI-CREATE-09/10 and UI-DETAIL-06, but
whether the refusal is legible is a visual question those cannot answer.

## 6. Test Commands

```
# server (unit + API; needs the migrated + seeded local database)
cd server && npm test

# client (UI component tests)
cd client && npm test

# E2E + visual (Issue #17). Run from the repository root, with the client
# and the API both running; Playwright reuses whatever is already listening
# on 5173/3000 and starts them itself only if nothing is. E2E-01..07 each
# create the data they need; VIS-01..03 additionally require the demo tickets
# (README), because My Tickets hides its search and filter controls on an
# empty list (ui-spec.md 6.4) and the captures drive those controls.
npm run test:e2e            # E2E-01..07 and VIS-01..03, writing the screenshots
npm run test:e2e:report     # opens the HTML report from the last run

# The suite creates real tickets, each marked [e2e] in its description, and
# deletes them again in its global teardown. To remove them by hand after an
# interrupted run:
npm run e2e:cleanup --prefix server
```

## 7. Final Results

**Current status: Issues #12, #13, #14, #15 and #17 implemented; every test
planned in §2 has been executed.**
This table is filled in as each Issue is implemented, not reconstructed
after the fact:

| Date | Commit SHA | Command | Result | Notes |
|---|---|---|---|---|
| 2026-09-03 | `a009afa` | `cd server && npm test` | 31 passed / 31 | UNIT-01, API-REQ-01..03, API-REF-01, API-CREATE-01..10, API-ATT-01..05, API-ATT-06 (upload), API-ATT-12, plus the Lab 1 tests. Verified stable across five consecutive runs |
| 2026-09-03 | `a009afa` | `cd client && npm test` | 22 passed / 22 | UI-CTX-01..05, UI-CREATE-01..10 |
| 2026-09-03 | `623e8a4` | `cd server && npm test` | 34 passed / 34 | adds API-ERR-01 after the ui-spec §9 / api-spec §1 conformance fixes |
| 2026-09-03 | `623e8a4` | `cd client && npm test` | 22 passed / 22 | unchanged by those fixes; re-run to confirm |
| 2026-09-03 | `3c354b8` | `cd server && npm test` | 34 passed / 34 | before the BR-28 concurrency fix |
| 2026-09-03 | Issue #13 head | `cd server && npm test` | 39 passed / 39 | adds API-ATT-14/15 and API-CREATE-11..13 |
| 2026-09-03 | Issue #13 head | `cd client && npm test` | 30 passed / 30 | adds UI-CREATE-11..13 and UI-CTX-06..09 from the final code read-through |
| 2026-09-04 | Issue #14 | `cd server && npm test` | 50 passed / 50 | adds API-LIST-01..11 and the wildcard-escaping case |
| 2026-09-04 | Issue #14 | `cd client && npm test` | 40 passed / 40 | adds UI-LIST-01..07, the aria-sort case and UI-CTX-10 |
| 2026-09-04 | Issue #15 | `cd server && npm test` | 64 passed / 64 | adds API-DETAIL-01..04 and API-ATT-07..11/13 |
| 2026-09-04 | Issue #15 | `cd client && npm test` | 53 passed / 53 | adds UI-DETAIL-01..08 |
| 2026-09-04 | `67620f6` | `cd server && npm test` | 65 passed / 65 | adds the missing-file download case from the Issue #15 audit |
| 2026-09-05 | Issue #17 | `cd server && npm test` | 65 passed / 65 | unchanged by Issue #17; re-run to confirm |
| 2026-09-05 | Issue #17 | `cd client && npm test` | 53 passed / 53 | still passing after the My Tickets card became a link (see §8) |
| 2026-09-05 | Issue #17 | `npm run test:e2e` | 10 passed / 10 | E2E-01..07 and VIS-01..03; 33 screenshots written to `artifacts/lab-02/screenshots/` |
| 2026-09-05 | Issue #17 | `npx playwright test --headed` | 10 passed / 10 | reproduced on the author's own shell with a visible browser, after `npx playwright install chromium` |
| 2026-09-05 | Issue #17 | `npm run test:e2e` | 10 passed / 10 | final run: adds the clipped-column assertion and the 768px table fix it found; 33 screenshots |
| 2026-09-05 | Issue #17 | `cd client && npm test` | 53 passed / 53 | re-run after the tablet cell-padding change |
| 2026-09-05 | Issue #17 | `cd server && npm test` | 65 passed / 65 | re-run to confirm nothing server-side moved |
| 2026-09-03 | `3c354b8` | `cd client && npm test` | 22 passed / 22 | Issue #13 head — after the manual-inspection fixes (link buttons, selector icon, drop-zone hint, header spacing, busy-button fill) |

My Tickets was also walked through by hand in a browser against the seeded
database before the Pull Request: the desktop table and its sort indicators,
paging to the last page, sorting by ticket number, a search matching nothing
(no-results, controls still present), a Requester who owns nothing (empty,
controls hidden), and the 375px card layout with no horizontal overflow.

Manual verification alongside the automated suites, since several ui-spec
states are not observable from a component test: the real browser upload path
(multipart, CORS preflight, on-disk filename), the 5-attachment limit, the
API-failure state with values retained, the busy button, the character
counters, the 768/375 layouts, keyboard focus, and Requester switching. Five
defects were found this way and fixed — see §8.

Nothing planned in §2 is now unexecuted. E2E-01..07 and VIS-01..03 were the
last outstanding group; they run against the real client, the real API and the
real database, and their first full run found one defect that four issues of
component and API tests had not (§8).

The end-to-end run creates real tickets, marked `[e2e]` in their descriptions,
and deletes them again in its teardown — the run above left the database
exactly as it found it.

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
- Endpoint behaviour under inputs the UI would never send was checked by
  driving every write endpoint with malformed ids, out-of-range numbers, a
  non-object body, a missing file part, an unmatched path and an unparseable
  body. All fourteen now answer with a 4xx envelope; none reach a `500`. The
  cases that mattered are kept as API-CREATE-11..13 and API-ATT-15.
- The busy-button state (BR-22) is asserted by UI-CREATE-07 through the DOM
  (`aria-busy`, `disabled`, a single POST) but its *appearance* is not
  covered by any automated test, and a real localhost request resolves in
  milliseconds — Chrome's network throttling does not apply to loopback. The
  fill defect found on 2026-09-03 was only visible by delaying `window.fetch`
  by hand. **Closed by Issue #17:** VIS-01..03 now hold the `POST /api/tickets`
  route open for 2.5s and photograph the button mid-submission, so the state is
  evidence at all three widths rather than something someone has to catch
  live — `create-ticket/<viewport>-busy.png`.
