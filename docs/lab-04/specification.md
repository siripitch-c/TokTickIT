# TokTickIT — Lab 4 Sprint Specification

Sprint 4 of the CPE334 individual sprint workflow, and the last one. This
document is the engineering contract for the sprint: the coding agent may
report completion only when everything here and in §10 is satisfied.

Business rules and acceptance criteria are numbered from BR-01 and AC-01 within
this document. Where an earlier rule is referenced it is written as *Lab 2
BR-xx* or *Lab 3 BR-xx* so the four sprints stay distinguishable.

---

## 1. Sprint Goal

Turn the service desk from a place where tickets are discussed into a place
where work is recorded. IT Staff record **Actions Taken** under a Ticket — what
was done, when, by whom, with what result, and whether anything still needs
following up — and the Ticket's own lifecycle is finally closed off: the full
status transition matrix is enforced by the server, a Ticket cannot be reported
Resolved while work on it is still open, and two people editing the same Ticket
can no longer overwrite each other silently. On top of that work, Requesters
and IT Staff each get a dashboard that summarises their own reality in numbers
that come from the database rather than from the screen. Everything built in
Labs 1 to 3 keeps working, and the whole application is hardened for final
demonstration.

## 2. Stakeholder Request Interpretation

The stakeholder asked for three things, and they are not independent.

First, **the work itself has to be recorded**. Public Comments and Internal
Notes from Lab 3 are conversation; they do not say who went to the room, what
they replaced, or whether somebody has to come back on Monday. Actions Taken is
the work log: one Ticket, many actions, each owned by the staff member who will
carry it out, each with a result and an explicit follow-up flag. The Ticket
Owner still coordinates the Ticket as a whole, but the person who performs an
action is often somebody else, and the record must show that honestly.

Second, **the lifecycle has to become trustworthy**. If a Ticket can be marked
Resolved while two actions are still open, the status means nothing. The
stakeholder was explicit that a Requester's "problem appears resolved" is
advisory and that staff must review the work formally; the same sentence,
followed to its conclusion, says that the formal review cannot be a button that
ignores the work log. So resolution is gated on the work being finished or
deliberately cancelled, and the gate lives in the backend where a hand-made
request meets it too.

Third, **people need to see their own situation at a glance** without being
given a second application to learn. Dashboards here are summaries with links,
not new screens with new truths: every number is a query against the same data
the detailed screens show, and every card leads to the list that proves it.

Finally, this is the last sprint, so "finished" has to mean finished: no
leftover controls from Lab 2, no console errors, no screen that behaves
differently from its neighbour when the API is unreachable.

## 3. Scope

### Included

* Actions Taken under a Ticket: create, view, edit, complete and cancel, with
  the fields the handout names (§4.1) plus an assignee and a status of their
  own (§11).
* Authorization for Actions Taken: IT Staff and Administrator write, Requester
  reads the Actions on their own Tickets, enforced at the API.
* The final Ticket status transition matrix, enforced server-side, with the
  resolution gate that Lab 3 deferred.
* Stale-update detection on Ticket and Action writes, so a second writer cannot
  silently overwrite the first.
* IT Staff Dashboard: operational metric cards, the current user's open
  actions, recent and urgent Tickets, and drill-down into the existing queue.
* Requester Dashboard: the signed-in Requester's own counts, the Tickets that
  need their attention, recently updated and recently resolved Tickets, and
  drill-down into My Tickets.
* Administrator access to the IT Staff Dashboard, plus two account counts that
  only an Administrator sees.
* Seed data extended so every dashboard metric can be demonstrated both
  non-zero and zero, and so Tickets exist with zero, one and several Actions.
* Final hardening: duplicate-submit protection, consistent feedback states,
  removal of obsolete UI, performance smoke tests, and a current README.
* Regression evidence that every Lab 1 to Lab 3 behaviour still holds.

### Excluded

Taken from the handout's exclusion list (§4.2) and repeated here so the coding
agent does not build them:

* SLA clocks, escalation engines, on-call scheduling and breach notifications.
* Email, SMS, LINE, push or any other external notification service.
* Inventory, spare parts, purchasing and service cost accounting.
* Time-sheet billing, payroll and labour-cost calculation.
* Multi-level approval workflows and electronic signatures.
* Business-intelligence tooling, custom report builders and export warehouses.
* Multi-tenant organisations and production-scale cloud operations.
* Deleting an Action Taken (BR-13), deleting a user (Lab 3 BR-39), and deleting
  a Ticket — nothing in this product is destroyed, it is cancelled.
