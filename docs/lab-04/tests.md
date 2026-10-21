# Lab 4 Test Plan and Results

Written **before** implementation, alongside `specification.md`, `api-spec.md`
and `ui-spec.md`. The Status column starts at *Planned* for every row and is
updated as each test is written and passes; it is not a report reconstructed
afterwards from whatever the coding agent produced.

## 1. Test Strategy

- **Unit tests** cover pure logic with no I/O: the Action status matrix, the
  resolution gate's predicate, the Asia/Bangkok day boundary used by the weekly
  metric, and the follow-up and date validators.
- **API/integration tests** run against an isolated test PostgreSQL database,
  exercising real Prisma queries and real cookies. Nothing is mocked, and
  authentication is performed by logging in and reusing the cookie — a test
  that forged a session would prove nothing about the gate it tests.
- **UI component tests** run with the client test runner; only the fetch layer
  is mocked. Components, validation, routing guards and state logic are real.
- **Migration and regression tests** apply the Lab 4 migration to a database
  holding Lab 3 data, assert nothing was lost, exercise the documented
  rollback, and re-assert the Lab 2 and Lab 3 contracts.
- **Performance smoke tests** assert the dashboards answer inside the BR-33
  budget on seeded data. They exist to catch an N+1 query or a missing index,
  not to benchmark the machine, so the budget is generous and the assertion is
  on the server's own measurement.
- **E2E tests** run with Playwright against the full stack and prove
  cross-screen flows, including that a role cannot reach what it should not.
- **Visual/responsive tests** are Playwright screenshots at three viewports,
  checked against `ui-spec.md` by the checklist in §5.
- **Authorization is tested at the API, never through the interface.** For
  Actions Taken and for each dashboard there is a test asserting the refusal
  for an unauthenticated caller and for an authenticated caller in the wrong
  role. Hiding a control is not evidence.
- No required test may be skipped, disabled or commented out in the final
  `main` branch (`specification.md` §10).
- Every test's title carries its ID from this document, so §3 and §4 stay
  reviewable against the code rather than only against this file.

### ID scheme

Area-prefixed, continuing the Lab 2 and Lab 3 convention.

| Prefix | Meaning |
|---|---|
| `UNIT-xx` | Pure logic, no database |
| `API-ACTION-xx` | Actions Taken endpoints |
| `API-FLOW-xx` | Ticket workflow, resolution gate, stale writes |
| `API-DASHS-xx` | Staff dashboard endpoint |
| `API-DASHR-xx` | Requester dashboard endpoint |
| `MIG-xx` | Migration, backfill, rollback and Lab 1–3 regression |
| `PERF-xx` | Performance smoke |
| `UI-ACTION-xx`, `UI-DASHS-xx`, `UI-DASHR-xx`, `UI-FLOW-xx` | Client components |
| `A11Y-xx` | Accessibility assertions |
| `E2E-xx`, `VIS-xx` | Playwright flows and screenshots |

The handout's §10 example table uses flat ids; its two examples map onto this
scheme as `API-ACTION-01` (create a valid Action under the correct Ticket and
actor) and `E2E-02` (the resolution flow).

## 2. Planned Tests

### 2.1 Unit — `server/tests/lab-04/action-rules.unit.test.ts`

Asserts `src/actionRules.ts`, the pure-rule module the Actions endpoints consult.

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| UNIT-01 | Unit | BR-05 | The Action status matrix | Planned→In Progress/Completed/Cancelled and In Progress→Completed/Cancelled allowed; every move out of Completed or Cancelled refused | `action-rules.unit.test.ts` | **Pass** |
| UNIT-02 | Unit | BR-06 | Completion requires a result | A completion with an empty or whitespace result is rejected | same | **Pass** |
| UNIT-03 | Unit | BR-07 | Follow-up dependency | Follow-up yes with a note under 5 characters rejected; follow-up no discards any note | same | **Pass** |
| UNIT-04 | Unit | BR-09 | Action date bounds | A future `actionAt`, and one before the Ticket's creation, are both rejected | same | **Pass** |
| UNIT-05 | Unit | BR-18 | Resolution predicate | A ticket with any Planned or In Progress Action blocks resolution; zero Actions, or all final, allows it | same | **Pass** |
| UNIT-06 | Unit | BR-25 | Asia/Bangkok day boundary | "Last 7 days" starts at 00:00 Bangkok seven days ago, independent of the server's timezone | `dashboard-metrics.unit.test.ts` | **Pass** |

### 2.2 API — Actions Taken — `server/tests/lab-04/actions-taken.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-ACTION-01 | API | AC-01 | Create a valid Action as IT Staff | 201; stored under that Ticket with the caller as performer, and no refusal body anywhere in this file leaks a stack trace, SQL or an email address | `actions-taken.api.test.ts` | **Pass** |
| API-ACTION-02 | API | AC-02, BR-03 | `performedById` supplied in the body | Ignored; the performer is the session user | same | **Pass** |
| API-ACTION-03 | API | BR-10 | Field validation | Description under 5 or over 2000 characters answers 400 with `field: "description"` | same | **Pass** |
| API-ACTION-04 | API | AC-03, BR-07 | Follow-up without a note | 400 with `field: "followUpNote"` | same | **Pass** |
| API-ACTION-05 | API | BR-07 | Follow-up set back to no | A note previously stored is cleared to null | same | **Pass** |
| API-ACTION-06 | API | AC-04, BR-04 | Assign to an inactive account | 400 `INVALID_ASSIGNEE`; the Action keeps its previous assignee | same | **Pass** |
| API-ACTION-07 | API | BR-04 | Assign to a Requester account | 400 `INVALID_ASSIGNEE` | same | **Pass** |
| API-ACTION-08 | API | BR-04 | Assignee deactivated after assignment | The Action keeps the assignee and stays readable | same | **Pass** |
| API-ACTION-09 | API | BR-09 | Future `actionAt`, and one before the Ticket | 400 each, with `field: "actionAt"` | same | **Pass** |
| API-ACTION-10 | API | AC-05, BR-05 | Complete an Action with a result | 200; status Completed, version incremented | same | **Pass** |
| API-ACTION-11 | API | BR-06 | Complete with no result | 400 with `field: "result"` | same | **Pass** |
| API-ACTION-12 | API | AC-06 | Update a Completed or Cancelled Action | 409 `ACTION_FINAL`, nothing changes | same | **Pass** |
| API-ACTION-13 | API | BR-05 | A transition the matrix forbids | 409 `INVALID_ACTION_TRANSITION` | same | **Pass** |
| API-ACTION-14 | API | AC-07, BR-14 | Requester create, update, complete, cancel | 403 for each, with no row written | same | **Pass** |
| API-ACTION-15 | API | AC-08, BR-15 | Requester lists Actions of another user's Ticket | 404, and the body reveals nothing about the Ticket | same | **Pass** |
| API-ACTION-16 | API | FR-06 | Requester lists Actions of their own Ticket | 200 with every Action present | same | **Pass** |
| API-ACTION-17 | API | BR-11 | Ordering | Two Actions with the same `actionAt` return in id order, stable across repeated reads | same | **Pass** |
| API-ACTION-18 | API | BR-14 | Unauthenticated calls to all three endpoints | 401 each | same | **Pass** |
| API-ACTION-19 | API | BR-13 | No delete route exists | `DELETE /api/actions/:id` answers 404 or 405, never removes a row | same | **Pass** |
| API-ACTION-20 | API | BR-12 | Creating or updating an Action | The Ticket's status is unchanged by the write | same | **Pass** |
| API-ACTION-21 | API | BR-26, AC-13 | Stale update of an Action | 409 `STALE_UPDATE`; the first write survives | same | **Pass** |
| API-ACTION-22 | API | BR-28, AC-14 | Update with no version field | 400 `VERSION_REQUIRED` | same | **Pass** |

