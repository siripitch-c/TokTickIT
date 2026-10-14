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
| UNIT-06 | Unit | BR-25 | Asia/Bangkok day boundary | "Last 7 days" starts at 00:00 Bangkok seven days ago, independent of the server's timezone | `dashboard-metrics.unit.test.ts` | Planned |

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
| API-FLOW-01 | API | AC-09, BR-18, FR-08 | Resolve with one Planned Action | 409 `OPEN_ACTIONS_REMAIN`, message names the count, status unchanged, and the Ticket read reports the same `openActionCount` | `ticket-workflow.api.test.ts` | Planned |
| API-FLOW-02 | API | AC-09 | Resolve with one In Progress Action | 409, as above | same | Planned |
| API-FLOW-03 | API | AC-10 | Resolve after every Action is final | 200; status Resolved | same | Planned |
| API-FLOW-04 | API | AC-27, BR-18 | Resolve a legacy Ticket with no Actions | 200; the gate passes trivially | same | Planned |
| API-FLOW-05 | API | AC-11, BR-19 | Cancel a Ticket holding open Actions | 200; the Actions are untouched | same | Planned |
| API-FLOW-06 | API | AC-12, BR-16 | Every transition the matrix forbids | 409 `INVALID_TRANSITION` for each pair tested, status unchanged | same | Planned |
| API-FLOW-07 | API | BR-16 | Every transition the matrix permits | 200 for each pair tested | same | Planned |
| API-FLOW-08 | API | BR-17 | Requester attempts a status change | 403 | same | Planned |
| API-FLOW-09 | API | AC-13, BR-26 | Two writers, second holds the old version | Second answers 409 `STALE_UPDATE`; the first write is intact | same | Planned |
| API-FLOW-10 | API | AC-14, BR-28 | Status write with no version | 400 `VERSION_REQUIRED` | same | Planned |
| API-FLOW-11 | API | BR-26 | Version increments | Owner, IT priority and status writes each raise the version by exactly one | same | Planned |
| API-FLOW-12 | API | BR-20, AC-20 | Requester resolution signal | Recorded once with its time; status unchanged; a second attempt refused | same | Planned |
| API-FLOW-14 | API | BR-30 | Unexpected failure path | 500 with a generic message and no internal detail | same | Planned |

### 2.4 API — Staff dashboard — `server/tests/lab-04/staff-dashboard.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-DASHS-01 | API | AC-15, BR-21, BR-23 | Every metric present, nothing more | All nine keys returned as integers; the body carries counts and short lists only, with no full Ticket collection and no email address | `staff-dashboard.api.test.ts` | Planned |
| API-DASHS-02 | API | AC-15, BR-24 | Counts match direct queries | Each count equals the same query run through Prisma in the test | same | Planned |
| API-DASHS-03 | API | BR-21, BR-22 | "Open" excludes terminal statuses | Resolved, Closed and Cancelled Tickets are absent from every metric on either dashboard that claims to count open work | same | Planned |
| API-DASHS-04 | API | AC-16, FR-13 | My open actions | Counts only Planned and In Progress Actions assigned to the caller | same | Planned |
| API-DASHS-05 | API | BR-21 | By-status map | Contains all eight statuses, including zeros | same | Planned |
| API-DASHS-06 | API | BR-25 | Resolved in the last 7 days | A Ticket resolved 6 days ago counts; one resolved 8 days ago does not; boundary evaluated in Asia/Bangkok | same | Planned |
| API-DASHS-07 | API | FR-14 | Recently updated and needs attention | At most 10 rows each, correct ordering, only open Tickets | same | Planned |
| API-DASHS-08 | API | AC-18, FR-16 | Administrator counts | Present for an Administrator, absent for IT Staff | same | Planned |
| API-DASHS-09 | API | AC-22 | Requester calls the staff dashboard | 403 | same | Planned |
| API-DASHS-10 | API | BR-14 | Unauthenticated call | 401 | same | Planned |