* Attachment upload on an Action. The handout asks for *Attachment Notes*, a
  text field telling a colleague which file to look for; it does not ask for a
  second upload path, and Ticket attachments already exist (§11).
* Dashboard date-range pickers, charts, and any metric not listed in BR-21.

## 4. Functional Requirements

### Actions Taken

* **FR-01**: The system shall let IT Staff and Administrators record an Action
  Taken against a Ticket they can reach, capturing the action date and time, a
  description, a result, the performer, an assignee, a follow-up flag, a
  follow-up note and attachment notes.
* **FR-02**: The system shall set *Performed by* from the authenticated session
  when an Action is created, and shall never accept it from the request body.
* **FR-03**: The system shall let IT Staff and Administrators update an Action
  that is still open, including reassigning it to another active IT Staff or
  Administrator.
* **FR-04**: The system shall let IT Staff and Administrators complete or
  cancel an Action, and shall treat both as final states.
* **FR-05**: The system shall require a follow-up note whenever an Action is
  marked as requiring follow-up, and shall reject the write otherwise.
* **FR-06**: The system shall display all Actions Taken of a Ticket to that
  Ticket's Requester in read-only form, with no create, edit, complete or
  cancel control, and shall refuse those operations at the API for a Requester.
* **FR-07**: The system shall list the Actions of a Ticket in a stable order
  that does not change between reads of unchanged data.

### Ticket workflow and resolution

* **FR-08**: The system shall offer, on the Ticket Detail screen, only the
  status transitions permitted from the Ticket's current status for the acting
  role, and shall enforce the same matrix at the API.
* **FR-09**: The system shall refuse to move a Ticket to Resolved while any of
  its Actions Taken is still Planned or In Progress, and shall say so.
* **FR-10**: The system shall keep the Requester's "problem appears resolved"
  signal advisory: it records a fact and a time and never changes the status.
* **FR-11**: The system shall detect a stale write — a Ticket or Action changed
  by somebody else since the caller read it — and refuse it instead of
  overwriting, telling the caller to reload.

### IT Staff dashboard

* **FR-12**: The system shall provide an IT Staff Dashboard showing the metrics
  defined in BR-21, each calculated by the backend from the live database.
* **FR-13**: The system shall show, on that dashboard, the Actions assigned to
  the signed-in user that are not yet finished.
* **FR-14**: The system shall show the most recently updated Tickets and the
  Tickets that most need attention, each row opening the Ticket.
* **FR-15**: The system shall make every metric card actionable: pressing it
  opens the Ticket Queue already filtered to the rows the card counted.
* **FR-16**: The system shall show an Administrator the IT Staff Dashboard plus
  the two account counts in BR-21, and shall show those counts to nobody else.

### Requester dashboard

* **FR-17**: The system shall provide a Requester Dashboard summarising only
  the authenticated Requester's own Tickets, with the metrics in BR-22.
* **FR-18**: The system shall highlight the Tickets that need the Requester's
  attention — those waiting for them and those resolved but not yet confirmed.
* **FR-19**: The system shall make the Requester's cards drill down into My
  Tickets with the matching filter applied.
* **FR-20**: The system shall derive the Requester's identity for every
  dashboard query from the session, ignoring any identifier in the request.

### Final hardening and regression

* **FR-21**: The system shall keep every Lab 1 to Lab 3 behaviour working:
  authentication and the password-change gate, Requester ticket screens,
  attachments, Public Comments, Internal Notes, the IT Staff queue and Ticket
  operations, and Administrator user management.
* **FR-22**: The system shall present loading, validation, success, empty,
  no-results, forbidden, not-found, conflict and safe-failure feedback
  consistently across every screen of the finished product.
* **FR-23**: The system shall prevent a repeated click or an automatic retry
  from creating a duplicate Action, Comment, Note or Ticket.
* **FR-24**: The system shall preserve what the user typed when a recoverable
  failure interrupts a submission.
* **FR-25**: The system shall ship with navigation that offers each role a
  Dashboard as its landing destination and marks the active page.
* **FR-26**: The system shall contain no obsolete, duplicate or placeholder
  control left over from earlier sprints, and no console error in normal use.