### 2.3 API — Ticket workflow — `server/tests/lab-04/ticket-workflow.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-FLOW-01 | API | AC-09, BR-18, FR-08 | Resolve with one Planned Action | 409 `OPEN_ACTIONS_REMAIN`, message names the count, status unchanged, and the Ticket read reports the same `openActionCount` | `ticket-workflow.api.test.ts` | **Pass** |
| API-FLOW-02 | API | AC-09 | Resolve with one In Progress Action | 409, as above | same | **Pass** |
| API-FLOW-03 | API | AC-10 | Resolve after every Action is final | 200; status Resolved | same | **Pass** |
| API-FLOW-04 | API | AC-27, BR-18 | Resolve a legacy Ticket with no Actions | 200; the gate passes trivially | same | **Pass** |
| API-FLOW-05 | API | AC-11, BR-19 | Cancel a Ticket holding open Actions | 200; the Actions are untouched | same | **Pass** |
| API-FLOW-06 | API | AC-12, BR-16 | Every transition the matrix forbids | 409 `INVALID_STATUS_TRANSITION` for each pair tested, status unchanged | same | **Pass** |
| API-FLOW-07 | API | BR-16 | Every transition the matrix permits | 200 for each pair tested | same | **Pass** |
| API-FLOW-08 | API | BR-17 | Requester attempts a status change | 403 | same | **Pass** |
| API-FLOW-09 | API | AC-13, BR-26 | Two writers, second holds the old version | Second answers 409 `STALE_UPDATE`; the first write is intact | same | **Pass** |
| API-FLOW-10 | API | AC-14, BR-28 | Status write with no version | 400 `VERSION_REQUIRED` | same | **Pass** |
| API-FLOW-11 | API | BR-26 | Version increments | Owner, IT priority and status writes each raise the version by exactly one | same | **Pass** |
| API-FLOW-12 | API | BR-20, AC-20 | Requester resolution signal | Recorded once with its time; status unchanged; a second attempt refused | same | **Pass** |
| API-FLOW-14 | API | BR-30 | Unexpected failure path | 500 with a generic message and no internal detail | same | **Pass** |

### 2.4 API — Staff dashboard — `server/tests/lab-04/staff-dashboard.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-DASHS-01 | API | AC-15, BR-21, BR-23 | Every metric present, nothing more | All nine keys returned as integers; the body carries counts and short lists only, with no full Ticket collection and no email address | `staff-dashboard.api.test.ts` | **Pass** |
| API-DASHS-02 | API | AC-15, BR-24 | Counts match direct queries | Each count equals the same query run through Prisma in the test | same | **Pass** |
| API-DASHS-03 | API | BR-21, BR-22 | "Open" excludes terminal statuses | Resolved, Closed and Cancelled Tickets are absent from every metric on either dashboard that claims to count open work | same | **Pass** |
| API-DASHS-04 | API | AC-16, FR-13 | My open actions | Counts only Planned and In Progress Actions assigned to the caller | same | **Pass** |
| API-DASHS-05 | API | BR-21 | By-status map | Contains all eight statuses, including zeros | same | **Pass** |
| API-DASHS-06 | API | BR-25 | Resolved in the last 7 days | A Ticket resolved 6 days ago counts; one resolved 8 days ago does not; boundary evaluated in Asia/Bangkok | same | **Pass** |
| API-DASHS-07 | API | FR-14 | Recently updated and needs attention | At most 10 rows each, correct ordering, only open Tickets | same | **Pass** |
| API-DASHS-08 | API | AC-18, FR-16 | Administrator counts | Present for an Administrator, absent for IT Staff | same | **Pass** |
| API-DASHS-09 | API | AC-22 | Requester calls the staff dashboard | 403 | same | **Pass** |
| API-DASHS-10 | API | BR-14 | Unauthenticated call | 401 | same | **Pass** |
| API-DASHS-11 | API | AC-17, FR-15, Lab 3 BR-40 | The drill-down queries | Each card's documented query returns a total equal to the card, and the three new queue parameters stay lenient | same | **Pass** |

### 2.5 API — Requester dashboard — `server/tests/lab-04/requester-dashboard.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-DASHR-01 | API | AC-19, BR-22 | Own data only | Every count and row belongs to the caller; another Requester's Ticket appears nowhere | `requester-dashboard.api.test.ts` | **Pass** |
| API-DASHR-02 | API | AC-20, FR-20 | `requesterId` in the query string | Ignored; the caller's own data is returned | same | **Pass** |
| API-DASHR-03 | API | BR-22 | Metric definitions, limits and ordering | The three counts match direct queries, and the two short lists hold at most five rows, most recent first | same | **Pass** |
| API-DASHR-04 | API | FR-18 | Attention lists | Waiting-for-me and resolved rows carry the reason they are listed | same | **Pass** |
| API-DASHR-05 | API | BR-22, FR-18 | The attention panel's own limit | With more than ten Tickets waiting or resolved, the panel holds the ten most recent and stops there | same | **Pass** |
| API-DASHR-06 | API | AC-21 | Requester with no Tickets | Zeros and empty arrays, 200, no error | same | **Pass** |
| API-DASHR-07 | API | AC-22 | IT Staff or Administrator calls it | 403 | same | **Pass** |
| API-DASHR-08 | API | BR-14 | Unauthenticated call | 401 | same | **Pass** |
| API-DASHR-09 | API | AC-17, FR-19, Lab 2 BR-18 | The drill-down queries | Each card's documented query returns a total equal to the card, the rows stay the caller's own, and junk falls back | same | **Pass** |

### 2.6 Migration, rollback and Lab 1–3 regression — `server/tests/lab-04/migration.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| MIG-01 | Migration | §7 | Apply Lab 4 to a Lab 3 database | Every User, Ticket, Attachment, Comment and Note row survives with its id | `migration.api.test.ts` | **Pass** |
| MIG-02 | Migration | §7 | `Ticket.version` backfill | Every pre-existing Ticket is at version 1 | same | **Pass** |
| MIG-03 | Migration | AC-27 | Legacy Tickets without Actions | Readable, resolvable, and counted by the dashboards as zero contributions | same | **Pass** |
| MIG-04 | Migration | §7 | Documented rollback | Dropping the table, enum and column restores the Lab 3 schema with Lab 3 data intact | same | **Pass** |
| MIG-05 | Migration | BR-32 | Seed idempotency | Running the seed against an already-seeded database changes no row and no password hash | same | **Pass** |
| MIG-06 | Migration | §7 | Seed coverage | Tickets exist with zero, one and several Actions; at least one Action in each status; one Ticket resolved inside the weekly window | same | **Pass** |
| MIG-07 | Regression | AC-28, BR-32 | Lab 2 contract | Ticket creation, My Tickets queries, attachment rules and the 404-on-foreign-resource rule behave as `docs/lab-02/api-spec.md` describes | same | **Pass** |
| MIG-08 | Regression | AC-28, BR-32 | Lab 3 contract | Login, the password-change gate, the queue, ownership, comments, notes and user management behave as `docs/lab-03/api-spec.md` describes | same | **Pass** |
| MIG-09 | Regression | AC-28, BR-32 | The earlier suites themselves | Every Lab 1, Lab 2 and Lab 3 server, client and Playwright suite passes on the Lab 4 branch. Twenty cases were updated deliberately rather than left to fail — nineteen for FR-25 and one for a class name Issue #51 removed — each reasoned in §7 | all existing suites | **Pass** |

### 2.7 Performance smoke — `server/tests/lab-04/performance.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| PERF-01 | Perf | AC-26, BR-33 | Staff dashboard latency | Responds in under 500 ms on seeded data, measured server-side over 5 runs | `performance.api.test.ts` | **Pass** |
| PERF-02 | Perf | AC-26, BR-33 | Requester dashboard latency | Same budget | same | **Pass** |