### 2.5 API — Requester dashboard — `server/tests/lab-04/requester-dashboard.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-DASHR-01 | API | AC-19, BR-22 | Own data only | Every count and row belongs to the caller; another Requester's Ticket appears nowhere | `requester-dashboard.api.test.ts` | Planned |
| API-DASHR-02 | API | AC-20, FR-20 | `requesterId` in the query string | Ignored; the caller's own data is returned | same | Planned |
| API-DASHR-03 | API | BR-22 | Metric definitions, limits and ordering | The three counts match direct queries, and each list holds at most five rows, most recent first | same | Planned |
| API-DASHR-04 | API | FR-18 | Attention lists | Waiting-for-me and resolved rows carry the reason they are listed | same | Planned |
| API-DASHR-06 | API | AC-21 | Requester with no Tickets | Zeros and empty arrays, 200, no error | same | Planned |
| API-DASHR-07 | API | AC-22 | IT Staff or Administrator calls it | 403 | same | Planned |
| API-DASHR-08 | API | BR-14 | Unauthenticated call | 401 | same | Planned |

### 2.6 Migration, rollback and Lab 1–3 regression — `server/tests/lab-04/migration.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| MIG-01 | Migration | §7 | Apply Lab 4 to a Lab 3 database | Every User, Ticket, Attachment, Comment and Note row survives with its id | `migration.api.test.ts` | Planned |
| MIG-02 | Migration | §7 | `Ticket.version` backfill | Every pre-existing Ticket is at version 1 | same | Planned |
| MIG-03 | Migration | AC-27 | Legacy Tickets without Actions | Readable, resolvable, and counted by the dashboards as zero contributions | same | Planned |
| MIG-04 | Migration | §7 | Documented rollback | Dropping the table, enum and column restores the Lab 3 schema with Lab 3 data intact | same | Planned |
| MIG-05 | Migration | BR-32 | Seed idempotency | Running the seed twice changes nothing and keeps the Action mix of §7 | same | Planned |
| MIG-06 | Migration | §7 | Seed coverage | Tickets exist with zero, one and several Actions; at least one Action in each status; one Ticket resolved inside the weekly window | same | Planned |
| MIG-07 | Regression | AC-28, BR-32 | Lab 2 contract | Ticket creation, My Tickets queries, attachment rules and the 404-on-foreign-resource rule behave as `docs/lab-02/api-spec.md` describes | same | Planned |
| MIG-08 | Regression | AC-28, BR-32 | Lab 3 contract | Login, the password-change gate, the queue, ownership, comments, notes and user management behave as `docs/lab-03/api-spec.md` describes | same | Planned |
| MIG-09 | Regression | AC-28, BR-32 | The earlier suites themselves | The whole Lab 1, Lab 2 and Lab 3 server, client and Playwright suites pass unchanged on the Lab 4 branch | all existing suites | Planned |

### 2.7 Performance smoke — `server/tests/lab-04/performance.api.test.ts`