## 5. Business Rules

### Actions Taken — shape and authorship

* **BR-01**: An Action Taken belongs to exactly one Ticket and is never moved
  to another. (The handout names this rule.)
* **BR-02**: The Ticket Owner coordinates the Ticket, but an Action Taken may
  be performed by a different IT Staff member. Recording an Action does not
  change the Ticket's owner. (The handout names this rule.)
* **BR-03**: *Performed by* is the authenticated user at the moment of
  creation. It is never read from the request body and never changes
  afterwards, so the log cannot be rewritten to blame somebody else.
* **BR-04**: An Action carries an *assignee*: the active IT Staff or
  Administrator expected to carry it out. It defaults to the performer and may
  be changed while the Action is open. Assigning an inactive account, or an
  account whose role is Requester, is rejected — mirroring Lab 3 BR-25 for
  Ticket ownership. An account deactivated *after* assignment keeps the Action,
  exactly as Lab 3 BR-26 keeps a Ticket with its owner.
* **BR-05**: An Action has a status: **Planned**, **In Progress**, **Completed**
  or **Cancelled**. Permitted moves are Planned → In Progress, Planned →
  Cancelled, Planned → Completed, In Progress → Completed and In Progress →
  Cancelled. Completed and Cancelled are final: an Action is never reopened,
  because the honest record of a job that restarted is a new Action.
* **BR-06**: An Action's *result* may be empty while it is Planned or In
  Progress, and is required to complete it. Cancelling requires no result but
  does require a reason recorded in the description or follow-up note, so the
  log never contains a silent disappearance.
* **BR-07**: *Follow-up required* is a yes/no fact. When it is yes, the
  follow-up note is mandatory and must hold at least 5 characters; when it is
  no, any follow-up note already entered is discarded rather than kept
  invisibly. (The handout names the dependency.)
* **BR-08**: *Attachment notes* is free text describing which file a colleague
  should look for. It is never a file upload and never a link that the server
  fetches.
* **BR-09**: The action date and time is supplied by the person recording it,
  defaults to now, may not be in the future, and may not be earlier than the
  Ticket's creation time. A work log that claims an action before the problem
  was reported is wrong by construction.
* **BR-10**: Description is 5–2000 characters; result and attachment notes are
  0–2000; follow-up note is 0–1000 and 5–1000 when follow-up is required. Text
  is stored and rendered as literal text, never as markup.
* **BR-11**: Actions are listed oldest action-time first, with the row id as
  the tie-break, so two Actions recorded in the same second always appear in
  the order they were written (FR-07).
* **BR-12**: Creating or updating an Action never changes the Ticket's status.
  Status is changed only by the status endpoint, under BR-16.
* **BR-13**: An Action is never deleted. Cancelling is the only way to retire
  one, so the Ticket's history stays complete (continuing Lab 3 BR-39's
  reasoning for users).

### Who may do what

* **BR-14**: Actions Taken authorization, enforced at the API:

  | Operation | Requester | IT Staff | Administrator | Refusal for a caller not permitted |
  |---|---|---|---|---|
  | List the Actions of a Ticket | own Tickets | any Ticket | any Ticket | 404 on another Requester's Ticket (Lab 3 BR-16) |
  | Create an Action | no | yes | yes | 403 |
  | Update, complete or cancel an Action | no | yes | yes | 403 |
  | Be assigned an Action | no | yes, if active | yes, if active | 400 with the field named |

* **BR-15**: A Requester reaching the Actions of a Ticket they do not own is
  answered 404, never 403, exactly as Lab 3 BR-16 requires for the Ticket
  itself. The refusal must not reveal that the Ticket exists.

### Ticket status and resolution

* **BR-16**: The final transition matrix is the Lab 3 matrix, unchanged, and
  this document is now its authority:

  | From \ To | Open | In Progress | Waiting for Requester | Resolved | Closed | Reopened | Cancelled |
  |---|---|---|---|---|---|---|---|
  | **New** | yes | yes | — | — | — | — | yes |
  | **Open** | — | yes | yes | yes | — | — | yes |
  | **In Progress** | — | — | yes | yes | — | — | yes |
  | **Waiting for Requester** | — | yes | — | yes | — | — | yes |
  | **Resolved** | — | — | — | — | yes | yes | — |
  | **Closed** | — | — | — | — | — | yes | — |
  | **Reopened** | — | yes | yes | yes | — | — | yes |
  | **Cancelled** | — | — | — | — | — | — | — |

  A request for any transition not marked *yes* is rejected as a conflict.
