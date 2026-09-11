# TokTickIT — Lab 3 Sprint Specification

Sprint 3 of the CPE334 individual sprint workflow. This document is the
engineering contract for the sprint: the coding agent may report completion only
when everything here and in §10 is satisfied.

Business rules and acceptance criteria are numbered from BR-01 and AC-01 within
this document. Where a Lab 2 rule is referenced it is written as *Lab 2 BR-xx*
to keep the two sprints distinguishable.

---

## 1. Sprint Goal

Replace the Lab 2 Development Requester selector with real authentication and
role-based authorization, and put the first operational IT Staff workflow and
Administrator user management on top of it. By the end of the sprint a person
signs in with an email address and password, is forced to replace an initial
password before reaching the application, and sees only the navigation and
operations their single role permits — enforced by the server, not by hidden
buttons. Requesters keep every Lab 2 ticket function under their authenticated
identity, IT Staff gain a shared Ticket Queue and an operational Ticket Detail
screen, and an Administrator can manage the accounts that make all of it work.

## 2. Stakeholder Request Interpretation

The stakeholder is asking for three things at once, and the order matters.

First, the temporary identity mechanism has to go. Lab 2 let the client name its
own Requester through a header; that was a development convenience and it is not
acceptable now that the system is meant to hold real work. Identity must come
from a credential the server verifies.

Second, the people who *do* the work need somewhere to do it. A Requester
raising a ticket is only half of a service desk; until IT Staff can find a
ticket, take responsibility for it, prioritise it, talk to the Requester and
record what they cannot say publicly, the product is a suggestion box rather
than a ticketing system.

Third, none of it functions without accounts, so an Administrator needs enough
user management to create people, give them one role, and disable them again —
deliberately no more than that. The stakeholder was explicit that hiding a
control is not a security decision, which is read here as: every rule in §5 is
implemented at the API, and the interface only reflects it.

## 3. Scope

### Included

* Email and password authentication, logout, and a current-user endpoint.
* Mandatory password change for any account flagged with an initial password.
* Three roles — Requester, IT Staff, Administrator — one role per user.
* Server-side authorization on every protected endpoint, plus ownership checks
  for Requester data.
* Migration of the Lab 2 Requester records into the authenticated User model
  with all Tickets and Attachments intact.
* Removal of the Development Requester selector, the `X-Requester-Id` header
  contract, and the client-side selection state.
* All Lab 2 Requester screens continuing to work under the authenticated
  identity.
* Public Comments on a Ticket, visible to Requester, IT Staff and Administrator.
* Internal Notes on a Ticket, visible to IT Staff and Administrator only.
* A Requester action indicating that the problem appears resolved.
* IT Staff Ticket Queue with search, filters, sorting and pagination.
* IT Staff Ticket Detail with ownership claim/reassign, IT Priority, and
  permitted status transitions.
* Administrator User Management: list, search, optional role filter, create,
  edit, one-role assignment, activation state, and setting a new initial
  password.

### Excluded

Taken from the handout's exclusion lists (§4.2, §8.5) and repeated here so the
coding agent does not build them:

* Email invitations, password-reset email, multi-factor authentication, social
  login, and single sign-on.
* Self-registration and Requester-created accounts.
* **Actions Taken** by IT Staff — deferred to Lab 4, along with the rule that
  would block resolution while Actions Taken remain incomplete.
* SLA calculation, escalation rules, and notification services.
* Dashboards and KPI analytics beyond simple queue counts.
* Multi-tenant organisations, departments, and customer administration.
* Production deployment or cloud infrastructure changes.
* Multiple roles per user.
* User deletion, bulk user operations, user import or export, and
  account-history screens.
* Profile photos and extended user-profile management.
* Account unlocking and administrator approval workflows.
* Pagination, multi-column sorting, and multiple simultaneous filters on the
  user list.
* Editing or deleting a Public Comment or an Internal Note — both are
  append-only in Lab 3.

## 4. Functional Requirements

### Authentication and session

* **FR-01**: The system shall provide a Login screen that accepts an email
  address and a password and reports failure without revealing which of the two
  was wrong.
* **FR-02**: The system shall establish an authenticated session on successful
  login and shall identify the caller of every subsequent request from that
  session rather than from any client-supplied value.
* **FR-03**: The system shall provide a current-user endpoint returning the
  authenticated user's id, name, email, role, active state, and password-change
  state.
* **FR-04**: The system shall provide a Logout action that invalidates the
  session server-side, after which the previous session can no longer be used.
* **FR-05**: The system shall force a user whose account is flagged as requiring
  a password change onto a Change Password screen, and shall keep every other
  application screen and protected endpoint unavailable until a valid new
  password is saved.
* **FR-06**: The system shall let any authenticated user change their own
  password on request, using the same screen, rules and endpoint as the
  mandatory change.