### 2.8 UI components — `client/tests/lab-04/`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| UI-ACTION-01 | UI | FR-01 | Actions table renders | Six columns, rows in the order the API returned | `ActionsTaken.test.tsx` | **Pass** |
| UI-ACTION-02 | UI | BR-05 | Status badges | All four render with text, not colour alone | same | **Pass** |
| UI-ACTION-03 | UI | FR-05, BR-07 | Follow-up reveal | Choosing Yes reveals the note field and marks it required; No hides and clears it | same | **Pass** |
| UI-ACTION-04 | UI | BR-10 | Counters and limits | Description counter updates; submit disabled over the limit | same | **Pass** |
| UI-ACTION-05 | UI | BR-06 | Complete without a result | Focuses Result and shows its message; no request is sent | same | **Pass** |
| UI-ACTION-06 | UI | BR-31 | Double submit | The save control disables for the duration; only one request leaves the client | same | **Pass** |
| UI-ACTION-07 | UI | FR-06, AC-07 | Requester view | No Add Action button and no row controls are rendered | same | **Pass** |
| UI-ACTION-08 | UI | BR-04 | Assignee select | Lists active staff only, defaults to the signed-in user | same | **Pass** |
| UI-ACTION-09 | UI | §2.3 | Stale write feedback | A 409 renders the conflict block with Reload, and the typed text survives | same | **Pass** |
| UI-ACTION-10 | UI | FR-04 | Cancel dialog | Confirmation required; cancelling leaves the row with the Cancelled badge | same | **Pass** |
| UI-ACTION-11 | UI | FR-24 | Safe failure | A failed save keeps every entered value | same | **Pass** |
| UI-ACTION-12 | UI | FR-26 | Panels are not duplicated | After any update to Ticket Detail, Attachments, Public Comments and Actions Taken each render exactly once, and React logs no duplicate-key warning | same | **Pass** |
| UI-DASHS-01 | UI | FR-12, FR-14 | Metric grid and lists | Six cards, the by-status strip and both Ticket lists render from the API payload, and a list row opens its Ticket | `StaffDashboard.test.tsx` | **Pass** |
| UI-DASHS-02 | UI | BR-21 | Zero metric | Renders `0` with its sub-line, still focusable and still a link | same | **Pass** |
| UI-DASHS-03 | UI | AC-17, FR-15 | Drill-down links | Each card's href carries the documented query | same | **Pass** |
| UI-DASHS-04 | UI | AC-18 | Administrator block | Rendered for an Administrator, absent for IT Staff | same | **Pass** |
| UI-DASHS-05 | UI | ui-spec §4.4 | Loading, failure and refusal | Skeleton while loading; one error block with Retry on failure; the forbidden state with the way back | same | **Pass** |
| UI-DASHR-01 | UI | FR-17 | Three metric cards | Render from the payload with correct labels | `RequesterDashboard.test.tsx` | **Pass** |
| UI-DASHR-02 | UI | FR-18 | Attention panel | Combines waiting-for-me and resolved rows, each with its reason | same | **Pass** |
| UI-DASHR-03 | UI | AC-21 | Empty dashboard | Three zeros, the empty line, and a Create Ticket call to action | same | **Pass** |
| UI-DASHR-04 | UI | FR-19 | Drill-down links | Each card links into My Tickets with the matching filter | same | **Pass** |
| UI-DASHR-05 | UI | ui-spec §5.2, AC-22, AC-23 | Loading, failure and refusal | The header renders before the data; a failure is one error block with Retry; a 403 is the forbidden state and no numbers | `RequesterDashboard.test.tsx` | **Pass** |
| UI-STYLE-01 | UI | FR-26 | Class names have rules | Every `zg-` class the components render is matched by a rule in `zen-green.css` | `StyleConformance.test.tsx` | **Pass** |
| UI-STYLE-02 | UI | FR-26 | The guard reads both sides | The stylesheet and the source are both found, so UI-STYLE-01 cannot pass by collecting nothing | same | **Pass** |
| UI-LINK-01 | UI | FR-26 | Links lead somewhere | Every `to=` target the interface renders resolves to a route `App.tsx` defines; a link to a removed screen fails the build | same | **Pass** |
| UI-DUP-01 | UI | FR-23, BR-31, AC-24 | Double-clicked comment | The control disables in flight and exactly one POST reaches `/comments`; the composer is usable and empty afterwards | `DuplicateSubmit.test.tsx` | **Pass** |
| UI-DUP-02 | UI | FR-23, BR-31, AC-24 | Double-clicked internal note | The same for `/notes` | same | **Pass** |
| UI-LIST-09 | UI | FR-19, AC-17 | A status carried in the address | My Tickets applies it, shows it in the Current Status control and sends it to the API; a status the address invents is ignored | `lab-02/MyTickets.test.tsx` | **Pass** |
| UI-FLOW-01 | UI | FR-08 | Status options | Only permitted transitions are offered for the current status | `TicketWorkflow.test.tsx` | **Pass** |
| UI-FLOW-02 | UI | AC-09 | Resolve blocked | With open Actions the option is disabled and explains why; a server 409 renders the conflict text | same | **Pass** |
| UI-FLOW-03 | UI | BR-16 | Terminal confirmations | Closed and Cancelled confirm before saving | same | **Pass** |
| UI-FLOW-04 | UI | BR-27 | Stale status write | The conflict block offers Reload and the select returns to the current status | same | **Pass** |
| UI-FLOW-05 | UI | FR-25 | Navigation | Dashboard is the first item and the landing route for all three roles | `AppShell.test.tsx` (lab-04) | **Pass** |

### 2.9 Accessibility — `client/tests/lab-04/accessibility.test.tsx`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| A11Y-01 | UI | ui-spec §11 | Metric card name | Announces label, value and destination | `accessibility.test.tsx` | Planned |
| A11Y-02 | UI | ui-spec §11 | By-status strip | Rendered as a list of links | same | Planned |
| A11Y-03 | UI | ui-spec §11 | Actions heading and list | `Actions Taken` is a heading; the Actions are an ordered list | same | Planned |
| A11Y-04 | UI | ui-spec §11 | Follow-up requirement | `aria-required` becomes true when Yes is chosen, and the field is described by its group | same | Planned |
| A11Y-05 | UI | ui-spec §11 | Disabled Resolve | Carries `aria-describedby` naming the open-action reason | same | Planned |
| A11Y-06 | UI | ui-spec §11 | Stale alert | `role="alert"` and focus moves to Reload | same | Planned |
| A11Y-07 | UI | ui-spec §11 | Colour independence | Every action status renders its label text | same | Planned |
| A11Y-08 | UI | ui-spec §11 | Cancel dialog focus | Focus trapped while open and returned to the trigger on close | same | Planned |

### 2.10 E2E — `e2e/lab-04/`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| E2E-01 | E2E | AC-01, FR-01 | Staff records an Action end to end | The Action appears in the log with the signed-in user as performer | `actions-taken-flow.spec.ts` | Planned |
| E2E-02 | E2E | AC-09, AC-10 | Resolution gate in the browser | Resolve is refused while an Action is open, then succeeds once it is completed | `ticket-resolution.spec.ts` | Planned |
| E2E-03 | E2E | AC-05 | Complete and cancel | One Action completed, another cancelled, both badges correct after reload | `actions-taken-flow.spec.ts` | Planned |
| E2E-04 | E2E | AC-07 | Requester sees a read-only log | Actions visible, no write control anywhere on the screen | same | Planned |
| E2E-05 | E2E | BR-02 | Two staff on one Ticket | Actions by different performers appear on the same Ticket with the owner unchanged | same | Planned |
| E2E-06 | E2E | AC-15, AC-17 | Staff dashboard drill-down | A card's number equals the queue total it opens | `dashboards.spec.ts` | Planned |
| E2E-07 | E2E | AC-19, AC-21 | Requester dashboard | Shows only own Tickets; an empty account shows zeros and the create invitation | same | Planned |
| E2E-08 | E2E | AC-22 | Dashboard authorization | A Requester cannot reach the staff dashboard and vice versa | same | Planned |