* **BR-17**: Only IT Staff and Administrator may change a Ticket's status; a
  Requester has no transition available at all (Lab 3 BR-32).
* **BR-18**: **The resolution gate.** A Ticket may move to Resolved only when
  every one of its Actions Taken is Completed or Cancelled. A Ticket with an
  Action still Planned or In Progress is refused with a conflict naming how
  many Actions are still open. This is the rule Lab 3 deferred, and it is
  enforced in the backend so that a request made outside the screen meets it
  too (handout §4.5).
* **BR-19**: Cancelling a Ticket is **not** gated on its Actions. A cancelled
  Ticket is work abandoned, and forcing someone to tidy a log they are
  abandoning would only produce fictional entries; the Actions stay as they
  are, and the Ticket's cancellation is the explanation.
* **BR-20**: A Requester's "problem appears resolved" signal keeps every Lab 3
  rule: recorded once, with its time, on a Ticket that is not already Resolved,
  Closed or Cancelled, and it never changes the status (Lab 3 BR-34).

### Dashboard metrics

* **BR-21**: The IT Staff Dashboard shows exactly these metrics, each computed
  by the backend. "Open" means a status other than Resolved, Closed or
  Cancelled.

  | Metric | Calculation | Empty behaviour | Drill-down |
  |---|---|---|---|
  | Unassigned | open Tickets with no owner | card shows 0 and says the queue is clear | Queue filtered to owner = unassigned |
  | Assigned to me | open Tickets owned by the signed-in user | 0 with a neutral line | Queue filtered to owner = me |
  | My open actions | Actions assigned to the signed-in user with status Planned or In Progress | 0 with a neutral line | Queue filtered to the Tickets of those Actions |
  | Waiting for Requester | Tickets in Waiting for Requester | 0 | Queue filtered to that status |
  | High IT priority | open Tickets with IT Priority High | 0 | Queue filtered to IT Priority = High |
  | By status | one count per status, zero rows included | all zeros shown, never hidden | Queue filtered to the chosen status |
  | Resolved in the last 7 days | Tickets whose status became Resolved within the last 7 days, counted on Asia/Bangkok day boundaries | 0 | Queue filtered to Resolved |
  | Recently updated | the 10 most recently updated open Tickets | an empty-state line | each row opens its Ticket |
  | Needs attention | open Tickets with IT Priority High, oldest update first, 10 at most | an empty-state line | each row opens its Ticket |

  An Administrator additionally sees **Active users** and **Inactive users**,
  counted across all roles; no other role receives those two numbers.
* **BR-22**: The Requester Dashboard shows exactly these metrics, all scoped to
  the signed-in Requester:

  | Metric | Calculation | Empty behaviour | Drill-down |
  |---|---|---|---|
  | My open Tickets | own Tickets with an open status | 0 with an invitation to create one | My Tickets, default filter |
  | Waiting for me | own Tickets in Waiting for Requester | 0 | My Tickets filtered to that status |
  | Resolved, awaiting my confirmation | own Tickets in Resolved | 0 | My Tickets filtered to Resolved |
  | Recently updated | the 5 most recently updated own Tickets | empty-state line | each row opens the Ticket |
  | Recently resolved | the 5 own Tickets most recently moved to Resolved or Closed | empty-state line | each row opens the Ticket |

* **BR-23**: Dashboard endpoints return counts and short lists only — never a
  full Ticket collection — and never include another user's data. The Requester
  endpoint derives its identity from the session and ignores any identifier in
  the query string (FR-20), answering with the caller's own data rather than
  403, because there is nothing to disclose.
* **BR-24**: Every dashboard number is a query against the authoritative tables
  at request time. Nothing is cached, pre-aggregated or recomputed on the
  client, so a number can never disagree with the list it links to.
* **BR-25**: Where a metric has a date boundary it is evaluated in
  **Asia/Bangkok**, the timezone the service desk works in, so "the last 7
  days" does not change meaning because the server runs in UTC.

### Concurrency and conflict