### Authorization

* **FR-07**: The system shall support three roles — Requester, IT Staff and
  Administrator — and shall carry the acting user's role into every
  authorization decision and every navigation decision. How a role is assigned,
  and the fact that a user holds exactly one, are BR-18.
* **FR-08**: The system shall enforce every role and ownership rule at the API,
  independently of whether the interface offers the control.
* **FR-09**: The system shall present role-appropriate navigation, showing no
  destination the authenticated role may not use.

### Requester continuation

* **FR-10**: The system shall let an authenticated Requester create a Ticket,
  list and search their own Tickets, and open a Ticket they own, with the same
  behaviour delivered in Lab 2.
* **FR-11**: The system shall let an authenticated Requester upload, download
  and soft-remove Attachments on Tickets they own, with the same behaviour
  delivered in Lab 2.
* **FR-12**: The system shall let a Requester record that the reported problem
  appears resolved on a Ticket they own, without changing the Ticket's status.

### IT Staff operations

* **FR-13**: The system shall provide an IT Staff Ticket Queue listing Tickets
  from every Requester, with search, filters, sorting and pagination, to IT
  Staff and Administrator.
* **FR-14**: The system shall let IT Staff and Administrator open any Ticket in
  an operational Ticket Detail screen.
* **FR-15**: The system shall let IT Staff and Administrator claim an unassigned
  Ticket, and reassign a Ticket to another active IT Staff or Administrator
  user.
* **FR-16**: The system shall provide IT Staff and Administrator with the list
  of users a Ticket may be assigned to, carrying only the identifying fields the
  reassign control needs and not the account data the Administrator user list
  returns.
* **FR-17**: The system shall let IT Staff and Administrator set the IT Priority
  of a Ticket independently of the Requested Priority submitted by the
  Requester.
* **FR-18**: The system shall let IT Staff and Administrator change a Ticket's
  status, accepting only those transitions BR-31 permits from its current
  status.
* **FR-19**: The system shall let a Requester, IT Staff or Administrator post a
  Public Comment on a Ticket they are permitted to see.
* **FR-20**: The system shall let IT Staff and Administrator post an Internal
  Note on any Ticket, and shall not disclose the existence of Internal Notes to
  a Requester.
* **FR-21**: The system shall let IT Staff and Administrator view and download
  the Attachments of any Ticket they may read, without granting them the upload
  or soft-remove actions that belong to the Ticket's Requester.

### Administrator user management

* **FR-22**: The system shall provide an Administrator User Management screen
  listing Name, Email, Role, Status, and an Edit action.
* **FR-23**: The system shall let an Administrator search users by name or email
  and optionally filter the list by role.
* **FR-24**: The system shall let an Administrator create a user with a name, an
  email address, one permitted role, an activation state, and an initial
  password that the new user must replace at first login.
* **FR-25**: The system shall let an Administrator edit a user's name, email
  address, role, and activation state.
* **FR-26**: The system shall let an Administrator set a new initial password on
  an existing account, which the account holder must replace at next login.

## 5. Business Rules

The five rules the handout names keep the handout's own identifiers (BR-01 to
BR-05) so a reader can match them at a glance; they are reproduced with their
meaning intact and placed with the topic they belong to. Every rule this sprint
adds is numbered from BR-06 upwards in the order it appears below, so the
document reads in sequence.

### Authentication and passwords

* **BR-01**: Only an active user with valid credentials may authenticate.
* **BR-02**: A user marked as requiring a password change cannot enter the
  normal application until a new valid password is saved. Exactly three
  operations stay available to them — read the current user, change the
  password, and log out — and every other endpoint and screen is refused until
  the change succeeds.
* **BR-06**: A failed login returns one message that does not distinguish an
  unknown email address from a wrong password, and does not reveal whether an
  account is inactive.
* **BR-07**: Passwords are stored only as a salted one-way hash. No endpoint,
  log line, or error message ever returns a password, a hash, or a session
  identifier.
* **BR-08**: A password must be 8–72 characters. The upper bound is bcrypt's own
  input limit, made explicit rather than silently truncating.
* **BR-09**: A new password must differ from the one it replaces, and the change
  form requires the value to be typed twice and to match.
* **BR-10**: Logout invalidates the session record on the server. A request
  replaying the old session afterwards is treated as unauthenticated.
* **BR-11**: A session expires 8 hours after it is issued. An expired session is
  treated as unauthenticated and is removed on next use.
* **BR-12**: Deactivating a user invalidates that user's existing sessions, so
  an account cannot keep working after it is disabled.
* **BR-13**: The current-user endpoint answers only from the session. It
  returns the id, name, email, role, active state and password-change state of
  the signed-in account, and nothing BR-07 forbids. With no valid session it
  answers 401 rather than an empty user, so the client cannot mistake "not
  signed in" for "signed in as nobody".