### 2.11 Visual and responsive — `e2e/lab-04/visual.spec.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| VIS-01 | Visual | §5 checklist | Every Lab 4 screen and state at 1440×900 | Screenshots written under `artifacts/lab-04/screenshots/`; no horizontal overflow and no clipped scroller asserted at each capture | `visual.spec.ts` | Planned |
| VIS-02 | Visual | §5 checklist | The same at 768×1024 | As above, with the tablet rearrangement in `ui-spec.md` §10 | same | Planned |
| VIS-03 | Visual | §5 checklist | The same at 375×812 | As above, with cards replacing both tables | same | Planned |

## 3. Acceptance-Criterion Traceability

| AC | Covered by |
|---|---|
| AC-01 | API-ACTION-01, E2E-01 |
| AC-02 | API-ACTION-02 |
| AC-03 | API-ACTION-04, UI-ACTION-03 |
| AC-04 | API-ACTION-06, API-ACTION-07, UI-ACTION-08 |
| AC-05 | API-ACTION-10, UI-ACTION-10, E2E-03 |
| AC-06 | API-ACTION-12 |
| AC-07 | API-ACTION-14, API-ACTION-16, UI-ACTION-07, E2E-04 |
| AC-08 | API-ACTION-15 |
| AC-09 | API-FLOW-01, API-FLOW-02, UI-FLOW-02, E2E-02 |
| AC-10 | API-FLOW-03, E2E-02 |
| AC-11 | API-FLOW-05 |
| AC-12 | API-FLOW-06, UI-FLOW-03 |
| AC-13 | API-FLOW-09, API-ACTION-21 |
| AC-14 | API-FLOW-10, API-ACTION-22 |
| AC-15 | API-DASHS-01, API-DASHS-02, API-DASHS-03, API-DASHS-05, API-DASHS-07, UI-DASHS-01, UI-DASHS-02, E2E-06 |
| AC-16 | API-DASHS-04 |
| AC-17 | API-DASHS-11, API-DASHR-09, UI-DASHS-03, UI-LIST-09, E2E-06 |
| AC-18 | API-DASHS-08, UI-DASHS-04 |
| AC-19 | API-DASHR-01, API-DASHR-03, API-DASHR-04, UI-DASHR-01, UI-DASHR-02, UI-DASHR-04, E2E-07 |
| AC-20 | API-DASHR-02, API-FLOW-12 |
| AC-21 | API-DASHR-06, UI-DASHR-03, E2E-07 |
| AC-22 | API-DASHS-09, API-DASHS-10, API-DASHR-07, API-DASHR-08, UI-DASHR-05, E2E-08 |
| AC-23 | UI-DASHS-05, UI-DASHR-05 |
| AC-24 | UI-ACTION-06, UI-DUP-01, UI-DUP-02, Lab 2 UI-CREATE-07 |
| AC-25 | UI-ACTION-11 |
| AC-26 | PERF-01, PERF-02 |
| AC-27 | API-FLOW-04, MIG-01, MIG-02, MIG-03, MIG-04 |
| AC-28 | MIG-07, MIG-08, MIG-09 |
| AC-29 | UI-FLOW-05 |
| AC-30 | VIS-01, VIS-02, VIS-03, A11Y-01, A11Y-02, A11Y-03, A11Y-04, A11Y-05, A11Y-06, A11Y-07, A11Y-08, §5 checklist |

## 4. Business-Rule Traceability

| BR | Covered by | BR | Covered by |
|---|---|---|---|
| BR-01 | API-ACTION-01 | BR-18 | UNIT-05, API-FLOW-01, API-FLOW-02, API-FLOW-03, API-FLOW-04 |
| BR-02 | E2E-05 | BR-19 | API-FLOW-05 |
| BR-03 | API-ACTION-02 | BR-20 | API-FLOW-12 |
| BR-04 | API-ACTION-06, API-ACTION-07, API-ACTION-08, UI-ACTION-08 | BR-21 | API-DASHS-01, API-DASHS-03, API-DASHS-05, API-DASHS-07, API-DASHS-08 |
| BR-05 | UNIT-01, API-ACTION-13, UI-ACTION-02 | BR-22 | API-DASHR-03, API-DASHR-05, API-DASHS-03 |
| BR-06 | UNIT-02, API-ACTION-11, UI-ACTION-05 | BR-23 | API-DASHS-01, API-DASHR-01 |
| BR-07 | UNIT-03, API-ACTION-04, API-ACTION-05 | BR-24 | API-DASHS-02 |
| BR-08 | API-ACTION-01, UI-ACTION-01 | BR-25 | UNIT-06, API-DASHS-06 |
| BR-09 | UNIT-04, API-ACTION-09 | BR-26 | API-FLOW-09, API-FLOW-11, API-ACTION-21 |
| BR-10 | API-ACTION-03, UI-ACTION-04 | BR-27 | UI-ACTION-09, UI-FLOW-04 |
| BR-11 | API-ACTION-17, UI-ACTION-01 | BR-28 | API-FLOW-10, API-ACTION-22 |
| BR-12 | API-ACTION-20 | BR-29 | API-ACTION-03, API-ACTION-09 |
| BR-13 | API-ACTION-19 | BR-30 | API-ACTION-01, API-FLOW-14 |
| BR-14 | API-ACTION-14, API-ACTION-18, API-DASHS-09, API-DASHR-07 | BR-31 | UI-ACTION-06, UI-DUP-01, UI-DUP-02 |
| BR-15 | API-ACTION-15 | BR-32 | MIG-05, MIG-07, MIG-08, MIG-09 |
| BR-16 | API-FLOW-06, API-FLOW-07, UI-FLOW-01 | BR-33 | PERF-01, PERF-02 |
| BR-17 | API-FLOW-08 | BR-34 | MIG-05, MIG-06, README review in Issue #51 |

## 5. Visual and Accessibility Checklist

Completed at 1440, 768 and 375 against the captured screenshots, mirroring
`ui-spec.md` §12.

**Visual**

- [ ] Zen Green tokens only — no colour that is not in Lab 2 §1.1
- [ ] Metric cards share one shape, label size and value size on both dashboards
- [ ] A zero metric renders `0` with its sub-line, never blank
- [ ] All four action status badges are distinguishable side by side, text plus colour
- [ ] Editable and read-only fields stay distinct inside the Action form
- [ ] Validation messages sit directly below their field, including the revealed follow-up note
- [ ] The Actions panel is unmistakably separate from Public Comments and Internal Notes
- [ ] The Requester's Actions panel shows no write control
- [ ] No clipped text, overlap or horizontal scroll on either dashboard or the Actions table
- [ ] Nothing from Lab 2's Requester-selector era remains on any screen

**Accessibility**

- [ ] Every metric card is keyboard reachable and announces label, value and destination
- [ ] Focus visible on every new control, including the Action form and the cancel dialog
- [ ] `Actions Taken` is a heading and the Actions are an ordered list
- [ ] The follow-up note is announced as required as soon as Yes is chosen
- [ ] The disabled Resolve option announces why
- [ ] The stale-write alert is announced and takes focus
- [ ] Action status is never colour alone
- [ ] The cancel dialog traps focus and returns it to the trigger

## 6. Test Commands

```bash
# Unit, API, workflow, dashboards, migration and performance smoke
npm test --prefix server

# UI components and accessibility
npm test --prefix client

# E2E and visual. Run from the repository root; the database must be migrated
# and seeded first, and Anong must remain the only active Administrator.
npm run test:e2e

# Remove data left behind by an interrupted E2E run
npm run e2e:cleanup --prefix server
```

The Lab 3 E2E fixture contract is extended, not replaced: Lab 4 specs reuse the
`e2e-` accounts and the `[e2e]` ticket marker, so the existing cleanup removes
whatever the new specs create.

## 7. Final Results

Filled in as each issue lands; Issue #53 records the final run from the
`lab4-staging` head that the release Pull Request merges into `main` unchanged.