* **BR-26**: Ticket and Action Taken each carry an integer `version` that
  starts at 1 and increases by one on every successful write. A write request
  carries the version the caller read; if it no longer matches, the write is
  refused as a conflict and nothing is changed.
* **BR-27**: The conflict response names the current version and tells the
  caller to reload. The interface reloads the record and shows what changed
  rather than silently resubmitting, so no edit is lost without somebody seeing
  it.
* **BR-28**: A request that omits the version is rejected with 400, not
  accepted as "no opinion" — an unconditional write is exactly the overwrite
  this rule exists to prevent.

### Validation, failure, hardening and regression

* **BR-29**: Every write endpoint validates server-side and answers 400 with
  the offending field named, independently of client-side validation (Lab 3
  BR-42).
* **BR-30**: An unexpected server error answers 500 with a generic message; no
  stack trace, SQL, file path or credential material reaches a client (Lab 3
  BR-43).
* **BR-31**: A repeated submission of the same create form — a double click, or
  a retry after a timeout — must not create two records. The interface disables
  its control for the duration of the request, and the API is written so that a
  retry is safe to make.
* **BR-32**: Every Lab 1 to Lab 3 behaviour continues to work, proven by the
  existing suites still passing plus the regression evidence in `tests.md`, not
  by inspection (continuing Lab 3 BR-44).
* **BR-33**: The dashboards answer within a documented budget on seeded data:
  the server responds to either dashboard endpoint in under 500 ms, measured by
  the performance-smoke test. The budget exists to catch an accidental N+1 or a
  missing index, not to benchmark the machine.
* **BR-34**: Seeded credentials remain development-only values documented in
  the README, and no secret is committed (Lab 3 BR-45).

## 6. UI Specification Summary

Full screen-by-screen detail is in `ui-spec.md`. In summary:

* **IT Staff Dashboard** — metric cards in a responsive grid, a *My open
  actions* panel, and two short Ticket lists (recently updated, needs
  attention). Every card is a link, not a decoration. Loading shows skeleton
  cards; a failed load shows the Lab 2 safe-failure block with Retry; a
  Requester reaching the route sees the forbidden state.
* **Requester Dashboard** — the same card language with the Requester's own
  counts, an *Attention required* panel combining "waiting for me" and
  "resolved, awaiting confirmation", and two short lists.
* **Actions Taken on Ticket Detail** — a new panel below Internal Notes for
  staff and below Public Comments for a Requester: a table on desktop, stacked
  cards below 768px, a create form that staff open from a single button, and
  per-row controls to edit, complete and cancel. The follow-up note field
  appears the moment *Follow-up required* is set to yes and is validated as
  mandatory from then on.
* **Ticket status control** — unchanged in appearance from Lab 3, but the
  option list is now the authority's list, Closed and Cancelled still confirm,
  and a refused resolution shows the conflict feedback with the number of open
  Actions.
* **Shell** — Dashboard becomes the landing destination for every role and the
  first navigation item; the active page is marked as it already is.
* **Zen Green** — no new colour, no new control vocabulary. Metric cards reuse
  the Lab 2 card, the Lab 3 badges and the existing focus treatment.

## 7. Data Changes

### New and changed models

* **ActionTaken** — `id`, `ticketId`, `actionAt`, `description`, `result`,
  `performedById`, `assignedToId`, `status` (enum `ActionStatus`),
  `followUpRequired`, `followUpNote`, `attachmentNotes`, `createdAt`,
  `updatedAt`, `version`. Indexed on `(ticketId, actionAt, id)` because the
  Ticket Detail screen always reads one Ticket's actions in that order
  (BR-11), and on `(assignedToId, status)` because the IT Staff Dashboard
  counts a person's unfinished actions on every load (BR-21).