* **BR-14**: Repeated failed login attempts do not lock the account. Lab 3
  excludes account unlocking and administrator approval workflows (handout
  §4.2), and a lockout with no way to unlock would strand the user. Instead every failed
  attempt is answered by the same message after the same password-hash work, so
  a caller cannot tell a wrong password from an unknown address by timing, and
  failures are recorded in the server log for a human to notice.
* **BR-15**: The session cookie is `httpOnly`, `sameSite=lax` and `path=/`, and
  is marked `secure` outside development. `sameSite=lax` is the CSRF control:
  the browser will not attach the cookie to a state-changing request initiated
  by another site, so a form or script on a third-party page cannot act as a
  signed-in user. No separate CSRF token is introduced, and that choice is
  recorded in §11.

### Identity and ownership

* **BR-03**: The authenticated user identity, not a `requesterId` supplied by
  the client, determines ownership of Requester operations.
* **BR-16**: A Requester may read or modify only Tickets they submitted and
  Attachments belonging to those Tickets. A Ticket or Attachment belonging to
  another user answers exactly as one that does not exist (404), so its
  existence is never revealed. This continues Lab 2 BR-11 and Lab 2 BR-12
  under the authenticated identity.
* **BR-17**: IT Staff and Administrator may read any Ticket. The Requester
  ownership restriction applies to the Requester role only.

### Roles and access

* **BR-18**: A user has exactly one role. Role is assigned by an Administrator
  and is never chosen or changed by the user themselves.
* **BR-19**: An unauthenticated request to a protected endpoint answers 401. An
  authenticated request from a role that may not perform the operation answers
  403 — except where answering at all would disclose the existence of protected
  data, in which case it answers 404 (see BR-16 and BR-20).
* **BR-20**: Internal Notes are never disclosed to a Requester. A Requester
  requesting Internal Notes receives 404, not 403, because 403 would confirm
  that notes exist.

### Authorization matrix

Every cell is enforced by the API. The interface only reflects it (FR-08).

| Operation group | Requester | IT Staff | Administrator | Refusal for a caller not permitted |
|---|---|---|---|---|
| Log in, log out, current user, change own password | yes | yes | yes | 401 |
| Create a Ticket | yes | no | no | 403 |
| List / read own Tickets and their Attachments | own only | no | no | 403 for another role; 404 on another user's Ticket |
| Upload and soft-remove Attachments | own Tickets | no | no | 403 for another role; 404 on another user's Ticket |
| View and download Attachments | own Tickets | any Ticket | any Ticket | 404 on another user's |
| Post a Public Comment | own Tickets | any Ticket | any Ticket | 404 on another user's |
| Mark "problem appears resolved" | own Tickets | no | no | 403 for another role; 404 on another user's Ticket |
| IT Staff Ticket Queue | no | yes | yes | 403 |
| Read any Ticket for operations | no | yes | yes | 404 — a Requester reaching another user's Ticket is answered as row 3 |
| Claim / reassign Ticket ownership | no | yes | yes | 403 |
| List assignable Ticket owners | no | yes | yes | 403 |
| Set IT Priority | no | yes | yes | 403 |
| Change Ticket status | no | yes | yes | 403 |
| Read or post Internal Notes | no | yes | yes | **404**, never 403 (BR-20) |
| List / search users, create, edit, set initial password | no | no | yes | 403 |

Two cells deserve their reason in writing. Requester operations answer **404**
rather than 403 on another user's resource, because 403 would confirm that the
resource exists (BR-16). Internal Notes answer 404 for a Requester for the same
reason, and the handout names Internal Notes explicitly among the things whose
existence must not leak (§6.2). Administrators appear in the Ticket operation
rows because the handout's §4.5 states that a Ticket Owner may be an
Administrator and that IT Priority may be changed by "IT Staff or
Administrator" — and they appear in the Queue row for the same reason: a role
that may own a Ticket has to be able to find one. Withholding the queue while
granting the operations would leave an Administrator able to act only on
Tickets whose identifiers they already knew.

### Comments and notes

* **BR-04**: Public Comments are visible to the Requester, IT Staff, and
  Administrator. Internal Notes are visible only to IT Staff and Administrator.
* **BR-21**: Public Comments and Internal Notes are append-only. Editing and
  deletion are out of scope for Lab 3.
* **BR-22**: Each Public Comment and Internal Note records its author and its
  creation time from the server. Neither is supplied by the client.
* **BR-23**: Comment and note bodies are required, trimmed, and 1–2000
  characters. Whitespace-only content is rejected. The upper bound is the same
  2000 characters Lab 2 allows for a Ticket description, so nobody has to learn
  two limits for long-form text. The lower bound is 1 rather than the 10 Lab 2
  requires of a description, because "Done." is a legitimate comment while a
  ten-character problem report is not.
