# Lab 3 Test Plan and Results

This plan is written **before** implementation, alongside `specification.md`,
`api-spec.md` and `ui-spec.md`. It is not a report reconstructed from whatever
tests were eventually generated: the Status column starts at *Planned* for every
row and is updated as each test is written and passes.

## 1. Test Strategy

- **Unit tests** cover pure logic with no I/O — password hashing, the status
  transition matrix, session expiry arithmetic, email normalisation. No
  database.
- **API/integration tests** run against an isolated test PostgreSQL database
  and a temporary uploads directory, exercising real Prisma queries, real
  bcrypt hashing and real cookie handling. Nothing is mocked. Authentication is
  performed by actually logging in and reusing the returned cookie, never by
  injecting a fake session — a test that forges its own identity would prove
  nothing about the gate it is meant to be testing.
- **UI component tests** run with the client test runner; only the fetch layer
  is mocked. Components, validation, routing guards and state logic are real.
- **Migration/regression tests** run against a database seeded with Lab 2 data,
  apply the Lab 3 migration, and assert that the Lab 2 increment still behaves
  as `docs/lab-02/api-spec.md` describes.
- **E2E tests** run with Playwright against the full stack, proving cross-screen
  flows and, critically, that a role sees and cannot reach what it should not.
- **Visual/responsive tests** are Playwright screenshots at three viewports,
  checked against `ui-spec.md` by the checklist in §5.
- **Security/authorization is tested at the API, never through the interface.**
  For every protected group there is a test asserting the refusal for an
  unauthenticated caller and for an authenticated caller in the wrong role.
  Hiding a control is not evidence, so no authorization claim in this document
  rests on a UI test.
- No required test may be skipped, disabled or commented out in the final `main`
  branch (`specification.md` §10).
- Every test's title or leading comment carries its ID from this document (e.g.
  `// BR-31, API-TICKET-10`), so §3 and §4 stay reviewable against the code
  rather than only against this file.

### ID scheme

Area-prefixed, continuing the Lab 2 convention (Lab 2 used `API-CREATE-01`,
`UI-LIST-03`, and so on).
The handout's §10 example table uses flat ids; the three it names map onto this
scheme as follows, so a reader looking for them can find them:

| Handout example | Here |
|---|---|
| API-01 — valid login | **API-AUTH-01** |
| API-08 — Requester requests Internal Notes | **API-NOTE-02** |
| E2E-02 — initial password login and change | **E2E-02** (unchanged) |

## 2. Planned Tests

### 2.1 Unit — `server/tests/lab-03/`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| UNIT-01 | Unit | BR-07 | Hash round-trip | A hash verifies its own password, rejects another, and never equals the plaintext | `password.unit.test.ts` | **Pass** |
| UNIT-02 | Unit | BR-08 | Password length bounds | 7 and 73 characters rejected; 8 and 72 accepted | `password.unit.test.ts` | **Pass** |
| UNIT-03 | Unit | BR-30, BR-31 | Transition matrix helper | Every permitted cell allowed; every other pair rejected, including all eight self-transitions | `status-transitions.unit.test.ts` | **Pass** |
| UNIT-04 | Unit | BR-11 | Session expiry arithmetic | `expiresAt` is issue time + 8h; a timestamp one second past it is expired | `session.unit.test.ts` | **Pass** |
| UNIT-05 | Unit | BR-36 | Email normalisation | Surrounding whitespace trimmed and comparison case-folded | `password.unit.test.ts` | **Pass** |

### 2.2 API — Authentication — `server/tests/lab-03/auth.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-AUTH-01 | API | AC-01, BR-01 | Valid login | 200, `Set-Cookie: tt_session`, safe user object with role | `auth.api.test.ts` | **Pass** |
| API-AUTH-02 | API | BR-06 | Wrong password | 401 `INVALID_CREDENTIALS`, no cookie, no session row | `auth.api.test.ts` | **Pass** |
| API-AUTH-03 | API | BR-06 | Unknown email | Response body byte-identical to API-AUTH-02 | `auth.api.test.ts` | **Pass** |
| API-AUTH-04 | API | AC-05, BR-01 | Inactive account, correct password | Same 401 body again; no session created | `auth.api.test.ts` | **Pass** |
| API-AUTH-05 | API | BR-42 | Blank email or password | 400 `VALIDATION_ERROR` with the offending `field` | `auth.api.test.ts` | **Pass** |
| API-AUTH-06 | API | BR-36 | Capitalised and padded email | Logs in successfully | `auth.api.test.ts` | **Pass** |
| API-AUTH-07 | API | BR-07 | Login response contents | No `passwordHash`, no session id anywhere in the body | `auth.api.test.ts` | **Pass** |
| API-AUTH-08 | API | BR-14 | Ten consecutive failures | No lockout: the eleventh attempt with the correct password succeeds | `auth.api.test.ts` | **Pass** |
| API-AUTH-09 | API | FR-03, BR-13 | `GET /api/auth/me` with a session | 200 with the safe user object | `auth.api.test.ts` | **Pass** |
| API-AUTH-10 | API | BR-13 | `GET /api/auth/me` with no session | 401 `UNAUTHENTICATED` — never 200 with a null user | `auth.api.test.ts` | **Pass** |
| API-AUTH-11 | API | AC-06, BR-10 | Logout then replay the cookie | 204; session row deleted; replay answers 401 | `auth.api.test.ts` | **Pass** |
| API-AUTH-12 | API | BR-15 | Cookie attributes | `HttpOnly`, `SameSite=Lax`, `Path=/` present on the login response | `auth.api.test.ts` | **Pass** |
| API-AUTH-13 | API | BR-11 | Session past `expiresAt` | 401, and the expired row is deleted | `auth.api.test.ts` | **Pass** |
| API-AUTH-14 | API | BR-09, BR-12 | Successful password change | 200, `mustChangePassword:false`, old password fails, other sessions of that user are gone, the current one survives | `auth.api.test.ts` | **Pass** |
| API-AUTH-15 | API | BR-42 | Wrong `currentPassword` | 400 with `field:"currentPassword"` — not 401 | `auth.api.test.ts` | **Pass** |
| API-AUTH-16 | API | BR-08, BR-09 | Change-password validation | Too short, too long, same as current, mismatched confirmation each answer 400 with the right `field` | `auth.api.test.ts` | **Pass** |
| API-AUTH-17 | API | AC-02, BR-02 | `mustChangePassword` user calls any other endpoint | 403 `PASSWORD_CHANGE_REQUIRED` | `auth.api.test.ts` | **Pass** |
| API-AUTH-18 | API | BR-02 | The three exempt endpoints while `mustChangePassword` | `me`, `change-password` and `logout` all work | `auth.api.test.ts` | **Pass** |

### 2.3 API — Authorization and safe errors — `server/tests/lab-03/authorization.api.test.ts`