| Suite | Command | Tests | Result |
|---|---|---|---|
| Server unit + API + workflow + dashboards + migration + perf | `npm test --prefix server` | 305 | **Pass** (20 Oct) |
| Client UI components + accessibility | `npm test --prefix client` | 185 | **Pass** (20 Oct) |
| E2E + visual | `npm run test:e2e` | — | Planned — Issue #52 |

### After Issue #46 — Actions Taken foundation

| Date | Command | Result |
|---|---|---|
| 2026-10-12 | `npm test --prefix server` | 253 passed / 253 (21 files) |
| 2026-10-12 | `npx tsc --noEmit` (server) | clean |

The sprint's first code lands: the `ActionTaken` model and `ActionStatus` enum, `Ticket.version`, the
migration with its rollback documented in the file's own header, the seed extension, the three Actions
endpoints and 37 tests (UNIT-01..05, API-ACTION-01..22).

**Three Lab 2 and Lab 3 tests were deliberately updated**, as the Definition of Done permits when the reason
is recorded. `API-LIST-01`, `API-QUEUE-01` and `API-TICKET-01` assert the Ticket object's field list exactly,
and `version` has joined that list for optimistic concurrency (BR-26, `api-spec.md` §6). The assertion was
kept exact and the field added to it, rather than loosened to "contains" — an exact list is what makes a
leaked column visible, which is why those three rows exist.

**Not yet wired up, by design:** `Ticket.version` exists and is returned, but the Ticket write endpoints do
not require it yet. The precondition and the resolution gate arrive together in Issue #48, because requiring
the field earlier would break the Lab 3 ticket suites for a sprint-internal reason rather than a contractual
one.

### After Issue #48 — Ticket workflow and resolution

| Date | Command | Result |
|---|---|---|
| 2026-10-14 | `npm test --prefix server` | 267 passed / 267 (22 files, 13 new) |
| 2026-10-15 | `npm test --prefix client` | 158 passed / 158 (8 new) |
| 2026-10-14 | `npx tsc --noEmit` (server, client) | clean on both |
| 2026-10-14 | `npm run build` (server, client) | both succeed |

The three Ticket writes gain the version precondition (BR-26, BR-28) and the status write gains the
resolution gate (BR-18): a Ticket cannot reach Resolved while any of its Actions is still Planned or In
Progress, and the refusal counts them. Cancelling stays ungated (BR-19). `GET /api/tickets/:id` now carries
`openActionCount`, and the Operations panel uses it to disable Resolve with the reason attached to the
select — while the server remains the authority. Thirteen API cases (API-FLOW-01..12, API-FLOW-14) and seven
component cases (UI-FLOW-01..04) land with it.

**Three naming and shape corrections.**

The sprint contract named the refused-transition code `INVALID_TRANSITION` and said it was what Lab 3
answered. Lab 3 answers `INVALID_STATUS_TRANSITION` — in `docs/lab-03/api-spec.md`, in the server suite and
in the client suite alike. `api-spec.md` §6 and the `API-FLOW-06` row were corrected to the name the service
actually uses: renaming a code the previous sprint shipped would break a published contract to fix a typo in
this one.

`TicketSummary` and `StaffTicket` exclude `openActionCount`, because a list row is not a Ticket anybody is
resolving. `POST /api/tickets/:id/appears-resolved` raises the version without requiring one, which
`api-spec.md` §6 now states.

**Four earlier tests were deliberately updated**, with the reason recorded here as the Definition of Done
requires:

| Test | Change | Reason |
|---|---|---|
| `API-TICKET-01` | `openActionCount` added to the exact field list | the detail read carries it now (BR-18, AC-09); the list is kept exact rather than loosened, which is the point of that assertion |
| `API-TICKET-02..11, 19` | the suite's `patch` helper reads the Ticket's current version and sends it | those cases are about ownership, priority and the matrix, not about concurrency; the version rules are asserted on their own in `API-FLOW-09..11` |
| `API-TICKET-10` (two simultaneous moves) | the loser's code is now `STALE_UPDATE` | unchanged in substance — exactly one writer still wins — but the loser is told the Ticket moved underneath them, which is truer than "Open to Open is not a move" |
| `UI-DETAIL-03, 04, 06` | the four asserted request bodies carry `version` | the screen sends the version it is showing; `UI-DETAIL-03` sends `version: 2` on its second write, because the first write returned a new one |

**A defect from Issue #47, found by reading the code rather than running it.** The Actions panel renders a
stale-write conflict with `className="zg-conflict"`, and no `.zg-conflict` rule existed in `zen-green.css`
— the block had been shipping unstyled. It is the same failure mode as the two caught by hand-testing: a
component test asserts text and roles, never which stylesheet rule applies. The class is now defined once
and the Operations panel renders the same block, which is what `ui-spec.md` §2.3 asked for.

**One accessibility rule was written down and not built.** `ui-spec.md` §11 says the stale-write alert takes
focus to its Reload button, because the person is about to lose their change if they scroll past it. Neither
panel did — the Actions panel had shipped without it in Issue #47, and the Operations panel was about to
repeat the omission. Both now move focus, and `UI-ACTION-09` and `UI-FLOW-04` each assert it. The same
reading corrected §2.3, which quoted a generic sentence the service never sends: the block carries the
server's own message, which names the ticket or the action.

**A defect the two components could not have caught, found by hand-testing.** Pressing *Problem Appears
Resolved* re-rendered Ticket Detail with **two Attachments panels**. Neither component was wrong:
`AttachmentSection` and `ActionsTaken` are both keyed, so that moving to another Ticket resets their own
state instead of carrying the last Ticket's rows across — and Issue #47 keyed the new panel `ticket.id`,
which is what the panel above it was already keyed. React is explicit that two siblings sharing a key may be
duplicated or dropped on an update, and it logs a warning saying so. The keys are now prefixed, and
**`UI-ACTION-12`** asserts that every panel renders once after an update and that React logs no such
warning; it fails on the previous code, which is the only reason to believe it. The lesson is the one
already recorded for Issue #47: component tests assert what a component renders, never how the screen that
composes them reconciles.

**One visual defect, seen in the Part 7 evidence itself.** In the Ticket header, the Requester's name and
the role badge share a 40px read-only field as flex items, and a flex item may shrink below its own content:
a long name pushed both onto two lines, breaking the word "Requester" across the middle of its pill and
spilling out of the box. It appears at the width a half-screen window gives, which is why 1440 / 768 / 375
spot checks had not met it. The badge now never shrinks and the name truncates with its full text on
`title`. No test asserts it — jsdom has no layout, which is the same reason the class-name defects of Issue
#47 went unseen — so it belongs to the visual checklist (`ui-spec.md` §12, VIS-01..03 in Issue #52).

**`UI-FLOW-05` moves to Issue #50.** It asserts that Dashboard is the first navigation item and the landing
route for all three roles (FR-25). Neither dashboard exists until Issues #49 and #50, so the case is written
where the thing it describes is built, rather than against a route that would have to be stubbed.

### After Issue #49 — IT Staff dashboard

| Date | Command | Result |
|---|---|---|
| 2026-10-15 | `npm test --prefix server` | 285 passed / 285 (24 files, 18 new) |
| 2026-10-15 | `npm test --prefix client` | 167 passed / 167 (9 new) |
| 2026-10-15 | `npx tsc --noEmit` (server, client, e2e) | clean on all three |
| 2026-10-15 | `npm run build` (server, client) | both succeed |

`GET /api/dashboard/staff` lands with every metric BR-21 names, the by-status map including its zeros, the
two ten-row lists, and the Administrator's account counts. The screen renders them at `/dashboard`, each
card a link to the queue query that produced its number, with the loading, empty, forbidden and
safe-failure states §4.4 defines. Dashboard also joins the navigation for both staff roles.

**A fourth database decision, recorded in `specification.md` §7.** The dashboard counts Tickets that
*became* Resolved in the last seven days, and `updatedAt` cannot answer that — it moves for an IT Priority
change too, so a Ticket resolved a month ago and edited yesterday would be reported as this week's work.
`Ticket.resolvedAt` is written by the status transition, never cleared, read only beside
`currentStatus = RESOLVED`, and never returned by the API. The migration backfills existing Resolved
Tickets with their `updatedAt` and says in its own header that this is an over-estimate where the
resolution was not the last thing done to them, because no pre-Lab-4 row records the real moment.