* **BR-24**: Comment and note bodies are rendered as plain text. No markup from
  a user is interpreted, so a comment cannot inject content into another user's
  screen.

### Ticket ownership, priority and status

* **BR-05**: A Requester may indicate that the problem appears resolved, but
  cannot formally set the Ticket to Resolved or Closed.
* **BR-25**: A Ticket has zero or one Ticket Owner. The constraint is checked
  **when ownership is assigned**: only an active IT Staff or Administrator user
  may be chosen. It is not a standing invariant on the row, because an account
  can be deactivated after it was assigned — BR-26 says what happens then.
* **BR-26**: Deactivating a user does not clear the Tickets they own. The
  Ticket keeps its owner so the record stays true, the queue continues to show
  that owner, and any IT Staff or Administrator may reassign it under BR-28.
  The deactivated account simply stops being offered as a target for a new
  assignment.
* **BR-27**: A Ticket created by a Requester starts unassigned with status New.
* **BR-28**: Any IT Staff or Administrator may claim an unassigned Ticket, and
  may reassign an assigned Ticket to another active IT Staff or Administrator.
  Ownership is not exclusive to the current owner, because a service desk has to
  keep working when someone is away.
* **BR-29**: Requested Priority is the value the Requester submitted and is never
  changed after creation. IT Priority is initialised from Requested Priority when
  the Ticket is created and may afterwards be changed only by IT Staff or
  Administrator.
* **BR-30**: The Ticket statuses are New, Open, In Progress, Waiting for
  Requester, Resolved, Closed, Reopened, and Cancelled.
* **BR-31**: Status changes follow this matrix, and a request for any transition
  not listed is rejected as a conflict:

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

* **BR-32**: Only IT Staff and Administrator may change status. A Requester has
  no status transition available at all.
* **BR-33**: Moving a Ticket to Closed or Cancelled requires a confirmation step
  in the interface, because both are effectively terminal — Cancelled has no
  outgoing transition and Closed leads only back to Reopened.
* **BR-34**: A Requester marking a problem as appearing resolved records the
  fact and the time against the Ticket and is visible to IT Staff. It does not
  change the status; it can be recorded only on a Ticket that is not already
  Resolved, Closed or Cancelled; and it can be recorded only once, because it is
  a fact with a time rather than a toggle — a second attempt is rejected instead
  of overwriting when the Requester first said it.

### Administrator rules

BR-35 bounds what an Administrator may do; BR-36 to BR-39 are the four safety
rules that stop those operations from breaking the system that grants them.

* **BR-35**: Administrator authority over accounts is exactly three operations,
  and the system offers no fourth:
  * **create** a user with a name, an email address, exactly one permitted role
    (BR-18), an activation state, and an initial password;
  * **update** a user's name, email address, role, and activation state; and
  * **set a new initial password**, which flags the account as requiring a
    password change at next login.

  The handout's §4.4 fixes this list, and nothing here widens it: no user
  deletion (BR-39), no bulk operation, no second role, no account-recovery
  workflow.
* **BR-36**: Email addresses are trimmed and unique across users, compared
  case-insensitively. A duplicate is rejected as a conflict rather than silently
  accepted. Login applies the same normalisation, so an address typed with
  different capitalisation still identifies the account.
* **BR-37**: An Administrator cannot deactivate their own account, and cannot
  change their own role away from Administrator. Both actions would remove the
  acting user's own access, and the second is only self-deactivation by another
  route.
* **BR-38**: The system must always retain at least one active Administrator.
  Deactivating or re-roling the last active Administrator is rejected.
* **BR-39**: Users are never deleted. Deactivation is the only removal mechanism,
  so Tickets, Comments and Notes keep a valid author.

### Queue and list query behaviour

* **BR-40**: Every IT Staff Ticket Queue query parameter is lenient. An
  unrecognised or invalid value falls back to its default instead of failing the
  request, continuing Lab 2 BR-18 so that a hand-edited URL cannot break the
  queue. Searchable fields are Ticket Number and Summary; filterable fields are
  Category, Requested Priority, IT Priority, Current Status and Ticket Owner
  (including an explicit "unassigned" choice); sortable fields are Ticket
  Number, Created Date, Last Updated and IT Priority. The default ordering is
  Last Updated descending, because a work queue is read newest-activity-first
  rather than newest-created-first. Page sizes are 10, 25 and 50 with a default
  of 25, larger than the Requester list's default of 10 because a shared queue
  is scanned rather than browsed. The response carries the same pagination
  metadata shape Lab 2 established.
* **BR-41**: The Administrator user list is searched by name or email and
  optionally filtered by exactly one role. It is not paginated and not
  multi-column sorted, both of which the handout excludes; it is ordered by name
  ascending so a person can find an account by eye.