| ID | Type | Req / AC | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| PERF-01 | Perf | AC-26, BR-33 | Staff dashboard latency | Responds in under 500 ms on seeded data, measured server-side over 5 runs | `performance.api.test.ts` | Planned |
| PERF-02 | Perf | AC-26, BR-33 | Requester dashboard latency | Same budget | same | Planned |

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
| UI-DASHS-01 | UI | FR-12, FR-14 | Metric grid and lists | Six cards, the by-status strip and both Ticket lists render from the API payload, and a list row opens its Ticket | `StaffDashboard.test.tsx` | Planned |
| UI-DASHS-02 | UI | BR-21 | Zero metric | Renders `0` with its sub-line, still focusable and still a link | same | Planned |
| UI-DASHS-03 | UI | AC-17, FR-15 | Drill-down links | Each card's href carries the documented query | same | Planned |
| UI-DASHS-04 | UI | AC-18 | Administrator block | Rendered for an Administrator, absent for IT Staff | same | Planned |
| UI-DASHS-05 | UI | ui-spec §4.4, §5.2 | Loading and failure | Skeleton while loading; one error block with Retry on failure. Both dashboards render through the same state component, so this covers the Requester screen too | same | Planned |
| UI-DASHR-01 | UI | FR-17 | Three metric cards | Render from the payload with correct labels | `RequesterDashboard.test.tsx` | Planned |
| UI-DASHR-02 | UI | FR-18 | Attention panel | Combines waiting-for-me and resolved rows, each with its reason | same | Planned |
| UI-DASHR-03 | UI | AC-21 | Empty dashboard | Three zeros, the empty line, and a Create Ticket call to action | same | Planned |
| UI-DASHR-04 | UI | FR-19 | Drill-down links | Each card links into My Tickets with the matching filter | same | Planned |
| UI-FLOW-01 | UI | FR-08 | Status options | Only permitted transitions are offered for the current status | `TicketWorkflow.test.tsx` | Planned |
| UI-FLOW-02 | UI | AC-09 | Resolve blocked | With open Actions the option is disabled and explains why; a server 409 renders the conflict text | same | Planned |
| UI-FLOW-03 | UI | BR-16 | Terminal confirmations | Closed and Cancelled confirm before saving | same | Planned |
| UI-FLOW-04 | UI | BR-27 | Stale status write | The conflict block offers Reload and the select returns to the current status | same | Planned |
| UI-FLOW-05 | UI | FR-25 | Navigation | Dashboard is the first item and the landing route for all three roles | `AppShell.test.tsx` (lab-04) | Planned |

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
| AC-17 | UI-DASHS-03, E2E-06 |
| AC-18 | API-DASHS-08, UI-DASHS-04 |
| AC-19 | API-DASHR-01, API-DASHR-03, API-DASHR-04, UI-DASHR-01, UI-DASHR-02, UI-DASHR-04, E2E-07 |
| AC-20 | API-DASHR-02, API-FLOW-12 |
| AC-21 | API-DASHR-06, UI-DASHR-03, E2E-07 |
| AC-22 | API-DASHS-09, API-DASHS-10, API-DASHR-07, API-DASHR-08, E2E-08 |
| AC-23 | UI-DASHS-05 |
| AC-24 | UI-ACTION-06 |
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
| BR-05 | UNIT-01, API-ACTION-13, UI-ACTION-02 | BR-22 | API-DASHR-03, API-DASHS-03 |
| BR-06 | UNIT-02, API-ACTION-11, UI-ACTION-05 | BR-23 | API-DASHS-01, API-DASHR-01 |
| BR-07 | UNIT-03, API-ACTION-04, API-ACTION-05 | BR-24 | API-DASHS-02 |
| BR-08 | API-ACTION-01, UI-ACTION-01 | BR-25 | UNIT-06, API-DASHS-06 |
| BR-09 | UNIT-04, API-ACTION-09 | BR-26 | API-FLOW-09, API-FLOW-11, API-ACTION-21 |
| BR-10 | API-ACTION-03, UI-ACTION-04 | BR-27 | UI-ACTION-09, UI-FLOW-04 |
| BR-11 | API-ACTION-17, UI-ACTION-01 | BR-28 | API-FLOW-10, API-ACTION-22 |
| BR-12 | API-ACTION-20 | BR-29 | API-ACTION-03, API-ACTION-09 |
| BR-13 | API-ACTION-19 | BR-30 | API-ACTION-01, API-FLOW-14 |
| BR-14 | API-ACTION-14, API-ACTION-18, API-DASHS-09, API-DASHR-07 | BR-31 | UI-ACTION-06 |
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
| Server unit + API + workflow + dashboards + migration + perf | `npm test --prefix server` | — | Planned |
| Client UI components + accessibility | `npm test --prefix client` | — | Planned |
| E2E + visual | `npm run test:e2e` | — | Planned |

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

## 8. Known Limitations and Deferred Tests

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