**Three queue parameters that the contract had promised and nobody had built.** `status=open`,
`actionsAssignedTo` and `actionStatus` are what the cards link with; without them a card counting open
Tickets would open a queue listing closed ones, which is exactly the disagreement AC-17 forbids. The first
was described in `ui-spec.md` §4.5 as "the queue's existing shorthand" and did not exist — the same kind of
drift as `INVALID_TRANSITION` in Issue #48, and found the same way, by reading the code the document
describes. **API-DASHS-11** was added for them: the contract left "the card's number equals the queue's
total" to `E2E-06` in Issue #52, which would have left three new filters untested for two days. It asserts
the equality at the API now, and E2E-06 still proves it through the browser later.

**`owner=me` changed meaning on the client only.** The dashboard links with `me` so the address stays
readable; the screen resolves it to an id and the address corrects itself, which is the §7.4 rule it already
applied to everything else. The server still ignores the word, as Lab 3's `API-QUEUE-09` requires — so that
case keeps a junk owner value, and a new `UI-QUEUE-02` case asserts the resolution.

**`ui-spec.md` §4.1 was corrected.** It said the two Administrator cards link to User Management "with the
matching status filter", and that screen has no filter on account status — only search and role. The cards
open the screen itself. The handout makes those two counts optional (§4.6), so adding a filter to a Lab 3
screen and its API to serve them would have been a larger change than the numbers are worth.

**Two earlier tests were deliberately updated.** `UI-SHELL-02` now expects Dashboard first in the navigation
for both staff roles. `UI-QUEUE-02`'s junk-value case swapped `owner=me` for `owner=nobody`, because `me` is
no longer junk. Making Dashboard the *landing* destination for all three roles is FR-25 and `UI-FLOW-05`,
which stay in Issue #50 so that all three roles change together rather than this assertion changing twice.

**A sweep for class names that do not exist.** The `.zg-conflict` defect of Issue #48 was a class the code
referenced and the stylesheet never defined — the kind of thing no test can see, because jsdom has no
layout. Every class name the Lab 4 components use was therefore checked against `zen-green.css`
mechanically. The dashboard's thirty-three are all defined. Two others were not: `zg-field-row--2`, written
in Issue #47 for the Action form's *Assigned to* row, which has rendered as one column ever since because
only `--3` and `--4` have rules; and `zg-queue-card`, named in `docs/lab-03/ui-spec.md` §356 and never
given one, which is inert beside `zg-ticket-card` and belongs to a sprint already submitted. The first was
removed rather than invented, because §6.3 lists the form's fields in order and asks for no grid, and
inventing it would have invalidated the Part 6 screenshots a day before the deadline for a cosmetic change.
The responsive table was corrected to match. The second is recorded and left alone.

**One limitation left for Issue #51.** Arriving from the *My open actions* card filters the queue by
`actionsAssignedTo`, and that filter has no control of its own — the only sign the list is narrowed is that
Clear Filters is enabled. It is not wrong, and Clear does return the whole queue, but a person who opened
the card and then scrolled is not told why the list is short. The polish pass is where a line saying so
belongs; inventing a control for it here would be new interface nobody specified.

**Part 5's figures 5.1, 5.7, 5.8 and 5.10 are artifact paths**, which in Lab 3 came from `visual.spec.ts`.
`e2e/lab-04/visual.spec.ts` was written here rather than left to Issue #52, because Lab 3 was submitted with
four figures missing for exactly that reason. Issue #52 extends the file; its shape is Lab 3's, so that is
adding blocks rather than rewriting it.

### After Issue #50 — Requester dashboard

| Date | Command | Result |
|---|---|---|
| 2026-10-16 | `npm test --prefix server` | 294 passed / 294 (25 files, 9 new) |
| 2026-10-16 | `npm test --prefix client` | 179 passed / 179 (12 new) |
| 2026-10-16 | `npx tsc --noEmit` (server, client, e2e) | clean on all three |
| 2026-10-16 | `npm run build` (server, client) | both succeed |

`GET /api/dashboard/requester` answers the three counts BR-22 names, the attention list, and the two
five-row lists, all from the session and never from the query string. The screen renders them at
`/dashboard`, and **FR-25 lands every role there**: one route, two screens, chosen by the caller's role
rather than by the address, so a link shared between colleagues always opens somewhere the recipient is
allowed to be.

**A gap in the contract, not a contradiction.** `ui-spec.md` §5.1 and `API-DASHR-04` both require an
attention panel holding the Tickets behind the second and third cards, and `api-spec.md` §7's example had
no field for them — the screen could not have built that list from what the endpoint returned. `attention`
was added and documented. It carries no separate `reason` field: a row is listed because of its own status,
and a second copy of that fact is a second thing to keep honest.

**The drill-down did not work, and the user found it by pressing a card.** Every Requester card links into
My Tickets with the filter behind its number (FR-19, `ui-spec.md` §5.3), and the list opened unfiltered.
Four separate things were wrong, each a leftover rather than a mistake made here:

1. `GET /api/tickets` accepted `status=NEW` and nothing else - Lab 2's contract, written when New was the
   only status a Ticket could have. Lab 3 added the other seven and this was never widened.
2. The screen's Current Status control offered one option, `New`, for the same reason - a control that
   cannot describe the Ticket in front of the reader (FR-26).
3. My Tickets never read the address at all; its filters lived entirely in component state.
4. With those three fixed, the list arrived filtered and then immediately re-fetched without the filter:
   the effect that clears a previous Requester's view (BR-07) is keyed on `user.id`, and an effect keyed on
   a value also runs on the first render. It now remembers the previous id and skips that first run.

**`UI-DASHR-04` asserted the card's `href` and not what the href opens**, which is exactly the hole
`API-DASHS-11` was added to close on the staff side in Issue #49 - and the same hole was left open here.
**`API-DASHR-09`** now asserts that each card's query returns the number the card showed, and it fails on
the previous code. **`UI-LIST-09`** in the Lab 2 suite asserts that the screen applies a status from the
address, shows it in the control, and ignores one the address invents.

**Eleven earlier tests were deliberately updated**, which is the whole cost of FR-25 and was expected when
it was deferred from Issue #48 so that all three roles would change together rather than twice:

| Test | Change |
|---|---|
| `UI-ROUTE-05` ×5 (`lab-03/AppRoutes`) | every role now lands on `/dashboard`; the two dashboard fetches are mocked like any other screen the suite passes through |
| `UI-ROUTE-06` ×2, `UI-USER-09` ×2, `UI-QUEUE-06` (five cases across three files) | the forbidden state's way back is "Back to Dashboard" for everybody, because `LANDING` is now one destination |
| `UI-DASHS-05` (`lab-04/StaffDashboard`) | the same, for the staff dashboard's own forbidden case |

**The Lab 3 end-to-end specs needed the same change, and the component suites did not reveal it.** A
component test renders one screen and is told which; only the browser follows a sign-in to wherever it
leads. Eight places across four spec files still expected the old landing, and `npm run test:e2e` would
have failed on `main`:

| Case | Change |
|---|---|
| `E2E-01` (`lab-03/authentication`) | every role lands on `/dashboard`; each one then reaches its own screen from the navigation, which is a stronger assertion than the old direct landing, and the signed-out check still uses the role's own address |
| `E2E-02` | the mandatory password change ends on the Dashboard |
| `E2E-04` | "Dashboard" leads each role's navigation, the way back from a refusal is "Back to Dashboard" for everybody, and each role now also meets 403 at the *other* role's dashboard endpoint |
| `E2E-05` (`lab-03/staff-ticket-flow`) | the retired `/select-requester` address lands on the Dashboard, which is where the catch-all route sends everything |
| `E2E-06`, `E2E-12` | staff open the Queue rather than arriving on it |
| `E2E-09`, `E2E-10`, `E2E-11` (`lab-03/user-administration`) | the Administrator opens User Management rather than arriving on it, and the deactivated person is on the Dashboard when their session is taken away |
| `VIS-01..03` (`lab-03/visual`) | the queue and user-management captures navigate to their screens |