### Validation, failure and regression

* **BR-42**: Every write endpoint validates its input server-side and answers 400
  with the offending field named, independently of any client-side validation.
* **BR-43**: An unexpected server error answers 500 with a generic message. No
  stack trace, database error, file path, or password material reaches a client.
* **BR-44**: Every Lab 2 Requester behaviour continues to work after migration:
  ticket numbering, the list query contract, attachment limits and types, soft
  removal, and the 404-on-foreign-resource rule. Regression is proven by tests,
  not by inspection.
* **BR-45**: Seeded credentials exist for local development only, are documented
  in the README, and are never real personal passwords. No authentication
  secret — session signing material, hash configuration, or database
  credentials — is committed to the repository or shipped to client code; each
  is read from the environment, and `.env` stays ignored as it is in Lab 2.

## 6. UI Specification Summary

Full screen-by-screen detail is in `ui-spec.md`. In summary:

* **Login** — email, password, inline validation, busy state on submit, and one
  safe failure message (BR-06).
* **Change Password** — reached only when the account requires it, blocks every
  other destination, requires the new password twice, and continues into the
  application on success.
* **Application shell** — replaces the Lab 2 Requester selector display with the
  authenticated user's name and role badge, plus a Logout action. Navigation
  shows only what the role may use (FR-09).
* **Requester screens** — My Tickets, Create Ticket and Ticket Detail carried
  over from Lab 2, with the Change Requester action removed, plus Public
  Comments and the "problem appears resolved" action on Ticket Detail.
* **IT Staff Ticket Queue** — a table on desktop and cards below 768px, with
  search, filters, sorting, pagination, ownership and status/priority badges,
  and distinct loading, empty, no-results, forbidden and failure states.
* **IT Staff Ticket Detail** — the Lab 2 Ticket Detail plus an operations panel
  (owner, IT Priority, status), a Public Comments thread, and a visually
  separated Internal Notes thread.
* **Administrator User Management** — one screen: list, search, optional role
  filter, and create/edit dialogs that carry the role, the activation state and
  a separate set-new-initial-password action. The list itself has no sortable
  headers, no pagination and no inline controls beyond Edit, because the handout
  excludes all three.

Each screen has an explicit set of modes rather than one page that changes
shape: Login and Change Password are single-purpose forms; My Tickets, the
Ticket Queue and User Management are **list** screens; Create Ticket and the
Administrator create/edit dialogs are **create** and **edit** modes; Ticket
Detail is a **view** screen with individually editable operational fields
(owner, IT Priority, status) rather than a whole-form edit mode. Across all of
them the handout's feedback conditions (§8.6) are covered by shared states —
processing, validation, success, empty, no-results, forbidden, not-found,
conflict, and safe API failure — reusing the Lab 2 state components so that a
conflict on a status change and a conflict on a duplicate email look alike.

The Zen Green tokens, form conventions, badge styles, editable versus
read-only field styling, validation placement, responsive breakpoints and
accessibility rules from Lab 2 `ui-spec.md` remain in force unchanged. Badges
are extended to cover role, IT Priority and the eight Ticket statuses using the
existing badge component. New screens reuse the existing components rather than
introducing a second visual system.

## 7. Data Changes

### New and changed models

* **User** — evolved from the Lab 2 `Requester` model, keeping the same primary
  keys so that `Ticket.requesterId` continues to resolve without rewriting
  ticket rows. Fields: `id`, `name`, `email`, `passwordHash`, `role` (enum
  `REQUESTER` | `IT_STAFF` | `ADMINISTRATOR`), `isActive`, `mustChangePassword`,
  `createdAt`, `updatedAt`. Of these, `name`, `email`, `isActive` and `createdAt`
  already exist on `Requester`; the other four are new, and `updatedAt` in
  particular does **not** exist in Lab 2 — the Lab 2 schema carries `updatedAt`
  only on `Ticket`, so it must be added with `@default(now())` alongside
  `@updatedAt` or the migration cannot backfill the existing rows.
* **Case-insensitive email** is a behaviour, not a column type. Postgres
  `UNIQUE` is case-sensitive and Prisma's schema language cannot express a
  functional index, so BR-36 is delivered by storing `email` already trimmed and
  lower-cased, normalising on every write and on login, and keeping the plain
  `@unique` constraint — which is then sufficient. A `citext` column or a
  hand-written `UNIQUE (lower(email))` index would work too; this specification
  chooses normalisation-on-write because it needs no extension and no
  hand-edited index, and the same normalisation is what login already has to do
  (BR-36).
* **Session** — `id` (opaque random token, primary key), `userId`, `createdAt`,
  `expiresAt`. Indexed on `userId` so deactivating a user can drop every session
  it owns (BR-12).