Every row here is written. API-AUTHZ-02 to API-AUTHZ-05 name endpoints that
arrived later in the sprint, and each was carried until its endpoints existed —
the queue (#31), the staff Ticket operations (#32) and user management (#33) —
because pointing them at a path nothing routed yet would have asserted a 404
from the fallback handler and read as a passing authorization test.

The rows that could be written are, and two of them were widened while being
written: API-AUTHZ-01 and API-AUTHZ-06 drive a table of *every* endpoint behind
`requesterOnly` rather than the one or two the row names, because BR-19 is a
claim about all of them and a gate forgotten on the seventh route is exactly
the defect the row exists to catch. Issue #32 added its eight endpoints to
API-AUTHZ-01 the same way, and turned the API-AUTHZ-06 case that pinned three
read endpoints as Requester-only into one that pins them as the only three open
to staff. Issue #33 wrote API-AUTHZ-04 and API-AUTHZ-05 as the same kind of
table — every user-management endpoint, plus a `DELETE` that does not exist —
and moved API-AUTHZ-10 onto the Administrator endpoint that really deactivates
an account, so it now also proves the sessions are deleted rather than only
refused.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-AUTHZ-01 | API | BR-19 | Table-driven: every protected endpoint with no cookie | 401 `UNAUTHENTICATED` for all of them | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-02 | API | AC-07 | Requester → `GET /api/staff/tickets` and `/api/staff/assignees` | 403 `FORBIDDEN` | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-03 | API | BR-05, BR-32 | Requester → owner, IT-priority and status endpoints on their own Ticket | 403 `FORBIDDEN`; nothing changes | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-04 | API | AC-21 | Requester → every `/api/users` endpoint | 403 `FORBIDDEN` | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-05 | API | AC-21 | IT Staff → every `/api/users` endpoint | 403 `FORBIDDEN` | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-06 | API | BR-19 | IT Staff and Administrator → every endpoint `api-spec.md` §6 keeps to the Requester role | 403 `FORBIDDEN`, and nothing written | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-07 | API | BR-16 | Requester → another Requester's Ticket | 404, body identical to a Ticket id that never existed | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-08 | API | AC-03, AC-25, BR-03 | Requester sends `X-Requester-Id`, and a `requesterId` in the body, naming someone else | Both ignored; own data returned and stored; never the other user's | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-09 | API | BR-16 | Requester → attachment metadata and download on another's Ticket | 404 `ATTACHMENT_NOT_FOUND` both times | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-10 | API | AC-24, BR-12 | Administrator deactivates a user holding a live session | The next request on that session answers 401 | `authorization.api.test.ts` | **Pass** |
| API-AUTHZ-11 | API | BR-07 | Sweep every endpoint's success and error bodies | No `passwordHash`, no session identifier in any of them | `authorization.api.test.ts` | **Pass** |
| API-ERR-01 | API | BR-43 | Forced internal failure | 500 `INTERNAL_ERROR` with a generic message; no stack trace, SQL, or file path | `authorization.api.test.ts` | **Pass** |
| API-ERR-02 | API | BR-43 | Envelope shape on 401, 403, 404, 409 | All four use the `api-spec.md` §1 envelope, never Express's HTML page | `authorization.api.test.ts` | **Pass** |

### 2.4 API — IT Staff queue — `server/tests/lab-03/staff-queue.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-QUEUE-01 | API | AC-09 | IT Staff queue contents | Tickets from every Requester, each with owner, status and both priorities | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-02 | API | AC-09, BR-40 | `search` | Matches ticket number and summary, case-insensitive partial | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-03 | API | AC-09, BR-40 | Each filter alone | Category, requested priority, IT priority and status each narrow correctly | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-04 | API | BR-40 | `owner` | `unassigned` returns only null-owner rows; an id returns only that owner's | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-05 | API | BR-40 | Combined filters | AND semantics | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-06 | API | BR-40 | Each sortable field, both directions | Ordering correct; ties break by `ticketNumber desc` | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-07 | API | BR-40 | `sortBy=itPriority` | HIGH→MEDIUM→LOW by rank, not alphabetically; nulls last in `desc` and in `asc` | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-08 | API | BR-40 | Defaults | No parameters gives `updatedAt desc` and `pageSize` 25 | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-09 | API | AC-28, BR-40 | Every parameter with a junk value | Falls back to that parameter's default; never 400 | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-10 | API | BR-40 | Page past the end | `data: []` with accurate metadata, not an error | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-11 | API | BR-40 | Pagination envelope | Same four fields and shape as Lab 2 | `staff-queue.api.test.ts` | **Pass** |
| API-QUEUE-12 | API | FR-16, BR-25 | `GET /api/staff/assignees` | Active IT Staff and Administrators only; no Requester, no inactive user, no email field | `staff-queue.api.test.ts` | **Pass** |

### 2.5 API — IT Staff ticket operations — `server/tests/lab-03/staff-ticket-detail.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-TICKET-01 | API | BR-17 | Staff read another Requester's Ticket | 200 with the full Ticket object | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-02 | API | AC-10 | Claim an unassigned Ticket | Owner becomes the caller; visible to a second staff session | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-03 | API | AC-11 | Reassign to another active staff user | Ownership moves | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-04 | API | AC-11, BR-25 | Assign to an inactive user, a Requester, or an unknown id | 400 `INVALID_OWNER` each time; owner unchanged | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-05 | API | BR-28 | `ownerId: null` | Ticket returns to unassigned | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-06 | API | BR-28 | A staff member who is not the owner reassigns | Permitted | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-07 | API | AC-12, BR-29 | Set IT Priority | `itPriority` changes; `requestedPriority` is untouched | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-08 | API | BR-42 | `itPriority: null` or an unknown value | 400 `VALIDATION_ERROR` (`field: "itPriority"`) | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-09 | API | BR-31 | Table-driven: every permitted transition | Each succeeds and persists | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-10 | API | AC-13, BR-31 | Table-driven: every non-permitted pair | 409 `INVALID_STATUS_TRANSITION`; status unchanged | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-11 | API | BR-31 | Status set to its current value | 409, not a silent success | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-12 | API | AC-16, BR-05, BR-34 | Requester marks appears-resolved | `requesterResolvedAt` set; `currentStatus` unchanged; visible to staff | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-13 | API | BR-34 | Appears-resolved twice | 409 `ALREADY_INDICATED`; the first timestamp is not overwritten | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-14 | API | BR-34 | Appears-resolved on a Resolved, Closed or Cancelled Ticket | 409 `RESOLUTION_NOT_APPLICABLE` | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-15 | API | BR-16 | Appears-resolved by staff, and by another Requester | 403 for staff; 404 for the other Requester | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-16 | API | AC-26, FR-21 | Staff read and download an attachment on a Ticket they do not own | 200 with the original filename | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-17 | API | FR-21 | Staff attempt attachment upload and removal | 403 both times | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-18 | API | BR-27, BR-29 | A Ticket created in Lab 3 | Starts unassigned, status New, `itPriority` equal to `requestedPriority` | `staff-ticket-detail.api.test.ts` | **Pass** |
| API-TICKET-19 | API | BR-26 | Owner is deactivated | The Ticket keeps that owner and stays reassignable | `staff-ticket-detail.api.test.ts` | **Pass** |

### 2.6 API — Comments and notes — `server/tests/lab-03/comments-notes.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-COMMENT-01 | API | AC-14, BR-04, BR-22 | Requester comments on their own Ticket | 201; author and `createdAt` come from the server; readable by staff and Administrator | `comments-notes.api.test.ts` | **Pass** |
| API-COMMENT-02 | API | BR-04 | Staff comment on any Ticket | 201; readable by that Ticket's Requester | `comments-notes.api.test.ts` | **Pass** |
| API-COMMENT-03 | API | BR-16 | Requester comments on another's Ticket | 404 `TICKET_NOT_FOUND` | `comments-notes.api.test.ts` | **Pass** |
| API-COMMENT-04 | API | BR-23, BR-42 | Empty, whitespace-only, and 2001-character bodies | 400 `VALIDATION_ERROR` (`field: "body"`) | `comments-notes.api.test.ts` | **Pass** |
| API-COMMENT-05 | API | BR-23 | Boundary bodies | 1 character and 2000 characters both accepted | `comments-notes.api.test.ts` | **Pass** |
| API-COMMENT-06 | API | BR-22 | Client supplies `author` and `createdAt` | Ignored; the server's values are stored | `comments-notes.api.test.ts` | **Pass** |
| API-COMMENT-07 | API | BR-22 | Ordering | Oldest first | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-01 | API | AC-15, BR-04 | Staff create and read an Internal Note | 201 then 200; author and time from the server | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-02 | API | **AC-04**, BR-20 | Requester requests Internal Notes on their **own** Ticket | 404, identical to a non-existent Ticket; no note content, not even an empty array | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-03 | API | AC-04, BR-20 | Requester posts an Internal Note | 404 | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-04 | API | AC-15, BR-20 | Every Requester-visible response for a Ticket carrying notes | No note body, author or count appears anywhere in any of them | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-05 | API | BR-23 | Note body validation | Same bounds and same `field` as comments | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-06 | API | BR-04 | Administrator reads and posts notes | Permitted | `comments-notes.api.test.ts` | **Pass** |
| API-NOTE-07 | API | BR-21 | Edit and delete routes for comments and notes | No such route exists — `PATCH`/`PUT`/`DELETE` answer 404 `NOT_FOUND` | `comments-notes.api.test.ts` | **Pass** |

### 2.7 API — Administrator user management — `server/tests/lab-03/users-admin.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-USER-01 | API | FR-22, BR-41 | User list | All users including inactive, ordered by name ascending | `users-admin.api.test.ts` | **Pass** |
| API-USER-02 | API | AC-27 | Search | Partial, case-insensitive match on name and on email | `users-admin.api.test.ts` | **Pass** |
| API-USER-03 | API | AC-27 | Role filter | Only that role; combines with search | `users-admin.api.test.ts` | **Pass** |
| API-USER-04 | API | BR-41 | Junk query values | Ignored; full list returned; never 400 | `users-admin.api.test.ts` | **Pass** |
| API-USER-05 | API | BR-41 | Response shape | A plain `data` array with no pagination metadata | `users-admin.api.test.ts` | **Pass** |
| API-USER-06 | API | AC-22, BR-35 | Create a user | 201; exactly one role; `mustChangePassword: true` | `users-admin.api.test.ts` | **Pass** |
| API-USER-07 | API | AC-17, BR-36 | Duplicate email, including a different capitalisation | 409 `EMAIL_ALREADY_EXISTS`; no user created | `users-admin.api.test.ts` | **Pass** |
| API-USER-08 | API | BR-42 | Creation validation | Name length, email format, missing `isActive`, password length each 400 with the right `field` | `users-admin.api.test.ts` | **Pass** |
| API-USER-09 | API | BR-18 | Role as an array, or an unknown value | 400; no user created, and no first-element fallback | `users-admin.api.test.ts` | **Pass** |
| API-USER-10 | API | AC-23, BR-35 | Edit name, email, role and activation state | Each persists; omitted fields are untouched | `users-admin.api.test.ts` | **Pass** |
| API-USER-10b | API | BR-42 | `PATCH` and set-initial-password on an id that does not exist | 404 `USER_NOT_FOUND` for both | `users-admin.api.test.ts` | **Pass** |
| API-USER-11 | API | BR-42 | `PATCH` with none of the four fields | 400 `VALIDATION_ERROR` | `users-admin.api.test.ts` | **Pass** |
| API-USER-12 | API | BR-36 | Edit to an email another user holds | 409 `EMAIL_ALREADY_EXISTS` | `users-admin.api.test.ts` | **Pass** |
| API-USER-13 | API | AC-20, BR-37 | Administrator deactivates themselves | 409 `SELF_DEACTIVATION`; account still active | `users-admin.api.test.ts` | **Pass** |
| API-USER-14 | API | BR-37 | Administrator changes their own role away from Administrator | 409 `SELF_DEACTIVATION` | `users-admin.api.test.ts` | **Pass** |
| API-USER-15 | API | AC-19, BR-38 | Deactivate the last active Administrator | 409 `LAST_ACTIVE_ADMINISTRATOR`; still active | `users-admin.api.test.ts` | **Pass** |
| API-USER-16 | API | AC-19, BR-38 | Re-role the last active Administrator | 409; role unchanged | `users-admin.api.test.ts` | **Pass** |
| API-USER-17 | API | AC-18, BR-12, BR-35 | Set a new initial password | `mustChangePassword: true`; that user's sessions are deleted | `users-admin.api.test.ts` | **Pass** |
| API-USER-18 | API | AC-18 | Log in with the new initial password | Succeeds, then every other endpoint answers 403 `PASSWORD_CHANGE_REQUIRED`; the old password fails | `users-admin.api.test.ts` | **Pass** |
| API-USER-19 | API | BR-39 | `DELETE /api/users/:id` | 404 `NOT_FOUND` — the route does not exist | `users-admin.api.test.ts` | **Pass** |
| API-USER-20 | API | BR-07 | Every user response | No `passwordHash`, and the initial password is never echoed | `users-admin.api.test.ts` | **Pass** |

### 2.8 Migration and Lab 2 regression — `server/tests/lab-03/migration.api.test.ts`

Beyond the handout's minimum file list; migration is graded evidence
(handout §5.2, Part 2) and needed a file of its own rather than being folded
into another suite.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| MIG-01 | Migration | AC-08 | Lab 2 `Requester` rows after migration | Present as `User` rows with the same ids and names — the table was renamed, not dropped and recreated | `migration.api.test.ts` | **Pass** |
| MIG-02 | Migration | AC-08 | Pre-existing Tickets and Attachments | Ticket number, requester, fields and attachment rows all unchanged and readable by the original owner | `migration.api.test.ts` | **Pass** |
| MIG-03 | Migration | AC-08, BR-36 | Migrated account state | `role: REQUESTER`, `mustChangePassword: true`, no usable password until changed, and every migrated `email` stored lower-cased | `migration.api.test.ts` | **Pass** |
| MIG-04 | Migration | BR-29 | `itPriority` backfill | Every migrated Ticket has `itPriority` equal to its `requestedPriority` | `migration.api.test.ts` | **Pass** |
| MIG-05 | Migration | BR-27 | Ownership of migrated Tickets | `ownerId` is null — unassigned | `migration.api.test.ts` | **Pass** |
| MIG-06 | Migration | AC-25 | `GET /api/requesters` | 404 `NOT_FOUND`; the route is gone | `migration.api.test.ts` | **Pass** |
| MIG-07 | Migration | AC-03, BR-03 | `X-Requester-Id` after migration | Has no effect on any endpoint, with or without a session | the four Lab 2 Requester suites (also covered by API-AUTHZ-08) | **Pass** |
| MIG-08 | Regression | BR-44 | Every Lab 2 Requester endpoint under a session | Create, list, detail, upload, download and soft-remove all behave as `docs/lab-02/api-spec.md` describes, except that a missing identity is now 401 rather than 400 | the four Lab 2 Requester suites, which carry MIG-08 in their leading comments | **Pass** |
| MIG-09 | Migration | BR-45 | Seed idempotency | Running the seed twice leaves the same row counts and no duplicate emails | `migration.api.test.ts` | **Pass** |
| MIG-10 | Migration | BR-45 | Seed composition | At least 4 active + 1 inactive Requester, 3 active + 1 inactive IT Staff, 1 active Administrator, Tickets across Requesters, every status, every priority and assigned and unassigned ownership, including an inactive owner (Issue #31), and example Public Comments and Internal Notes, notes only ever by staff (Issue #32) | `migration.api.test.ts` | **Pass** |

**Error codes inherited from Lab 2.** `INVALID_CATEGORY`,
`INVALID_RELATED_SYSTEM`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`,
`ATTACHMENT_LIMIT_REACHED` and `ALREADY_REMOVED` keep their Lab 2 meaning and
their Lab 2 tests; this sprint does not restate them. MIG-08 is what proves they
still behave as `docs/lab-02/api-spec.md` describes once identity comes from a
session, and the Definition of Done requires the whole Lab 2 suite to keep
passing. They are listed here so that their absence from the tables above reads
as a decision rather than an omission.

### 2.9 UI components — `client/tests/lab-03/`

`AppShell.test.tsx` is a sixth file beyond the handout's five: role-specific
navigation and the authenticated identity display belong to the shell, not to
any one screen, and testing them inside `Login.test.tsx` would hide them from
anyone looking for them.

`AppRoutes.test.tsx` is a seventh, added during Issue #30 for the same reason.
Three rows below — UI-LOGIN-03, UI-PWD-01 and UI-SHELL-04 — were written
expecting a screen to *navigate*, and none of them does: `Login` hands the
signed-in user up and `AppShell` hands the sign-out up, because the routing
decision belongs to `AppRoutes` and reads the session, not the screen.
Asserting it inside a screen test would assert something the screen does not
do. The UI-ROUTE rows assert it where it happens, driving the real
`useAuthSession` against a mocked `fetchCurrentUser`, so the session states and
the routing that reads them are proven together rather than each against a
stub. They also close the client half of AC-07 now instead of leaving it to
E2E-04 in Issue #34.

It earned its place on the first run: it found that `RoleGuard` rendered a bare
`Outlet`, which replaced the shell's outlet context with `undefined` and left
every Requester screen without a signed-in user. Nothing else caught it — the
screen tests each supply their own context, so none of them renders the real
route tree.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| UI-LOGIN-01 | UI | FR-01 | Initial render | Email, password, show/hide toggle, Sign In; no "forgot password" or "create account" link | `Login.test.tsx` | **Pass** |
| UI-LOGIN-02 | UI | BR-42 | Empty submit | Per-field messages below each control; no request sent | `Login.test.tsx` | **Pass** |
| UI-LOGIN-03 | UI | AC-01 | Successful login | The signed-in user is handed up with `credentials: "include"` sent; the landing route itself is UI-ROUTE-05 | `Login.test.tsx` | **Pass** |
| UI-LOGIN-04 | UI | AC-05, BR-06 | 401 response | One safe callout; both values kept; password not cleared | `Login.test.tsx` | **Pass** |
| UI-LOGIN-05 | UI | BR-43 | Network failure | Safe failure callout; Sign In usable again | `Login.test.tsx` | **Pass** |
| UI-LOGIN-06 | UI | FR-01 | Busy state | Button busy and disabled, fields disabled, `aria-busy` set | `Login.test.tsx` | **Pass** |
| UI-PWD-01 | UI | AC-02, BR-02 | Mandatory mode | Banner shown and no way out of the screen; the typed-route half is UI-ROUTE-04 | `ChangePassword.test.tsx` | **Pass** |
| UI-PWD-02 | UI | FR-06 | Voluntary mode | Navigation intact, no banner, Cancel returns to the previous screen | `ChangePassword.test.tsx` | **Pass** |
| UI-PWD-03 | UI | BR-08 | Length rule | Helper text visible before any error; 7 and 73 characters rejected inline | `ChangePassword.test.tsx` | **Pass** |
| UI-PWD-04 | UI | BR-09 | Mismatch and reuse | Confirmation mismatch and "same as current" each show under the right field | `ChangePassword.test.tsx` | **Pass** |
| UI-PWD-05 | UI | BR-42 | Wrong current password | Message appears under `Current Password`, not as a screen failure | `ChangePassword.test.tsx` | **Pass** |
| UI-PWD-06 | UI | AC-02 | Success | `zg-state--success` replaces the form, *then* the updated user is handed up; the navigation itself is UI-ROUTE-05 | `ChangePassword.test.tsx` | **Pass** |
| UI-SHELL-01 | UI | FR-09, AC-07 | Requester navigation | My Tickets and Create Ticket only; no queue or admin destination rendered at all | `AppShell.test.tsx` | **Pass** |
| UI-SHELL-02 | UI | FR-09 | IT Staff and Administrator navigation | Queue for staff; User Management first plus Queue for the Administrator | `AppShell.test.tsx` | **Pass** |
| UI-SHELL-03 | UI | FR-09 | Header identity | Authenticated name and role badge shown; no Change Requester control anywhere | `AppShell.test.tsx` | **Pass** |
| UI-SHELL-04 | UI | AC-06 | Logout | Calls the endpoint with the cookie and drops the local user; landing on Login is UI-ROUTE-02 | `AppShell.test.tsx` | **Pass** |
| UI-SHELL-05 | UI | FR-09 | Mobile panel at 375px | Role items, then name, role badge, Change Password and Log Out as full-width rows | `AppShell.test.tsx` | **Pass** |
| UI-ROUTE-01 | UI | BR-13 | Session not yet resolved | The loading state — neither Login nor the application, so a signed-in user never sees a false sign-out | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-02 | UI | FR-01 | Signed out, deep URL typed | Login renders; no Requester-scoped request is made | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-03 | UI | BR-13 | `GET /me` unreachable | Retryable failure state, not Login | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-04 | UI | AC-02, BR-02 | `mustChangePassword`, another route typed | The mandatory Change Password screen inside a shell carrying no navigation items — Log Out reachable, Cancel absent | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-05 | UI | AC-01, AC-02 | Each role at `/`, a Requester at `/login`, and a saved mandatory password change | Each resolves to its role's landing screen: My Tickets, the Ticket Queue, User Management — and the mandatory change ends there too, never on the voluntary form | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-06 | UI | FR-09, AC-07 | Another role's URL typed | The forbidden state renders with the way back to the person's own landing screen; no request is made on the other role's behalf | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-07 | UI | FR-14 | IT Staff open `/tickets/:id` | The Ticket Detail screen asks for that Ticket — not the forbidden state, which would misreport a route the role may use | `AppRoutes.test.tsx` | **Pass** |
| UI-ROUTE-08 | UI | AC-24, BR-12 | The session ends while the application is in use | The next request answering 401 `UNAUTHENTICATED` drops the local user and Login renders — not the screen's own failure state | `AppRoutes.test.tsx` | **Pass** |
| UI-QUEUE-01 | UI | AC-09 | Desktop table | Nine columns in the specified order, with badges | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-02 | UI | AC-09 | Search and filters | Each control issues the right query parameter | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-03 | UI | AC-09 | Sorting | Clicking a sortable header starts descending and returns to page 1 | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-04 | UI | AC-09 | Pagination | Page size default 25; Previous/Next and page numbers work | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-05 | UI | AC-09 | Empty vs no-results | Two distinct blocks; no-results offers Clear Filters | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-06 | UI | AC-07 | 403 response | `zg-state--forbidden`, not the generic failure block | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-07 | UI | BR-43 | 500 response | Safe failure block with Retry | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-QUEUE-08 | UI | AC-09 | Mobile at 375px | Cards, not a table; unassigned tickets visibly flagged | `StaffTicketQueue.test.tsx` | **Pass** |
| UI-DETAIL-01 | UI | AC-04, BR-20 | Requester view | No Internal Notes panel, heading, empty state or any other trace | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-02 | UI | FR-14 | Staff view | Operations panel present; Add and Remove attachment controls absent; Download present | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-03 | UI | AC-10, AC-11 | Owner control | Claim sets the signed-in user; the select lists only active staff and Administrators | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-04 | UI | AC-12 | IT Priority control | Saves on change; Requested Priority shown read-only above it | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-05 | UI | AC-13, BR-31 | Status select | Offers only transitions permitted from the current status | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-06 | UI | BR-33 | Closed and Cancelled | Confirmation dialog first; focus trapped and returned; Cancel leaves the status unchanged | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-07 | UI | AC-13 | 409 from a control | Inline message; the control reverts; the other two controls are unaffected | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-08 | UI | BR-23, BR-24 | Comment composer | Counter, disabled submit when empty or over 2000, and a body containing markup rendered as literal text | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-09 | UI | AC-15 | The two threads | Internal panel carries its warning border, lock header, distinct placeholder and "Add Internal Note" button; the panels are never adjacent | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-DETAIL-10 | UI | AC-16, BR-34 | Problem Appears Resolved | Present for the owning Requester; absent for staff; replaced by a dated line once set | `StaffTicketDetail.test.tsx` | **Pass** |
| UI-USER-01 | UI | FR-22 | User list | Name, Email, Role badge, Status, Edit — five columns, no sort headers, no pagination | `UserManagement.test.tsx` | **Pass** |
| UI-USER-02 | UI | AC-27 | Search and role filter | Both issue the right query; clearing search restores the list | `UserManagement.test.tsx` | **Pass** |
| UI-USER-03 | UI | AC-22 | Create dialog | All five fields; role is single-select; helper text states the password rule | `UserManagement.test.tsx` | **Pass** |
| UI-USER-04 | UI | AC-17 | Duplicate email 409 | Inline message on the Email field; dialog stays open with values kept | `UserManagement.test.tsx` | **Pass** |
| UI-USER-05 | UI | AC-23 | Edit dialog | Pre-filled; Set New Initial Password is a separate section with its own button | `UserManagement.test.tsx` | **Pass** |
| UI-USER-06 | UI | AC-20, BR-37 | Editing one's own account | Status and Role disabled with an explanatory helper line | `UserManagement.test.tsx` | **Pass** |
| UI-USER-07 | UI | AC-19 | Last-Administrator 409 | Inline message; the control reverts | `UserManagement.test.tsx` | **Pass** |
| UI-USER-08 | UI | AC-18 | Set new initial password | Confirmation line shown; the password is never redisplayed | `UserManagement.test.tsx` | **Pass** |
| UI-USER-09 | UI | AC-21 | Non-Administrator reaches the route | `zg-state--forbidden` | `UserManagement.test.tsx` | **Pass** |

### 2.10 Accessibility — `client/tests/lab-03/accessibility.test.tsx`

The handout's §10 names accessibility among the coverage students must identify,
and Part 9 grades focus behaviour. Lab 3 adds no accessibility *rule* of its
own — Lab 2 §9 and `ui-spec.md` §12 are the contract — but it adds controls the
rules have to be proven against, so they get rows rather than living only in the
§5 checklist. An eighth client file, for the same reason `AppShell.test.tsx`
and `AppRoutes.test.tsx` exist: these assertions span screens.

Written in Issue #32, when the first dialog, the two threads and the not-found
state existed, and completed in Issue #33 with the Create and Edit User dialogs
that A11Y-01, A11Y-03 and A11Y-05 also name.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| A11Y-01 | UI | ui-spec §12 | Label association | Every field on Login, Change Password and both user dialogs is reachable by its visible label text | `accessibility.test.tsx` | **Pass** |
| A11Y-02 | UI | ui-spec §12 | Password show/hide toggles | Carry `title` and `aria-label`, and the label changes with the state | `accessibility.test.tsx` | **Pass** |
| A11Y-03 | UI | ui-spec §12 | Announced refusals | The login failure callout and every inline 409 message carry `role="alert"` | `accessibility.test.tsx` | **Pass** |
| A11Y-04 | UI | ui-spec §12, BR-20 | Internal Notes heading | A real heading in the document outline, positioned before its composer | `accessibility.test.tsx` | **Pass** |
| A11Y-05 | UI | ui-spec §12 | Dialog focus | Create User, Edit User and the status confirmation trap focus and return it to the trigger on close | `accessibility.test.tsx` | **Pass** |
| A11Y-06 | UI | ui-spec §12 | Colour is never the only signal | All eight status badges, all three priority badges and all three role badges render their label text | `accessibility.test.tsx` | **Pass** |
| A11Y-07 | UI | ui-spec §12 | Status select description | Carries `aria-describedby` naming the current status, since its option list changes with it | `accessibility.test.tsx` | **Pass** |
| A11Y-08 | UI | ui-spec §12 | Refusal states take focus | `zg-state--forbidden` and `zg-state--not-found` move focus to their heading | `accessibility.test.tsx` | **Pass** |
| A11Y-09 | UI | ui-spec §12 | Threads are lists | Both threads render as `<ol>` so position and count are announced | `accessibility.test.tsx` | **Pass** |

### 2.11 E2E — `e2e/lab-03/`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| E2E-01 | E2E | AC-01, AC-06 | Log in, use the app, log out, then reuse the URL | Landing screen per role; after logout the direct URL returns to Login and the API refuses | `authentication.spec.ts` | **Pass** |
| E2E-02 | E2E | **AC-02** | Initial-password login and change | Normal application opens only after a valid new password is saved | `authentication.spec.ts` | **Pass** |
| E2E-03 | E2E | AC-05 | Invalid password, unknown email, inactive account | The same message and the same busy/failure feedback in all three cases | `authentication.spec.ts` | **Pass** |
| E2E-04 | E2E | AC-07, AC-21 | Role navigation and direct URLs | Each role sees only its own destinations; typing another role's URL yields the forbidden state and the API refuses | `authentication.spec.ts` | **Pass** |
| E2E-05 | E2E | AC-08, BR-44 | Requester regression under authentication | Create a Ticket, find it in My Tickets, open Detail, add and download an Attachment — no selector anywhere | `staff-ticket-flow.spec.ts` | **Pass** |
| E2E-06 | E2E | AC-09 | Queue in the browser | Search, filter, sort and paginate, then open Ticket Detail | `staff-ticket-flow.spec.ts` | **Pass** |
| E2E-07 | E2E | AC-10, AC-12, AC-13, AC-14, AC-15 | Full staff operation | Claim, set IT Priority, move status, post a Public Comment, add an Internal Note; the Requester then sees the comment and no trace of the note | `staff-ticket-flow.spec.ts` | **Pass** |
| E2E-08 | E2E | AC-16 | Requester resolution signal | Requester marks it; staff see it; status unchanged until staff resolve the Ticket | `staff-ticket-flow.spec.ts` | **Pass** |
| E2E-09 | E2E | AC-22, AC-18 | Administrator creates a user | The new account signs in and is forced through Change Password before reaching the application | `user-administration.spec.ts` | **Pass** |
| E2E-10 | E2E | AC-17, AC-19, AC-20, AC-23, AC-27 | Administrator screen | Search, role filter, edit, duplicate-email refusal, self-deactivation refusal, last-Administrator refusal | `user-administration.spec.ts` | **Pass** |
| E2E-11 | E2E | AC-24 | Deactivation while signed in | The deactivated user's next action returns them to Login | `user-administration.spec.ts` | **Pass** |
| E2E-12 | E2E | AC-09 | Staff flow at 375px | Login, queue cards, and Ticket Detail with its two threads, with no horizontal scrolling at any step. User Management at mobile is covered by VIS-03 | `staff-ticket-flow.spec.ts` | **Pass** |

### 2.12 Visual and responsive — `e2e/lab-03/visual.spec.ts`

A fourth E2E file beyond the handout's minimum three, matching the Lab 2
arrangement: the screenshots the §5 checklist is filled in against are captured
by their own spec rather than as a side effect of a behavioural one.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| VIS-01 | Visual | §5 checklist | Every Lab 3 screen and state at 1440×900 | Screenshots written under `artifacts/lab-03/screenshots/`; no horizontal overflow and no clipped scroller asserted as each is taken | `visual.spec.ts` | **Pass** |
| VIS-02 | Visual | §5 checklist | The same at 768×1024 | As above, including the two queue columns dropped at tablet | `visual.spec.ts` | **Pass** |
| VIS-03 | Visual | §5 checklist | The same at 375×812 | As above, with cards replacing both tables | `visual.spec.ts` | **Pass** |

The Lab 2 arrangement is reused: the assertions a machine can make — no
unintended horizontal scrolling, no clipped scrolling container — run as each
screenshot is captured, so a layout regression fails the suite rather than
waiting for someone to notice it in a picture. Everything else in a screenshot
is judged by a person against §5.

## 3. Acceptance-Criterion Traceability

Every criterion maps to at least one planned test, as the handout §9.1
requires.

| AC | Evidence IDs |
|---|---|
| AC-01 | API-AUTH-01, UI-LOGIN-03, UI-ROUTE-05, E2E-01 |
| AC-02 | API-AUTH-17, API-AUTH-18, UI-PWD-01, UI-PWD-06, UI-ROUTE-04, E2E-02 |
| AC-03 | API-AUTHZ-08, MIG-07 |
| AC-04 | API-NOTE-02, API-NOTE-03, UI-DETAIL-01 |
| AC-05 | API-AUTH-04, UI-LOGIN-04, E2E-03 |
| AC-06 | API-AUTH-11, UI-SHELL-04, UI-ROUTE-02, E2E-01 |
| AC-07 | API-AUTHZ-02, API-AUTHZ-06, UI-SHELL-01, UI-ROUTE-06, UI-QUEUE-06, E2E-04 |
| AC-08 | MIG-01, MIG-02, MIG-03, E2E-05 |
| AC-09 | API-QUEUE-01..11, UI-QUEUE-01..08, E2E-06, E2E-12 |
| AC-10 | API-TICKET-02, UI-DETAIL-03, E2E-07 |
| AC-11 | API-TICKET-03, API-TICKET-04, UI-DETAIL-03 |
| AC-12 | API-TICKET-07, UI-DETAIL-04, E2E-07 |
| AC-13 | API-TICKET-10, UI-DETAIL-05, UI-DETAIL-07, E2E-07 |
| AC-14 | API-COMMENT-01, UI-DETAIL-08, E2E-07 |
| AC-15 | API-NOTE-01, API-NOTE-04, UI-DETAIL-09, E2E-07 |
| AC-16 | API-TICKET-12, UI-DETAIL-10, E2E-08 |
| AC-17 | API-USER-07, UI-USER-04, E2E-10 |
| AC-18 | API-USER-17, API-USER-18, UI-USER-08, E2E-09 |
| AC-19 | API-USER-15, API-USER-16, UI-USER-07, E2E-10 |
| AC-20 | API-USER-13, UI-USER-06, E2E-10 |
| AC-21 | API-AUTHZ-04, API-AUTHZ-05, UI-USER-09, E2E-04 |
| AC-22 | API-USER-06, UI-USER-03, E2E-09 |
| AC-23 | API-USER-10, UI-USER-05, E2E-10 |
| AC-24 | API-AUTHZ-10, UI-ROUTE-08, E2E-11 |
| AC-25 | MIG-06, UI-SHELL-03, E2E-05 |
| AC-26 | API-TICKET-16, API-AUTHZ-06, UI-DETAIL-02 |
| AC-27 | API-USER-02, API-USER-03, UI-USER-02, E2E-10 |
| AC-28 | API-QUEUE-09, UI-QUEUE-02 |

## 4. Business-Rule Traceability

Every rule has at least one automated test, as `specification.md` §10 requires.

| BR | Evidence IDs | BR | Evidence IDs |
|---|---|---|---|
| BR-01 | API-AUTH-01, API-AUTH-04 | BR-24 | UI-DETAIL-08 |
| BR-02 | API-AUTH-17, API-AUTH-18, UI-PWD-01, UI-ROUTE-04 | BR-25 | API-TICKET-04, API-QUEUE-12 |
| BR-03 | API-AUTHZ-08, MIG-07 | BR-26 | API-TICKET-19, API-QUEUE-01, API-QUEUE-04, MIG-10 |
| BR-04 | API-COMMENT-01, API-COMMENT-02, API-NOTE-06 | BR-27 | API-TICKET-18, MIG-05 |
| BR-05 | API-AUTHZ-03, API-TICKET-12 | BR-28 | API-TICKET-05, API-TICKET-06 |
| BR-06 | API-AUTH-02, API-AUTH-03, UI-LOGIN-04 | BR-29 | API-TICKET-07, API-TICKET-18, MIG-04 |
| BR-07 | UNIT-01, API-AUTH-07, API-AUTHZ-11, API-USER-20 | BR-30 | UNIT-03 |
| BR-08 | UNIT-02, API-AUTH-16, UI-PWD-03 | BR-31 | UNIT-03, API-TICKET-09, API-TICKET-10, API-TICKET-11 |
| BR-09 | API-AUTH-14, API-AUTH-16, UI-PWD-04 | BR-32 | API-AUTHZ-03 |
| BR-10 | API-AUTH-11 | BR-33 | UI-DETAIL-06 |
| BR-11 | UNIT-04, API-AUTH-13 | BR-34 | API-TICKET-12, API-TICKET-13, API-TICKET-14 |
| BR-12 | API-AUTH-14, API-AUTHZ-10, API-USER-17, UI-ROUTE-08 | BR-35 | API-USER-06, API-USER-10, API-USER-17, API-USER-18 |
| BR-13 | API-AUTH-09, API-AUTH-10, UI-ROUTE-01, UI-ROUTE-03 | BR-36 | UNIT-05, API-AUTH-06, API-USER-07, API-USER-12, MIG-03 |
| BR-14 | API-AUTH-08 | BR-37 | API-USER-13, API-USER-14, UI-USER-06 |
| BR-15 | API-AUTH-12 | BR-38 | API-USER-15, API-USER-16 |
| BR-16 | API-AUTHZ-07, API-AUTHZ-09, API-COMMENT-03, API-TICKET-15 | BR-39 | API-USER-19 |
| BR-17 | API-TICKET-01, API-AUTHZ-06 | BR-40 | API-QUEUE-02..11, UI-QUEUE-02..04 |
| BR-18 | API-USER-09 | BR-41 | API-USER-01, API-USER-04, API-USER-05 |
| BR-19 | API-AUTHZ-01, API-AUTHZ-06 | BR-42 | API-AUTH-05, API-COMMENT-04, API-USER-08, API-USER-11 |
| BR-20 | API-NOTE-02, API-NOTE-03, API-NOTE-04, UI-DETAIL-01, A11Y-04 | BR-43 | API-ERR-01, API-ERR-02, UI-LOGIN-05, UI-QUEUE-07 |
| BR-21 | API-NOTE-07 | BR-44 | MIG-08, E2E-05 |
| BR-22 | API-COMMENT-01, API-COMMENT-06, API-COMMENT-07 | BR-45 | MIG-09, MIG-10 |
| BR-23 | API-COMMENT-04, API-COMMENT-05, API-NOTE-05, UI-DETAIL-08 |  |  |

## 5. Responsive and Visual Checklist

Completed at each of VIS-01/02/03 against `ui-spec.md` §13 — in Issue #34, by
reading the 75 screenshots of the recorded run. Six departures found there were
fixed and photographed again before the boxes were ticked (§7, After Issue #34):

- [x] Zen Green tokens only — no colour appears that is not in Lab 2 §1.1
- [x] Editable vs read-only fields visually distinct on Ticket Detail, both roles
- [x] All eight status badges distinguishable side by side, text plus colour
- [x] Role badge visually subordinate to status and priority badges
- [x] Public Comments and Internal Notes unmistakable: border, fill, header,
      placeholder and button label all differ
- [x] Internal Notes completely absent from the Requester view
- [x] Validation messages directly below their field on Login, Change Password
      and both user dialogs
- [x] Keyboard focus visible on every new control, including inside dialogs and
      the mobile filter sheet
- [x] Role-specific navigation shows no destination the role may not use
- [x] Forbidden, not-found and generic failure states distinguishable from each
      other
- [x] No clipped labels, overlap, or horizontal scroll — especially the
      nine-column queue at 992px and the dropped columns at 768px
- [x] Unassigned tickets recognisable at a glance in both table and card

Screenshots are written to the four directories the handout §12 names:

```
artifacts/lab-03/screenshots/{authentication,staff-queue,staff-ticket-detail,user-management}/
```

## 6. Test Commands

```bash
# server: unit + API + migration (needs the migrated and seeded test database)
npm test --prefix server
```

```bash
# client: UI component tests
npm test --prefix client
```

```bash
# E2E + visual. Run from the repository root. Playwright reuses whatever is
# listening on 5173/3000, and starts both itself only when nothing is.
npm run test:e2e
```

```bash
# Remove data left behind by an interrupted E2E run
npm run e2e:cleanup --prefix server
```

The Lab 2 cleanup contract is extended rather than replaced: Lab 3 E2E fixtures
carry the same `[e2e]` marker in Ticket descriptions, and the accounts the suite
creates are marked by an `e2e-` email prefix so the teardown can remove them
without touching seeded users.

Issue #34 made that concrete. Before every run the Playwright global setup runs
`e2e:cleanup`, then `server/prisma/e2e-setup.ts`, which creates the fixture
accounts listed in `e2e/support/accounts.json` — the file the specs read too —
so the suite never depends on a password a developer may have changed while
trying the application. The setup also checks the one seeded account the suite
does use: `anong.kittisak@example.edu` must be the only active Administrator
and still use the development password, because E2E-10 reaches the
last-Administrator refusal on it. Otherwise it stops the run with that message.

## 7. Final Results

Filled in as each issue lands, and completed from the final `main` branch in
the format Lab 2 used: the full `npm test` output for server and client, the
Playwright summary, and this plan's Status column carrying a result for every
row.

| Suite | Command | Tests | Result |
|---|---|---|---|
| Server unit + API + migration | `npm test --prefix server` | **216** | **All passing** as of Issue #34 |
| Client UI components | `npm test --prefix client` | **134** | **All passing** as of Issue #34 |
| E2E + visual | `npm run test:e2e` | **25** (Lab 3: 15; Lab 2, updated: 10) | **All passing** as of Issue #34 |

### After Issue #29 — authentication foundation

| Area | Files | Cases |
|---|---|---|
| Lab 1 and Lab 2 regression | 10 files | 65, all still passing after the migration |
| Lab 3 unit | `password.unit.test.ts`, `session.unit.test.ts` | 10 |
| Lab 3 authentication API | `auth.api.test.ts` | 22 |
| Lab 3 migration and seed | `migration.api.test.ts` | 10 |

### After Issue #30 — authorization and Requester regression

| Area | Files | Cases |
|---|---|---|
| Lab 1 and Lab 2 regression | 9 files | 62, all still passing on session identity |
| Lab 3 unit | `password.unit.test.ts`, `session.unit.test.ts` | 10 |
| Lab 3 authentication API | `auth.api.test.ts` | 26 |
| Lab 3 authorization API | `authorization.api.test.ts` | 17 |
| Lab 3 migration and seed | `migration.api.test.ts` | 11 |
| Lab 3 client screens | `Login`, `ChangePassword`, `AppShell`, `AppRoutes` | 31 |
| Lab 2 client regression | 4 files | 36 |

The Lab 2 server regression is three cases smaller than after Issue #29 because
`requesters.api.test.ts` was deleted with the endpoint it covered (AC-25). Its
replacement is MIG-06, which asserts the route is gone. The Lab 2 client
regression lost three files for the same reason — the Requester selector, its
hook and its context no longer exist — and gained the four Lab 3 screen files
in their place.

### After Issue #31 — IT Staff Ticket Queue

| Area | Files | Cases |
|---|---|---|
| Lab 1 and Lab 2 regression | 9 files | 62, unchanged |
| Lab 3 unit | `password.unit.test.ts`, `session.unit.test.ts` | 10 |
| Lab 3 authentication API | `auth.api.test.ts` | 27 |
| Lab 3 authorization API | `authorization.api.test.ts` | 18 |
| Lab 3 migration and seed | `migration.api.test.ts` | 12 |
| Lab 3 staff queue API | `staff-queue.api.test.ts` | 15 |
| Lab 3 client screens | `Login`, `ChangePassword`, `AppShell`, `AppRoutes`, `StaffTicketQueue` | 44 |
| Lab 2 client regression | 4 files | 36, unchanged |

The authorization suite gained API-AUTHZ-02; the authentication suite gained a
case putting the password-change gate in front of the two staff endpoints
(API-AUTH-17); and the seed block gained the Ticket-composition case of MIG-10.

The seed block moved to a database of its own, `toktickit_seed_test`, migrated
with `prisma migrate deploy` and seeded from nothing. It used to assert against
the developer database, which the application changes: once Issue #32 lets
staff claim a Ticket or move its status, or Issue #33 lets an Administrator
deactivate an account, a seeded row stops looking seeded, and the seed leaves a
changed row alone. MIG-09 also assumed that database had already been seeded,
so the first run after the seed gained Tickets would have failed for a reason
unrelated to idempotency.

API-QUEUE-07 was checked against a deliberate regression: with the explicit
`nulls: last` removed from the query, PostgreSQL puts an untriaged Ticket first
in a descending IT Priority sort, and the case fails.

The Lab 2 My Tickets pagination moved into a shared `PaginationBar` component
that the queue also uses. No Lab 2 test changed; UI-LIST-05 and UI-LIST-06 are
what show the move preserved its behaviour.

### After Issue #32 — IT Staff Ticket operations

| Area | Files | Cases |
|---|---|---|
| Lab 1 and Lab 2 regression | 9 files | 62 — three assertions deliberately updated, below |
| Lab 3 unit | `password.unit.test.ts`, `session.unit.test.ts`, `status-transitions.unit.test.ts` | 14 |
| Lab 3 authentication API | `auth.api.test.ts` | 28 |
| Lab 3 authorization API | `authorization.api.test.ts` | 20 |
| Lab 3 migration and seed | `migration.api.test.ts` | 13 |
| Lab 3 staff queue API | `staff-queue.api.test.ts` | 15 |
| Lab 3 staff ticket operations API | `staff-ticket-detail.api.test.ts` | 24 |
| Lab 3 comments and notes API | `comments-notes.api.test.ts` | 15 |
| Lab 3 client screens | `Login`, `ChangePassword`, `AppShell`, `AppRoutes`, `StaffTicketQueue`, `StaffTicketDetail` | 62 |
| Lab 3 accessibility | `accessibility.test.tsx` | 11 |
| Lab 2 client regression | 4 files | 36 — two assertions deliberately updated, below |

**Lab 2 tests changed, each with its reason recorded beside it.** On the server,
API-CREATE-02 and API-CREATE-03 now expect IT Priority to start as the Requested
Priority (BR-29), and API-LIST-01's exhaustive key list gained `requester` and
`owner`, because every endpoint returning a Ticket now returns the one Ticket
object of `api-spec.md` §5. On the client, the Requester Ticket Detail's
UI-DETAIL-01 no longer asserts "no text box" and "no public comment" — the
Requester now has a comment composer (`ui-spec.md` §6) — and still asserts that
every ticket field is read-only and that no Internal Notes appear; its
UI-DETAIL-02 now expects the not-found state `ui-spec.md` §2.5 split out of the
generic failure block. `AttachmentSection` gained a `canManage` switch whose
default keeps Lab 2's behaviour, so its own tests did not change.

**One decision the contract did not make, now written into `api-spec.md` §8.**
A Public Comment moves the Ticket's `updatedAt`, so a reply raises the Ticket in
the queue. An Internal Note does not: a Requester can see that timestamp, and a
change with nothing visible behind it would disclose that a note was written
(BR-20). API-COMMENT-01 and API-NOTE-04 assert each half.

**Checked against deliberate regressions.** On the server: Internal Notes
answered to a Requester (API-NOTE-02 fails); a note moving `updatedAt`
(API-NOTE-04 fails); staff refused the resolution signal with 404 instead of 403
(API-TICKET-15 fails); a status allowed to move to itself (API-TICKET-11 and
UNIT-03 fail). On the client: the Internal Notes panel rendered for a Requester
(UI-DETAIL-01 fails); Closed and Cancelled saved without confirmation
(UI-DETAIL-06 fails); a thread body rendered as HTML (UI-DETAIL-08 fails).

**`ui-spec.md` §10 corrected to agree with itself.** Its row for the Requester's
Ticket Detail listed success as "inline + toast", while §2.7 (a posted entry
appears at the bottom of the thread) and §6 (the resolution button is replaced
by a dated line) — the two sections that define that screen's successes —
describe inline results and no toast. The row now points at those two sections
rather than at a toast neither of them asks for.

`prisma/demo-tickets.ts` and `prisma/e2e-cleanup.ts` now remove a Ticket's
comments, notes and attachments before the Ticket itself. None of those
relations cascade, so a demo or e2e Ticket someone had commented on would
otherwise stop either script with a foreign-key error.

### After Issue #33 — Administrator user management

| Area | Files | Cases |
|---|---|---|
| Lab 1 and Lab 2 regression | 9 files | 62, unchanged |
| Lab 3 unit | `password.unit.test.ts`, `session.unit.test.ts`, `status-transitions.unit.test.ts` | 14 |
| Lab 3 authentication API | `auth.api.test.ts` | 28 |
| Lab 3 authorization API | `authorization.api.test.ts` | 22 |
| Lab 3 migration and seed | `migration.api.test.ts` | 13 |
| Lab 3 staff queue API | `staff-queue.api.test.ts` | 15 |
| Lab 3 staff ticket operations API | `staff-ticket-detail.api.test.ts` | 24 |
| Lab 3 comments and notes API | `comments-notes.api.test.ts` | 15 |
| Lab 3 user management API | `users-admin.api.test.ts` | 23 |
| Lab 3 client screens | `Login`, `ChangePassword`, `AppShell`, `AppRoutes`, `StaffTicketQueue`, `StaffTicketDetail`, `UserManagement` | 82 |
| Lab 3 accessibility | `accessibility.test.tsx` | 14 |
| Lab 2 client regression | 4 files | 36, unchanged |

**The user-management suite has a database of its own.** `toktickit_users_test`
is migrated from nothing for it and dropped afterwards. The Administrator safety
rules can only be exercised by arranging who else is an active Administrator —
deactivating every other one to make somebody the last — and doing that to the
developer database would leave its seeded Administrator deactivated if a run were
interrupted halfway. It also lets API-USER-01 to API-USER-05 assert the whole
list, because every account in it was made by the suite.

**Two decisions the contract did not make, now written into `api-spec.md` §9.**
When the last active Administrator deactivates or re-roles their own account,
both BR-37 and BR-38 apply; the answer is `LAST_ACTIVE_ADMINISTRATOR`. The caller
is always an active Administrator, so the last one can only be reached on their
own account, and checking the self rule first would have made that refusal —
API-USER-15, API-USER-16, UI-USER-07 and its own message in `ui-spec.md` §9.4 —
reachable only in a race. And §9 said both that setting an initial password
deletes the account's sessions and that an Administrator doing it to themselves
lands on Change Password, which cannot both hold: on one's own account the
session making the request is now kept, as `POST /api/auth/change-password`
keeps it (API-USER-17).

**Checked against deliberate regressions.** On the server: the last-Administrator
check removed (API-USER-15 and API-USER-16 fail); deactivation leaving the
account's sessions alive (API-AUTHZ-10 fails); the self rule removed
(API-USER-13 and API-USER-14 fail). On the client: a guard-rail refusal no longer
reverting its control (UI-USER-07 fails); Role and Status left enabled on one's
own account (UI-USER-06 fails); a dialog no longer returning focus to the control
that opened it (A11Y-05 fails).

`ConfirmDialog` from Issue #32 now sits on the same `Dialog` shell as the user
dialogs, so the focus trap exists once; UI-DETAIL-06 and A11Y-05 are unchanged and
pass. `escapeLikePattern` moved from `app.ts` into `requesterContext.ts` so the
user search escapes LIKE wildcards the same way the Ticket searches do; API-LIST-02b
is unchanged and passes.

**Found in review before hand-testing, and fixed.** The lock on the active
Administrator rows had no order, so two Administrators deactivating each other at
the same moment could deadlock and one request would end in a 500 instead of a
refusal; the rows are now locked in id order. The field a guard-rail refusal named
was chosen by which fields the body carried, and the Edit dialog sends all four, so
a role refusal would have been shown under Status; it is now the change that caused
it (API-USER-13, API-USER-14 and API-USER-16 send full bodies). On the client, a
duplicate address in the Edit dialog now returns Email to its saved value, as
`ui-spec.md` §2.6 and §9.4 ask of every conflict there, while the Create dialog
still keeps what was typed (§9.3); a new account that the current filter would
hide clears the filter, so the list refreshes "with the new account visible"; and
saving one's own account hands it to the session, so the header shows a new name
at once and a new initial password leads straight to Change Password instead of a
full page reload. Each of those four was checked by reintroducing it: the field
chosen by presence (API-USER-14 and API-USER-16 fail), Email not reverted, the
filter kept, and one's own account not handed up (one UI-USER case fails each).
The lock ordering has no deterministic test — a deadlock cannot be produced on
demand — and is covered by review and by the race case of API-USER-15.

**Found in the final review before commit, and fixed.** While a new initial
password was being set, Escape could not close the Edit dialog but Cancel and
Save Changes still could, so the dialog could go away before its confirmation
line was shown; §9.3 says a saving dialog cannot be dismissed, and now neither
request can be overtaken by the other closing it. And a toast with the same words
as the one before it — saving the same account twice within four seconds — kept
the first one's timer and vanished early; each toast is now timed from when it
appears. Both were checked by reintroducing them (one UI-USER case fails each).

### After Issue #34 — end-to-end, responsive and visual QA

| Area | Files | Cases |
|---|---|---|
| Lab 3 client screens | `AppRoutes.test.tsx` gains UI-ROUTE-08 and a UI-ROUTE-05 case | 84 |
| Lab 3 end-to-end | `authentication.spec.ts`, `staff-ticket-flow.spec.ts`, `user-administration.spec.ts` | 12 |
| Lab 3 visual | `visual.spec.ts` | 3 |
| Lab 2 end-to-end and visual, updated | `e2e/lab-02/requester-ticket-flow.spec.ts`, `e2e/lab-02/visual.spec.ts` | 10 |

**Two defects the end-to-end plan exposed, fixed before the suite was written
against them.** First, a session that ended while it was in use — the account
deactivated, or a new initial password set — left the person on whatever screen
they had open, which then showed its own "couldn't load" state at the next
request, where E2E-11 and AC-24 expect Login. Every API answer passes through
`toApiError` in `client/src/api.ts`; a 401 `UNAUTHENTICATED` there now ends the
client's session, and `ui-spec.md` §3 records the rule (UI-ROUTE-08). A refused
login is `INVALID_CREDENTIALS` and `GET /me` handles its own 401, so neither is
affected. Second, saving the mandatory new password handed the updated user up
but left the address at `/change-password`, which the signed-in route tree
answers with the *voluntary* form — so the person was shown the form again
instead of the application `ui-spec.md` §5 promises; it now navigates to the
role's landing screen (a new UI-ROUTE-05 case). Both were checked by
reintroducing them: M13, the 401 not reported (UI-ROUTE-08 fails), and M14, the
mandatory change not navigating (the UI-ROUTE-05 case fails).

**A third, found by the first Playwright run.** At 375px the Change Password
screen was 391px wide, so the page scrolled sideways (VIS-03). Inside the
application shell its card kept the `width: 100%` it has on the Login screen and
added the 16px mobile margin to it; there it now takes `width: auto`, which
still stops at 420px on wider screens. Only a real browser lays the page out, so
VIS-03 is the test that holds it.

**Found reading the screenshots against §5.** Six places where the screens
departed from `ui-spec.md`, none of which a passing test had noticed. The Login
failure was bare red text rather than the `--zg-error-bg` callout §4.2 describes
(now `zg-callout--error`; UI-LOGIN-04 asserts it). "Unassigned" was plain text in
the queue table, where §5 wants it recognisable at a glance as it already was on
the card (UI-QUEUE-01 asserts the class). The mobile navigation panel named the
role in plain text where §3 gives it the role badge (UI-SHELL-05 asserts it). And
the headings of the forbidden and not-found states, which take focus for §12,
drew the browser's default focus ring across the whole line; a heading is not a
control, so it now draws none. And at 375px a dialog whose validation messages
made it taller than the screen let its actions scroll away, where §11 pins them
to the bottom of the sheet; the form's actions are now sticky. At the same width
a Summary too long for one line spilled out of its fixed-height read-only field
over the label beneath it — seen on the Lab 2 Ticket Detail shots, and the same
field Lab 3 uses — so read-only values now grow with their text, and both visual
specs assert that no read-only field's text is taller than its frame. The first
three were checked by reintroducing them — M15, M16 and M17, one failing case
each; the last three are layout, checked in the regenerated screenshots and, for
the spilled text, by that new assertion.

**What E2E-10 asserts through the browser, and how.** The self-deactivation and
last-Administrator refusals cannot be triggered from the screen: `ui-spec.md` §9.4
disables Role and Status on one's own account, and only one's own account can
ever be the last. E2E-10 asserts what the browser shows — the disabled controls
and their stated reason — and sends the withheld request with the browser's own
session: 409 `SELF_DEACTIVATION` while a second Administrator it created is
active, then 409 `LAST_ACTIVE_ADMINISTRATOR`, for both status and role, once that
second Administrator has been deactivated through the Edit dialog.

**Screenshots.** They fill the four directories of `ui-spec.md` §13, as
`{desktop,tablet,mobile}-{state}.png`. One state is produced rather than reached:
the queue's empty state, because the seeded database always holds tickets, so
that one list request is answered with an empty page. The guard-rail refusal
photographed in the Edit dialog is the duplicate address (§9.4), a real 409 with
its field reverted; the other two guard rails are photographed as they are met,
disabled with their reason (`edit-own`). VIS-02 also asserts the two queue
columns hidden at 768px, and VIS-03 that cards replace both tables.

**Lab 2's end-to-end tests, updated with the reason recorded
(`specification.md` §10).** They chose a Development Requester from the
selector Lab 3 removed (AC-25), so each now signs in as a fixture account.
E2E-02's guard lands on Login rather than the selector; E2E-04's foreign ticket
reads as the not-found state Issue #32 introduced; E2E-07 starts at Login. The
Lab 2 visual spec no longer photographs Requester Selection — the three
`select-requester` screenshots were deleted with the screen — and photographs My
Tickets over twelve tickets it raises itself, because the demo data belongs to a
seeded Requester whose password the suite cannot rely on. Its attachment-limit
shot now also waits for the last upload to land: the active count includes
uploads in flight, so it read five while one row still said "Uploading…", and
that is how it was first photographed. The shared steps moved from
`e2e/lab-02/helpers.ts` to `e2e/support/helpers.ts`.

**Recorded run.** `npm run test:e2e`: 25 passed (1.3m), the teardown removing
the run's accounts and tickets. The first run had failed four: VIS-03 on the
overflow above, and E2E-12, VIS-01 and VIS-02 on two locators of the suite's own
that matched more than one button ("Filters" also matched "Clear Filters";
"Cancel" also matched "Move to Cancelled"), now matched exactly.

The migration suite creates a scratch database, replays the real migration
files in order, pauses after the last Lab 2 migration to insert Lab 2-shaped
rows, applies the two Lab 3 migrations to them, and drops the database
afterwards. It is the actual shipped SQL under test, not a description of it,
and it is why AC-08 can be claimed rather than asserted.

## 8. Known Limitations and Deferred Tests

### Deferred within the sprint

None remain.

Cleared during the sprint: **API-AUTH-17** and **API-AUTH-18** (Issue #29 built
the gate, Issue #30 gave it endpoints to stand in front of) and **MIG-06**,
**MIG-07** and **MIG-08** (Issue #30 removed `GET /api/requesters` and the
`X-Requester-Id` mechanism with the selector that used them). **API-AUTHZ-02**
was cleared in Issue #31, with the queue it refuses. **API-AUTHZ-03**, **UNIT-03**
and the widening of `GET /api/tickets/:id` and the two attachment reads to staff
were cleared in Issue #32, with the operations they concern. **API-AUTHZ-04**,
**API-AUTHZ-05**, the Administrator half of **UI-SHELL-02**, and the user-dialog
halves of **A11Y-01**, **A11Y-03** and **A11Y-05** were cleared in Issue #33, with
user management. **E2E-01** to **E2E-12** and **VIS-01** to **VIS-03** were
written and passed in Issue #34, the issue they were planned for.

### Temporary, and deliberately so

None remain. `ScreenNotYetBuilt` in `App.tsx` held the paths whose screens
belonged to later issues so that no role signed in to a blank page; the queue
replaced it on `/staff/tickets` in #31, the staff Ticket Detail on `/tickets/:id`
in #32, and User Management on `/admin/users` in #33, which deleted the
component.

### Standing limitations

- **Timing-safety of the login response (BR-14) is asserted structurally, not
  statistically.** API-AUTH-08 proves that no lockout occurs and that the same
  body is returned; that the unknown-email branch performs a real bcrypt
  comparison is verified by a spy on the hashing call, because a wall-clock
  assertion would be flaky on shared CI hardware and would prove less.
- **`Secure` on the session cookie (BR-15) is tested only for its development
  value.** The attribute is set from an environment flag; the test asserts the
  flag is honoured, since the suite has no HTTPS origin to observe the real
  behaviour on.
- **Accessibility is checked by A11Y-01..09, the §5 checklist and the focus and
  label assertions inside the screen tests — not by an automated audit tool.**
  An axe-style audit would catch contrast and landmark problems these rows do
  not; adding one is worthwhile but is outside this sprint's scope, and saying
  so is more honest than implying the coverage is complete.