Nothing in Lab 3's own behaviour changed: every one of these still asserts what it asserted before, from
one screen further along. That is the price FR-25 was always going to charge, and it is paid once.

**`e2e/lab-04/visual.spec.ts` gained the Requester dashboard** at all three widths, in default and empty
states, which produces Part 8's figure 8.1 and its responsive pair without waiting for Issue #52.

Its staff **forbidden** capture changed with FR-25. It used to sign a Requester in and send them to
`/dashboard`, which was the real refusal while that route was guarded by role. One route now renders the
screen the role may see, so no address carries a Requester to the staff variant and that capture would have
photographed the *Requester* dashboard while being filed under the staff one. The staff member now stays
signed in and the staff endpoint is made to answer 403 - the same way the empty state above it is produced,
and the state `ui-spec.md` §4.4 actually describes. Report figure 5.8's caption was corrected to match:
it is the dashboard's forbidden state, not a Requester reaching an address that no longer exists.

### Fixes found by hand-testing Issue #47

Two defects the suites had not caught, both found by using the screen rather than reading it:

| What was wrong | Why the tests missed it | Fix |
|---|---|---|
| Saving an edit that carried an assignee answered **500**, and the screen showed "Something went wrong" | every assignee case in `actions-taken.api.test.ts` was a *refusal*, so the successful write was never exercised: the update carries its version in the WHERE, which makes it an `updateMany`, and `updateMany` cannot take Prisma's nested `connect` syntax | the update now sets `assignedToId` as a scalar, and **API-ACTION-06** gained a case for a successful reassignment |
| The form's fields were the 40px single-line height, and validation messages were not red | the component used `zg-field` (the wrapper class) and `zg-field-message` (a class that does not exist) instead of the house `zg-field--textarea`, `zg-field--editable` and `zg-validation-message`; a component test asserts text and roles, not which stylesheet rule applies | the form now uses the Lab 2 field classes, so both textareas start at 120px and resize taller only |

A third change came out of the same session: **Complete** no longer sits disabled with its reason in a
tooltip. It opens the edit form on the Result field with the message, which is what `ui-spec.md` §6.4 had
specified all along.

### After Issue #47 — Actions Taken UI

| Date | Command | Result |
|---|---|---|
| 2026-10-13 | `npm test --prefix server` | 253 passed / 253 |
| 2026-10-13 | `npm test --prefix client` | 150 passed / 150 (16 new) |
| 2026-10-14 | `npm test --prefix server` after the reassignment fix | 254 passed / 254 |
| 2026-10-13 | `npx tsc --noEmit` (client) | clean |

The Actions Taken panel lands on Ticket Detail: the log, the inline create and edit form, complete and
cancel with their confirmation, the follow-up note that becomes required the moment follow-up is set to
Yes, and the stale-write conflict with its Reload. A Requester sees every Action and no write control at
all, and their screen never asks for the staff assignee list.

**Two earlier tests were updated deliberately.** `UI-DETAIL-01` in `client/tests/lab-02` asserted that
"Actions Taken" was *absent*, because Lab 2 deferred it; the assertion now checks that the panel is present
and that no write control is, which is the part that still matters for a Requester (FR-06). The same file's
fetch fixture learned the `/actions` endpoint, as it learned `/comments` in Lab 3.

**The documented layout changed before it was built.** `ui-spec.md` §6.2 had specified a six-column
`zg-table` with a separate mobile card rendering. It now specifies one responsive layout for every width,
because two renderings of the same data are two things to keep honest, and the column a table would drop
first is Result — the one the log exists for. The handout's §8.3 allows "an appropriate list or table".

### After Issue #51 — final hardening and regression

| Date | Command | Result |
|---|---|---|
| 2026-10-20 | `npm test --prefix server` | 305 passed / 305 (27 files, 11 new) |
| 2026-10-20 | `npm test --prefix client` | 185 passed / 185 (6 new) |
| 2026-10-20 | `npx tsc --noEmit` (server, client, e2e) | clean |
| 2026-10-20 | `npm run build` (server, client) | both succeed |
| 2026-10-21 | both suites again, after the hand-testing | 305 / 305 and 185 / 185 — the hand-tests claimed a Ticket, changed an IT Priority and added a comment and a note, and nothing in either suite depends on that data staying as it was |
| 2026-10-21 | `npx playwright test e2e/lab-04/visual.spec.ts` | 6 passed |

FR-26 cleanup, FR-22 conformance, the duplicate-submit cases BR-31 was missing, the performance smoke
tests, the migration and regression suites, and the Lab 4 section of the README.

**Four class names had no rule behind them, which is the third time this sprint.** `.zg-conflict` was
written into the Actions panel in Issue #47 and defined in Issue #48; `zg-field-row--2` was removed in
Issue #47 after a screenshot showed the field it was meant to lay out sitting in one column anyway. This
issue found four more by reading the stylesheet against the source rather than by looking at a screen:

| Class | Where | What was wrong |
|---|---|---|
| `zg-state` | `ActionsTaken.tsx` ×3 | a base class no rule matches; the other six screens carry only the modifier |
| `zg-callout` | `ActionsTaken.tsx` ×2 | the same, and the five other callouts in the product carry the modifier alone |
| `zg-user-status` | `UserManagement.tsx` | the same, inside a ternary that then said the same thing twice |
| `zg-queue-card` | `StaffTicketQueue.tsx` | a second class on a card already styled by `zg-ticket-card` |

None of them changed how anything looked, because in each case the modifier carried the styling. That is
exactly why none of them was ever noticed, and why **`UI-STYLE-01`** now reads `zen-green.css` and fails
the build naming the class and the file. It fails on each of the four, and on the two earlier defects.
`UI-STYLE-02` guards the guard: a conformance test that collected nothing would pass while asserting
nothing. **One Lab 3 test was updated deliberately** — `UI-USER-01` queried `.zg-user-status` to find the
element; it now queries the modifier.

Four CSS rules are defined and currently applied by nothing: `zg-btn--disabled`, `zg-callout--neutral`,
`zg-field--focus` and `zg-text-base`. They stay. Each is a documented entry in the Zen Green design system
in `lab-02/ui-spec.md` §2.1–§2.2 — the disabled button variant, the neutral callout, the focused-field ring
and the body size — and FR-26 asks for no obsolete *control* left over, not for a design system trimmed to
whatever this sprint happened to use. `zg-btn--disabled` is also still matched through the shared
`:disabled` selector groups.

**The console check had to be narrowed before it said anything useful.** FR-26 also asks for "no console
error in normal use", so `watchConsole()` listens across each dashboard walk in `e2e/lab-04/visual.spec.ts`
and asserts the console stayed quiet. Its first version failed all six walks on 12 to 16 messages, none of
which was the product reporting a defect:

| Message | Why it is not a defect |
|---|---|
| `Failed to load resource: … 401` | Chrome narrating the network. The app asks `/api/auth/me` before anyone has signed in and 401 is the documented answer (`lab-03/ui-spec.md` §2.1) |
| `Failed to load resource: … 403` | the forbidden capture routes a dashboard endpoint to 403 on purpose |
| `React Router Future Flag Warning` ×2 per navigation | a library notice about a v7 upgrade that has not happened |

The three families are filtered and the filter is documented where it lives. The line is matched rather
than the status code, because a 500 reads identically and the safe-failure capture provokes one of those
too; what the application *does* with each of them is asserted by the cases around the walk, not by this.
What remains is what the check is for: React's own warnings, and any uncaught exception, which is never
filtered. **The router warnings are worth carrying forward** - they are a real upgrade notice, they will
still be there in Lab 5, and acting on them means changing the router's configuration, which is not
Issue #51's scope.