* **Ticket** — adds `ownerId` (nullable FK to User, indexed),
  `requesterResolvedAt` (nullable) for BR-34, and expands `currentStatus` from
  the Lab 2 single-value enum to the eight values in BR-30. `itPriority` already
  exists from Lab 2 and becomes populated rather than always null.
* **PublicComment** — `id`, `ticketId`, `authorId`, `body`, `createdAt`.
  Indexed on `ticketId` (both threads are always read one Ticket at a time),
  following the Lab 2 `Attachment` model.
* **InternalNote** — `id`, `ticketId`, `authorId`, `body`, `createdAt`, indexed
  on `ticketId` for the same reason.

Public Comments and Internal Notes are two tables rather than one table with a
visibility flag. The separation is the point: a query that forgets a `WHERE
visibility = 'public'` clause would leak private notes, and no query against
`PublicComment` can leak anything, whatever it forgets.

### Migration from Lab 2

The Lab 2 `Requester` rows carry live Tickets and Attachments, so they are
evolved in place rather than replaced:

1. Rename the `Requester` table to `User`, preserving every id and the existing
   foreign key from `Ticket`. **The generated migration must be edited by hand.**
   Renaming a model in `schema.prisma` makes `prisma migrate dev` emit
   `DROP TABLE "Requester"` followed by `CREATE TABLE "User"`, which destroys
   every row and every Ticket relation with them. The SQL is replaced with
   `ALTER TABLE "Requester" RENAME TO "User";` before the migration is applied,
   and MIG-01 and MIG-02 exist to prove the rows survived.
2. Add `passwordHash`, `role`, `mustChangePassword` and `updatedAt`. Every one
   of them needs a default, because the table is not empty: `role` defaults to
   `REQUESTER`, `mustChangePassword` to `true`, `updatedAt` to `now()`, and
   `passwordHash` is added nullable, filled by step 3, and only then made
   required. The existing `isActive` column is kept as it is.
3. Backfill every migrated row with `role = REQUESTER`, `mustChangePassword =
   true`, and the hash of a documented development initial password, so that no
   migrated account can be used without setting a real password first.
4. Backfill `Ticket.itPriority` from `Ticket.requestedPriority` for existing
   rows, satisfying BR-29 for tickets created before this sprint.
5. Leave `Ticket.ownerId` null for existing rows — they are unassigned until IT
   Staff claim them, which is the correct starting state under BR-27.
6. Lower-case every existing `email` in the same step, so the normalisation
   BR-36 relies on holds for migrated rows too.

The seven new `CurrentStatus` values are added to the existing Postgres enum
with `ALTER TYPE ... ADD VALUE`. Postgres will not let a value added inside a
transaction be *used* in that same transaction, so the enum extension is its own
migration, separate from any migration that writes one of the new values.

No Ticket, Attachment, Category, RelatedSystem, or TicketNumberCounter row is
deleted or rewritten by the migration.

### Seed data

Idempotent and safe to re-run, as in Lab 2:

* at least 4 active Requester accounts and 1 inactive Requester account;
* at least 3 active IT Staff accounts and 1 inactive IT Staff account;
* at least 1 active Administrator account;
* Tickets spread across Requesters, statuses, priorities, and both assigned and
  unassigned ownership; and
* example Public Comments and Internal Notes containing nothing sensitive.

Seeded passwords are development-only values recorded in the README (BR-45).

## 8. API Contract

Endpoint paths, request and response shapes, status codes and error envelopes
are in `api-spec.md`. In summary the sprint adds:

* `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, and
  `POST /api/auth/change-password`;
* IT Staff queue retrieval and single-ticket retrieval;
* the list of users a Ticket may be assigned to (FR-16);
* ticket ownership, IT Priority and status endpoints;
* Public Comment and Internal Note creation and retrieval;
* the Requester "problem appears resolved" endpoint; and
* Administrator user list, create, update, and set-initial-password endpoints.

Every Lab 2 ticket and attachment endpoint keeps its path and response shape but
takes its Requester identity from the session instead of the `X-Requester-Id`
header, which is removed. `GET /api/requesters` is deleted outright: it existed
only to populate the Development Requester selector, and it returned a list of
real people to any caller (AC-25).

Authentication uses an opaque session identifier in an `httpOnly`, `sameSite=lax`
cookie. The session record lives in the database so that logout and deactivation
can invalidate it immediately. Every protected endpoint distinguishes 401
(unauthenticated), 403 (authenticated but forbidden), 400 (invalid input), 404
(missing, or hidden by BR-16/BR-20), 409 (conflict) and 500 (unexpected).

## 9. Acceptance Criteria

The first four are the criteria named in the handout.

* **AC-01**: Given an active user with valid credentials, when the user logs in,
  then the backend establishes authenticated access and returns the permitted
  user identity and role.
* **AC-02**: Given a user who must change the initial password, when login
  succeeds, then normal application screens remain unavailable until a valid new
  password is saved.
* **AC-03**: Given an authenticated Requester, when the client supplies another
  `requesterId`, then the backend still applies the authenticated identity and
  does not return another Requester's data.
* **AC-04**: Given a Requester account, when an Internal Note endpoint is
  requested, then the operation is rejected without exposing note content.
* **AC-05**: Given an inactive account with otherwise valid credentials, when
  login is attempted, then it fails with the same message a wrong password
  produces and no session is created.
* **AC-06**: Given an authenticated session, when the user logs out and the
  previous session is replayed, then the request is treated as unauthenticated.
* **AC-07**: Given an authenticated Requester, when they open the application,
  then no IT Staff or Administrator destination appears in the navigation and a
  direct request to those endpoints is refused by the server.
* **AC-08**: Given a Ticket created in Lab 2, when its Requester signs in after
  migration, then the Ticket, its number, and its Attachments are unchanged and
  still owned by that Requester.
* **AC-09**: Given an IT Staff user, when they open the Ticket Queue, then
  Tickets from every Requester are listed with ownership, status and priority,
  and search, filters, sorting and pagination behave as specified.
* **AC-10**: Given an unassigned Ticket, when an IT Staff user claims it, then
  they become the Ticket Owner and the change is visible to other IT Staff.
* **AC-11**: Given an assigned Ticket, when an IT Staff user reassigns it to
  another active IT Staff or Administrator user, then ownership moves, and
  neither an inactive user nor a Requester can be chosen.
* **AC-12**: Given a Ticket, when IT Staff set IT Priority, then the value
  changes and Requested Priority is untouched.
* **AC-13**: Given a Ticket in a given status, when a transition not permitted by
  BR-31 is requested, then the backend rejects it as a conflict and the status is
  unchanged.
* **AC-14**: Given a Requester on a Ticket they own, when they post a Public
  Comment, then it appears for the Requester, IT Staff and Administrator with
  the author and server-recorded time.
* **AC-15**: Given IT Staff on any Ticket, when they post an Internal Note, then
  it is visible to IT Staff and Administrator and absent from every Requester
  response for that Ticket.
* **AC-16**: Given a Requester on a Ticket they own, when they indicate the
  problem appears resolved, then the fact is recorded and visible to IT Staff
  while the Ticket status is unchanged.
* **AC-17**: Given an Administrator, when they create a user with an email that
  already exists, then the request is rejected as a conflict and no user is
  created.
* **AC-18**: Given an Administrator, when they set a new initial password on an
  account, then that account is forced through Change Password at its next login.
* **AC-19**: Given the only active Administrator, when deactivation or a role
  change is attempted on that account, then the request is rejected and the
  account remains an active Administrator.
* **AC-20**: Given an Administrator, when they attempt to deactivate their own
  account, then the request is rejected.
* **AC-21**: Given a non-Administrator, when any user-management endpoint is
  requested, then the request is refused by the server regardless of what the
  interface shows.
* **AC-22**: Given an Administrator, when they create a user with a name, an
  email address, one permitted role and an activation state, then the account
  appears in the list with that role and must change its password at first
  login.
* **AC-23**: Given an Administrator, when they edit another user's name, email
  address, role or activation state, then the change is saved and the list
  reflects it.
* **AC-24**: Given an active user with a live session, when an Administrator
  deactivates that account, then the existing session stops working and the
  account can no longer log in.
* **AC-25**: Given the migrated application, when a client looks for the Lab 2
  identity mechanism, then none of it is left: the Requester-selection route is
  gone, the selector and its stored client-side state are gone, and
  `GET /api/requesters` no longer exists. That the `X-Requester-Id` header is
  ignored when sent is AC-03; this criterion is about the removal itself.
* **AC-26**: Given an IT Staff user on a Ticket they do not own, when they open
  its Ticket Detail, then the Requester's Attachments are listed and can be
  downloaded, while the upload and remove actions are absent and refused by the
  server.
* **AC-27**: Given an Administrator on the user list, when they search by part
  of a name or email address and optionally choose a role, then only matching
  accounts are listed and clearing the search restores the full list.
* **AC-28**: Given the IT Staff Ticket Queue, when a query parameter carries an
  unrecognised value, then the queue answers with that parameter's default
  rather than an error.

## 10. Definition of Done

* All Functional Requirements (FR-01–FR-26) are implemented and manually
  verified against this document.
* All Business Rules (BR-01–BR-45) are implemented; each has at least one
  corresponding automated test per `tests.md`.
* Every Acceptance Criterion (AC-01–AC-28) is linked to passing, traceable test
  evidence.
* No required test is skipped, disabled, or commented out in the final `main`
  branch.
* `npm test` (server) and `npm test` (client) pass from a clean clone following
  the README setup steps, and the Playwright suite passes and fills all four
  screenshot directories the handout's §12 names: `authentication/`,
  `staff-queue/`, `staff-ticket-detail/`, and `user-management/`.
* Every Lab 2 test still passes, or is deliberately updated with the reason
  recorded — the Requester header contract is gone, so tests that asserted it
  are expected to change.
* Migration is proven: a database holding Lab 2 data can be migrated and every
  pre-existing Ticket and Attachment remains readable by its original owner.
* Authorization is verified at the API, not through the interface: for each
  protected group there is a test asserting the refusal for an unauthenticated
  caller and for an authenticated caller in the wrong role.
* No password, hash, session identifier, or stack trace appears in any API
  response or log line.
* The implemented screens conform to `ui-spec.md` and the Zen Green tokens, and
  the responsive and accessibility checklist carried over from Lab 2 is
  completed at desktop, tablet and mobile for every new screen.
* README setup/test instructions are current, document the seeded development
  credentials, and match the final `main` branch.
* All eight Issues for this sprint are in the `Done` column of the Kanban board,
  each merged through a reviewed Pull Request into `lab3-staging`, with one final
  Pull Request merging `lab3-staging` into `main`.
* All six required documents exist under `docs/lab-03/`: `specification.md`,
  `tests.md`, `ui-spec.md`, `api-spec.md`, `reviewer.md`, `ai-use.md` — plus the
  test and screenshot directories named in the handout's §12.

## 11. Assumptions and Decisions

* **Session cookie rather than a bearer token.** The handout requires logout
  invalidation. A signed token cannot be revoked without a server-side blocklist,
  which reintroduces the state the token was meant to avoid; a session row can be
  deleted. An `httpOnly` cookie also keeps the credential out of reach of any
  script on the page, which matters more in Lab 3 than in Lab 2 because comments
  and notes put user-authored text on the screen. The cost is CORS
  configuration — the client on port 5173 and the API on port 3000 are separate
  origins, so the API sets an explicit origin with `credentials: true` and the
  client sends `credentials: 'include'`.
* **`bcryptjs` rather than `argon2`.** Argon2 is the stronger algorithm on
  paper, but the npm package compiles a native module, and this project has
  already lost time to native tooling on Windows. `bcryptjs` is pure JavaScript,
  installs without a build step, and remains an accepted password hash. The work
  factor is 10 in development and 4 under test, because the suites create many
  accounts and a 100 ms hash would dominate their runtime; the reduced factor is
  a test-speed decision and never applies to a real environment.
* **`sameSite=lax` instead of a CSRF token.** The handout asks for CSRF
  considerations "where applicable". A lax cookie is not sent on cross-site
  state-changing requests, which removes the attack for this application; the
  client and the API differ only by port, so they remain same-site and normal
  use is unaffected. A synchroniser token would add a second mechanism to build
  and test for no gain at this scope, so it is deliberately not used.
* **Eight-hour session lifetime.** Long enough for a working day, short enough
  that an abandoned session on a shared machine expires the same day.
* **Ownership is not exclusive.** Any IT Staff member may reassign a Ticket, not
  only its current owner, because a service desk must keep moving when the owner
  is unavailable. The alternative — only the owner may hand a Ticket over —
  produces tickets that nobody can touch.
* **Cancelled is terminal and Closed is not.** A cancelled Ticket was raised in
  error or duplicated, so reviving it would blur why it was cancelled; a new
  Ticket is the honest record. A closed Ticket, by contrast, is routinely
  reopened when the Requester finds the problem is still there.
* **A Requester cannot change status at all.** BR-05 forbids Resolved and
  Closed. Allowing the other transitions would give a Requester operational
  control of the queue, so the resolution signal (BR-34) is a separate fact
  rather than a status.
* **Two tables for comments and notes** rather than one table with a visibility
  column, so that a forgotten filter cannot leak an Internal Note.
* **Administrators may perform Ticket operations.** The handout's §4.3 asks that
  the roles stay conceptually separate, but its §4.5 states that a Ticket Owner
  may be an
  Administrator and that IT Priority may be changed by "IT Staff or
  Administrator". The authorization matrix therefore grants Administrators the
  Ticket operations the handout names — including the queue they would need to
  reach a Ticket — and nothing further. The separation the handout asks for is
  kept in the interface: User Management is the Administrator's landing
  destination, and the queue is reached deliberately rather than presented as
  their daily work.
* **Migration renames rather than recreates.** Copying Requesters into a new
  table would require rewriting every `Ticket.requesterId`. Renaming the table
  keeps every id, which is why AC-08 can assert that Lab 2 Tickets are untouched.
* **Lab 3 numbering restarts.** BR and AC numbers begin again at 01 in this
  document, as the handout instructs. Lab 2 rules are referenced as *Lab 2
  BR-xx* where continuity matters.