* **ActionStatus** — a new Postgres enum with `PLANNED`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED` (BR-05). Created with the table, so unlike the Lab 3
  status extension it needs no migration of its own.
* **Ticket** — adds `version Int @default(1)` for BR-26. Nothing else changes:
  the eight statuses, `ownerId`, `itPriority` and `requesterResolvedAt` are
  already in place from Lab 3.
* **User** — unchanged. Two new back-relations only
  (`performedActions`, `assignedActions`).

Two design decisions are justified here, as the handout's §5.1 requires.

**Why an integer `version` column rather than comparing `updatedAt`.** Both
detect a stale write. `updatedAt` is free, but it is a timestamp: it travels to
the client as an ISO string, comes back as a string, and has to be compared
after parsing, where a millisecond lost in serialisation turns a correct write
into a spurious conflict — or worse, two writes inside the same clock tick
compare equal and both succeed. An integer is exact, is trivial to assert in a
test, and makes the conflict message meaningful ("you read version 3, the row
is at version 5"). The cost is one column per table and one `increment` in each
update, which Prisma expresses directly.

**Why Actions Taken is one table with a status rather than a table of open
actions and a table of history.** Splitting them would make "my open actions"
cheaper by one predicate and would make the Ticket's history a union of two
queries — which is the query that matters most, because the Ticket Detail
screen reads the whole log every time. A single table with
`@@index([ticketId, actionAt, id])` serves that read with one index scan, keeps
the id stable when an action completes (so the report's figures keep pointing
at the same row), and makes BR-13's "never deleted" trivially true.

### Migration and backfill

The migration adds rather than rewrites, so no existing row is at risk:

1. Create the `ActionStatus` enum and the `ActionTaken` table with its two
   indexes and its foreign keys to `Ticket` and `User`.
2. Add `Ticket.version` as `INTEGER NOT NULL DEFAULT 1`. Every existing Ticket
   is therefore at version 1, which is exactly what a client that has never
   seen the column will read and send back.
3. No data is copied, moved or deleted. Tickets created in Labs 2 and 3 simply
   have no Actions, and the application must behave correctly for them:
   * the Ticket Detail Actions panel shows its empty state (BR-21's empty
     behaviour applies to lists as well as counts);
   * the resolution gate (BR-18) passes trivially, because a Ticket with zero
     Actions has none that are open — a legacy Ticket can still be resolved;
   * dashboard counts treat them as zero contributions rather than skipping
     them, so "Assigned to me" still counts a legacy Ticket that has an owner.

### Rollback and recovery

The down path is written and tested rather than assumed: `DROP TABLE
"ActionTaken"`, `DROP TYPE "ActionStatus"`, and `ALTER TABLE "Ticket" DROP
COLUMN "version"`. It is reversible without data loss for everything that
existed before Lab 4 — only Lab 4's own Actions are lost, which is the
definition of rolling the sprint back. The migration test applies the Lab 4
migration to a database holding Lab 3 data, asserts the Lab 3 rows are intact,
applies the rollback statements, and asserts the schema and the Lab 3 data are
back as they were.

### Seed data

Idempotent and safe to re-run, as in every earlier sprint, and extended so that
every dashboard metric can be shown both non-zero and zero:

* the Lab 3 accounts, unchanged, so existing credentials keep working;
* Tickets across all eight statuses, both priorities, assigned and unassigned;
* at least one Ticket with **no** Actions, one with exactly **one**, and one
  with **several** Actions by different staff members (handout §5.3);
* at least one Action in each of the four statuses, including one assigned to
  somebody other than its performer and one requiring follow-up;
* at least one Ticket resolved within the last 7 days, so the weekly metric is
  non-zero, and one Requester with no Tickets at all, so the Requester
  dashboard's empty states can be demonstrated.

## 8. API Contract

Paths, shapes, status codes and error envelopes are in `api-spec.md`. In
summary the sprint adds:

* `GET /api/tickets/:id/actions` — the Ticket's Actions, role-aware;
* `POST /api/tickets/:id/actions` — create, staff only;
* `PATCH /api/actions/:id` — update, reassign, complete or cancel, staff only,
  version-checked;
* `GET /api/dashboard/staff` — the BR-21 metrics and lists;
* `GET /api/dashboard/requester` — the BR-22 metrics and lists.

`PATCH /api/tickets/:id/status`, `/owner` and `/it-priority` keep their Lab 3
paths and shapes but now require the Ticket's `version` in the body (BR-26,
BR-28) and may answer 409 for a stale write or for a refused resolution.
`GET /api/staff/tickets` gains two optional, lenient filters so the dashboard's
open-actions card can drill into the queue. `GET /api/health` is unchanged and
stays public. Every other endpoint from Labs 2 and 3 keeps its contract
unchanged.

## 9. Acceptance Criteria

* **AC-01**: Given an IT Staff user on a Ticket they can reach, when they
  record an Action with a description, a result and a date, then it is created
  under that Ticket with the signed-in user as performer.
* **AC-02**: Given a request body that names a different performer, when an
  Action is created, then the performer stored is still the authenticated user.
* **AC-03**: Given an Action marked as requiring follow-up with no follow-up
  note, when it is submitted, then the write is rejected with 400 naming the
  follow-up note field.
* **AC-04**: Given an inactive IT Staff account, when an Action is assigned to
  it, then the write is rejected and the Action keeps its previous assignee.
* **AC-05**: Given an Action in Planned, when it is completed with a result,
  then its status becomes Completed and no further transition is accepted.
* **AC-06**: Given an Action in Completed or Cancelled, when any update is
  attempted, then it is refused as a conflict.
* **AC-07**: Given a Requester viewing their own Ticket, when the Actions panel
  renders, then every Action is visible and no create, edit, complete or cancel
  control exists; and the corresponding API calls answer 403.
* **AC-08**: Given a Requester and a Ticket belonging to somebody else, when
  the Actions of that Ticket are requested, then the answer is 404.
* **AC-09**: Given a Ticket with an Action still Planned or In Progress, when
  staff move the Ticket to Resolved, then the move is refused with a conflict
  naming the number of open Actions, and the status is unchanged.
* **AC-10**: Given the same Ticket after every Action is Completed or
  Cancelled, when staff move it to Resolved, then the move succeeds.
* **AC-11**: Given a Ticket with open Actions, when staff cancel the Ticket,
  then the cancellation succeeds and the Actions are left as they are.
* **AC-12**: Given a transition the matrix does not permit, when it is
  requested directly at the API, then it is refused as a conflict and the
  status is unchanged.
* **AC-13**: Given two users reading the same Ticket, when the first saves and
  the second saves with the version they read, then the second is refused with
  409 and the first write survives.
* **AC-14**: Given a status write with no version field, when it is submitted,
  then it is rejected with 400.
* **AC-15**: Given an IT Staff user, when the staff dashboard is requested,
  then every metric in BR-21 is returned and each count equals the same query
  run directly against the database.
* **AC-16**: Given a staff user with Actions assigned to them, when the staff
  dashboard is requested, then the open-actions count includes only Planned and
  In Progress Actions assigned to that user.
* **AC-17**: Given a metric card, when it is activated, then the Ticket Queue
  opens with the filter that produced the number, and the queue's total matches
  the card.
* **AC-18**: Given an Administrator, when the staff dashboard is requested,
  then the active and inactive user counts are included; given IT Staff, then
  they are absent.
* **AC-19**: Given a Requester, when the requester dashboard is requested, then
  it contains only that Requester's Tickets, and a Ticket owned by another
  Requester appears in no count or list.
* **AC-20**: Given a Requester who passes another user's identifier to the
  requester dashboard, when the response is returned, then it is still their
  own data.
* **AC-21**: Given a Requester with no Tickets, when the requester dashboard is
  requested, then every count is zero and each list shows its empty state
  rather than an error.
* **AC-22**: Given an IT Staff user, when the requester dashboard endpoint is
  called, then it is refused with 403; and the same for a Requester calling the
  staff dashboard endpoint.
* **AC-23**: Given the API is unreachable, when either dashboard is opened,
  then a safe failure block with Retry is shown and no technical detail is
  exposed.
* **AC-24**: Given a create form submitted twice in quick succession, when the
  requests complete, then exactly one record exists.
* **AC-25**: Given a recoverable failure during a submission, when the error is
  shown, then every value the user typed is still in the form.
* **AC-26**: Given the seeded database, when either dashboard endpoint is
  called, then it answers within the budget in BR-33.
* **AC-27**: Given a Ticket created in Lab 2 or Lab 3 with no Actions, when it
  is opened, then the Actions panel shows its empty state and the Ticket can
  still be resolved.
* **AC-28**: Given the final `main` branch, when the Lab 2 and Lab 3 suites are
  run, then every one of them passes.
* **AC-29**: Given any role, when the application is used normally, then the
  navigation offers a Dashboard as that role's landing destination and marks
  the active page.
* **AC-30**: Given the finished product, when every screen is visited, then no
  obsolete control, placeholder text, broken link or console error appears.

## 10. Definition of Done

* All Functional Requirements (FR-01–FR-26) are implemented and manually
  verified against this document.
* All Business Rules (BR-01–BR-34) are implemented; each has at least one
  corresponding automated test per `tests.md`.
* Every Acceptance Criterion (AC-01–AC-30) is linked to passing, traceable test
  evidence.
* No required test is skipped, disabled, or commented out in the final `main`
  branch.
* `npm test` (server) and `npm test` (client) pass from a clean clone following
  the README setup steps, and the Playwright suite passes and fills all three
  screenshot directories the handout's §12 names: `staff-dashboard/`,
  `requester-dashboard/`, and `actions-taken/`.
* Every Lab 1, Lab 2 and Lab 3 test still passes, or is deliberately updated
  with the reason recorded in `tests.md`.
* The migration is proven: a database holding Lab 3 data gains the Lab 4 schema
  with every row intact, legacy Tickets behave as §7 describes, and the
  documented rollback restores the previous schema.
* Authorization is verified at the API, not through the interface: for Actions
  Taken and for each dashboard there is a test asserting the refusal for an
  unauthenticated caller and for an authenticated caller in the wrong role.
* The resolution gate and the stale-write refusal are both proven by tests that
  call the API directly, not only through a screen.
* No password, hash, session identifier, or stack trace appears in any API
  response or log line.
* The implemented screens conform to `ui-spec.md` and the Zen Green tokens, and
  both the visual checklist and the accessibility checklist in `tests.md` are
  completed at desktop, tablet and mobile for every new screen.
* The dashboards meet the performance budget in BR-33 on seeded data.
* README setup, seed, migration, test and demonstration instructions are
  current and match the final `main` branch.
* All nine Issues for this sprint are in the `Done` column of the Kanban board,
  each merged through a reviewed Pull Request into `lab4-staging`, with one
  final Pull Request merging `lab4-staging` into `main`.
* All six required documents exist under `docs/lab-04/`: `specification.md`,
  `tests.md`, `ui-spec.md`, `api-spec.md`, `reviewer.md`, `ai-use.md` — plus the
  test and screenshot directories named in the handout's §12.

## 11. Assumptions and Decisions

* **An Action carries its own status and assignee.** The handout's field list
  (§4.1, §8.3) names seven fields and none of them is a status, but the
  submission evidence for Part 6 asks for *assign*, *status transition*,
  *complete*, *cancel* and *inactive-assignee rejection*. Those five only mean
  something if an Action has an assignee and a lifecycle, so this specification
  gives it both. The seven named fields are all still present and unchanged.
* **The resolution gate is implemented here, not deferred again.** Lab 3's
  specification recorded it as "deferred to Lab 4" in its own exclusion list,
  and the handout's §4.5 requires the backend to enforce the resolution rule
  even when a client bypasses the screen. BR-18 is that rule.
* **Cancelling a Ticket is not gated.** The alternative — forcing every Action
  closed before a Ticket can be cancelled — produces invented log entries for
  work nobody did, which is worse than a cancelled Ticket with a Planned Action
  frozen beside it.
* **Optimistic concurrency, not locking.** A service desk has a handful of
  concurrent editors, not thousands; a row lock held across a human's thinking
  time is the wrong tool. Version checking costs one column and gives the user
  the honest message "somebody changed this, here is what it says now".
* **The version is required, not optional.** Accepting a write without a
  version would leave a silent overwrite available to anybody who simply omits
  the field, which is the hole the rule exists to close (BR-28).
* **Dashboards are read-only summaries.** No metric can be acted on from the
  card itself; the card links to the list where the action belongs. This keeps
  one place to change a Ticket and avoids a second authorization surface.
* **Metrics are computed per request.** Caching would create a window in which
  a number disagrees with the list behind it, and the data volumes here make
  the saving meaningless.
* **Asia/Bangkok for date boundaries.** The product is used in one timezone and
  the servers run in UTC; fixing the boundary in the specification is what
  stops "today" from meaning two different things (BR-25).
* **Attachment notes stays text.** The handout describes it as a note telling a
  colleague which file to look for, and Ticket attachments already exist from
  Lab 2. Adding a second upload path would duplicate storage, validation and
  removal rules for no requirement.
* **Lab 4 numbering restarts.** BR and AC numbers begin again at 01, as in
  Lab 3, and earlier rules are cited as *Lab 2 BR-xx* or *Lab 3 BR-xx* where
  continuity matters.