**The seed had quietly stopped covering `IN_PROGRESS`, and `MIG-06` found it.** `specification.md` §7
requires at least one Action in each of the four statuses so that every badge is demonstrable. The seed
defines one, on the VPN hotspot Ticket — and Issue #47's hand-testing completed it on 14 October. The seed
is idempotent by leaving an existing Action exactly as it is, on purpose, so that a status somebody changed
while trying the screen is not reset; it therefore had nothing to restore, and no test looked. The seed now
defines **two** In Progress Actions, so the status survives somebody working through one of them, which is
the normal thing to do with an Action that is in progress. Re-running the seed adds the new one and touches
nothing else.

**`MIG-04` runs the rollback rather than describing it.** PostgreSQL makes DDL transactional, so the five
statements in the two Lab 4 migration headers are executed against the live schema inside a transaction
that is then aborted. Inside it the suite asserts that `ActionTaken`, `ActionStatus`, `Ticket.version` and
`Ticket.resolvedAt` are gone, that `Ticket.ownerId` and `PublicComment` are not — which is what "restores
the Lab 3 schema" means — and that every User, Ticket, Comment and Note row is still there. After the abort
it asserts the counts again, so a rollback that failed to roll back fails the test rather than the database.

**`MIG-01` looks for references that no longer resolve, not for missing tables.** The Lab 3 migration
renamed `Requester` to `User` in place so that every id survived; if that had gone wrong the damage would
show as a `Ticket.requesterId` pointing at nothing, which no other case in the suite looks for. One query
checks all eight foreign keys across the whole database.

**`MIG-02` asserts the column default, not the rows.** Every pre-existing Ticket was at version 1 the
moment the migration ran, but a Ticket edited since is legitimately above it, so counting rows at 1 would
prove nothing. What the migration promised is `DEFAULT 1`, read from `information_schema`.

**The performance budget prints its measurement.** `PERF-01` and `PERF-02` write the five samples and the
worst of them to stdout, because "2 passed" does not say whether a dashboard answered in 11 ms or in 480.
Measured 20 October against 92 Tickets: staff worst 11 ms, Requester worst 7 ms, of a 500 ms budget.

**FR-22 was audited rather than tested.** Every screen's state vocabulary was listed and compared: all nine
pages pair a `zg-state--x` class with a `zg-state-x` test id, in the same spelling, for loading, empty,
no-results, error, success, forbidden and not-found. The Actions panel and both threads deliberately use
panel-scoped ids instead, which is `ui-spec.md` §4.4's rule that a list with no rows shows its empty state
inside its own card and not as a page-level state. Login carries no `zg-state` at all because a refused
sign-in is a validation message, not a failed page. The one inconsistency found was the base-class group
above. A state matrix is a table of renderings, and asserting it mechanically would mean asserting that
each screen contains a string — which is what `UI-STYLE-01` already does for the part that can go wrong
silently.

**FR-23 was already implemented on all four forms and tested on two.** `UI-CREATE-07` has covered the
Ticket form since Lab 2 and `UI-ACTION-06` the Actions form since Issue #47; the two thread composers share
one guard and had none. `UI-DUP-01` and `UI-DUP-02` hold the POST in flight, press again and count what
reached the server — asserting the button is disabled is a weaker claim, because a disabled button still
fires if the handler lets it. A third case asserts the guard *lifts*: a thread that accepted one comment
and then refused every later one would pass both of the others.

**The audit against the handout found three more things, after the work above was already verified.**
Reading §8.5 and §5.3 bullet by bullet against the suite rather than against the specification:

| Bullet | What was missing | Closed by |
|---|---|---|
| §8.5 "attachments ... remains correct" | `MIG-07`'s row had always promised "attachment rules" and the case did not exercise one. A migration that broke the upload path would have answered 500 and nothing would have failed | `MIG-07` now covers BR-26 (415 `UNSUPPORTED_FILE_TYPE`), BR-27 (413 `FILE_TOO_LARGE`), a successful upload, BR-11 on a foreign Ticket, Lab 2's BR-31 removal reason and its 409 `ALREADY_REMOVED`, and BR-30/BR-29 — a soft-removed attachment is never downloadable while its metadata stays readable |
| §8.5 "broken links ... are removed" | never checked at all | **`UI-LINK-01`** resolves every `to=` target against the routes `App.tsx` defines |
| §5.3 "all major statuses, priorities, assigned and unassigned ownership" and "non-zero *and zero* dashboard metrics" | `MIG-06` asserted the Action coverage and the weekly window, and nothing about the Tickets themselves | `MIG-06` now asserts six statuses, all three requested priorities, Tickets both assigned and unassigned, and that an active Requester with no Tickets still exists so the empty dashboard stays demonstrable |

**One documentation defect was introduced during this issue and caught by the same audit.** The four new
rows were inserted above `UI-DASHR-05`, whose File column reads `same` — so it silently came to name
`DuplicateSubmit.test.tsx` instead of `RequesterDashboard.test.tsx`. A `same` in a table is a reference to
whatever precedes it, and inserting a row rewrites it. The row now names its file outright, and a check
that reads every id in the plan against the suites is what found it.

**BR-31's second clause is not met, and is recorded in §8 rather than claimed here.** "The API is written
so that a retry is safe to make" is true of every *update* — each carries a version and a replay is refused
with 409 — and is not true of the four creates, which have no idempotency key. A double click cannot reach
the server, but a retry after a timeout can, and would create a second record. Implementing that is a
client-supplied key, storage for it and a dedup path on four endpoints, which is a larger change than this
issue's scope and was not in the sprint plan.

## 8. Known Limitations and Deferred Tests

- **`UI-LINK-01` finds a link to a screen that is gone, not a parameter that is
  wrong.** `/tickets/create-old` matches the `/tickets/:id` route, so it passes
  the check and renders the not-found state at runtime; only a target matching
  no route at all - the removed `/select-requester` is the shape the case is
  built for - fails it. Found while proving the case fails on the defect it
  exists to catch, which the first attempt did not.
- **BR-31's retry clause is met for updates and not for creates.** "The
  interface disables its control for the duration of the request" holds on all
  four create forms and is proven by `UI-CREATE-07`, `UI-ACTION-06`, `UI-DUP-01`
  and `UI-DUP-02`, so a double click cannot reach the server. "The API is
  written so that a retry is safe to make" holds for every *update*, which
  carries a version and answers 409 to a replay (BR-26, BR-28, `API-FLOW-09`),
  and does not hold for `POST /api/tickets`, `/actions`, `/comments` or
  `/notes`: a retry after a timeout would create a second record. Making it true
  means a client-supplied idempotency key, somewhere to keep it, and a dedup
  path on four endpoints - a larger change than Issue #51's scope and not in the
  sprint plan, so it is stated here rather than quietly counted as done. AC-24
  is about a form submitted twice and is met.
- **The performance budget is a smoke test, not a benchmark.** PERF-01 and
  PERF-02 assert a 500 ms ceiling on a seeded development database on one
  machine. They catch an N+1 query or a missing index, which is their purpose;
  they say nothing about behaviour under real load, and no conclusion about
  production performance may be drawn from them.
- **Concurrency is tested as two sequential requests holding the same version**,
  not as two genuinely simultaneous ones. The version check is a single
  conditional update, so the sequential test exercises the same code path the
  race would reach; a true race would need a second connection timed to the
  millisecond and would still prove nothing extra.
- **Rollback is tested with the documented SQL**, not with `prisma migrate
  down`, which Prisma does not provide. MIG-04 applies the statements in
  `specification.md` §7 to a scratch database and asserts the Lab 3 schema and
  data are restored.
- **No automated accessibility audit tool.** A11Y-01 to A11Y-08 plus the §5
  checklist cover what the handout asks for; an axe-style audit would catch
  contrast and landmark issues these rows do not, and remains out of scope as
  it was in Lab 3.
