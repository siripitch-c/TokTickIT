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
| UNIT-01 | Unit | BR-07 | Hash round-trip | A hash verifies its own password, rejects another, and never equals the plaintext | `password.unit.test.ts` | Planned |
| UNIT-02 | Unit | BR-08 | Password length bounds | 7 and 73 characters rejected; 8 and 72 accepted | `password.unit.test.ts` | Planned |
| UNIT-03 | Unit | BR-30, BR-31 | Transition matrix helper | Every permitted cell allowed; every other pair rejected, including all eight self-transitions | `status-transitions.unit.test.ts` | Planned |
| UNIT-04 | Unit | BR-11 | Session expiry arithmetic | `expiresAt` is issue time + 8h; a timestamp one second past it is expired | `session.unit.test.ts` | Planned |
| UNIT-05 | Unit | BR-36 | Email normalisation | Surrounding whitespace trimmed and comparison case-folded | `password.unit.test.ts` | Planned |

### 2.2 API — Authentication — `server/tests/lab-03/auth.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-AUTH-01 | API | AC-01, BR-01 | Valid login | 200, `Set-Cookie: tt_session`, safe user object with role | `auth.api.test.ts` | Planned |
| API-AUTH-02 | API | BR-06 | Wrong password | 401 `INVALID_CREDENTIALS`, no cookie, no session row | `auth.api.test.ts` | Planned |
| API-AUTH-03 | API | BR-06 | Unknown email | Response body byte-identical to API-AUTH-02 | `auth.api.test.ts` | Planned |
| API-AUTH-04 | API | AC-05, BR-01 | Inactive account, correct password | Same 401 body again; no session created | `auth.api.test.ts` | Planned |
| API-AUTH-05 | API | BR-42 | Blank email or password | 400 `VALIDATION_ERROR` with the offending `field` | `auth.api.test.ts` | Planned |
| API-AUTH-06 | API | BR-36 | Capitalised and padded email | Logs in successfully | `auth.api.test.ts` | Planned |
| API-AUTH-07 | API | BR-07 | Login response contents | No `passwordHash`, no session id anywhere in the body | `auth.api.test.ts` | Planned |
| API-AUTH-08 | API | BR-14 | Ten consecutive failures | No lockout: the eleventh attempt with the correct password succeeds | `auth.api.test.ts` | Planned |
| API-AUTH-09 | API | FR-03, BR-13 | `GET /api/auth/me` with a session | 200 with the safe user object | `auth.api.test.ts` | Planned |
| API-AUTH-10 | API | BR-13 | `GET /api/auth/me` with no session | 401 `UNAUTHENTICATED` — never 200 with a null user | `auth.api.test.ts` | Planned |
| API-AUTH-11 | API | AC-06, BR-10 | Logout then replay the cookie | 204; session row deleted; replay answers 401 | `auth.api.test.ts` | Planned |
| API-AUTH-12 | API | BR-15 | Cookie attributes | `HttpOnly`, `SameSite=Lax`, `Path=/` present on the login response | `auth.api.test.ts` | Planned |
| API-AUTH-13 | API | BR-11 | Session past `expiresAt` | 401, and the expired row is deleted | `auth.api.test.ts` | Planned |
| API-AUTH-14 | API | BR-09, BR-12 | Successful password change | 200, `mustChangePassword:false`, old password fails, other sessions of that user are gone, the current one survives | `auth.api.test.ts` | Planned |
| API-AUTH-15 | API | BR-42 | Wrong `currentPassword` | 400 with `field:"currentPassword"` — not 401 | `auth.api.test.ts` | Planned |
| API-AUTH-16 | API | BR-08, BR-09 | Change-password validation | Too short, too long, same as current, mismatched confirmation each answer 400 with the right `field` | `auth.api.test.ts` | Planned |
| API-AUTH-17 | API | AC-02, BR-02 | `mustChangePassword` user calls any other endpoint | 403 `PASSWORD_CHANGE_REQUIRED` | `auth.api.test.ts` | Planned |
| API-AUTH-18 | API | BR-02 | The three exempt endpoints while `mustChangePassword` | `me`, `change-password` and `logout` all work | `auth.api.test.ts` | Planned |

### 2.3 API — Authorization and safe errors — `server/tests/lab-03/authorization.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-AUTHZ-01 | API | BR-19 | Table-driven: every protected endpoint with no cookie | 401 `UNAUTHENTICATED` for all of them | `authorization.api.test.ts` | Planned |
| API-AUTHZ-02 | API | AC-07 | Requester → `GET /api/staff/tickets` and `/api/staff/assignees` | 403 `FORBIDDEN` | `authorization.api.test.ts` | Planned |
| API-AUTHZ-03 | API | BR-05, BR-32 | Requester → owner, IT-priority and status endpoints on their own Ticket | 403 `FORBIDDEN`; nothing changes | `authorization.api.test.ts` | Planned |
| API-AUTHZ-04 | API | AC-21 | Requester → every `/api/users` endpoint | 403 `FORBIDDEN` | `authorization.api.test.ts` | Planned |
| API-AUTHZ-05 | API | AC-21 | IT Staff → every `/api/users` endpoint | 403 `FORBIDDEN` | `authorization.api.test.ts` | Planned |
| API-AUTHZ-06 | API | BR-19 | IT Staff → `POST /api/tickets` and `GET /api/tickets` | 403 `FORBIDDEN` | `authorization.api.test.ts` | Planned |
| API-AUTHZ-07 | API | BR-16 | Requester → another Requester's Ticket | 404, body identical to a Ticket id that never existed | `authorization.api.test.ts` | Planned |
| API-AUTHZ-08 | API | AC-03, AC-25, BR-03 | Requester sends `X-Requester-Id` naming someone else | Header ignored; own data returned; never the other user's | `authorization.api.test.ts` | Planned |
| API-AUTHZ-09 | API | BR-16 | Requester → attachment metadata and download on another's Ticket | 404 `ATTACHMENT_NOT_FOUND` both times | `authorization.api.test.ts` | Planned |
| API-AUTHZ-10 | API | AC-24, BR-12 | Administrator deactivates a user holding a live session | The next request on that session answers 401 | `authorization.api.test.ts` | Planned |
| API-AUTHZ-11 | API | BR-07 | Sweep every endpoint's success and error bodies | No `passwordHash`, no session identifier in any of them | `authorization.api.test.ts` | Planned |
| API-ERR-01 | API | BR-43 | Forced internal failure | 500 `INTERNAL_ERROR` with a generic message; no stack trace, SQL, or file path | `authorization.api.test.ts` | Planned |
| API-ERR-02 | API | BR-43 | Envelope shape on 401, 403, 404, 409 | All four use the `api-spec.md` §1 envelope, never Express's HTML page | `authorization.api.test.ts` | Planned |

### 2.4 API — IT Staff queue — `server/tests/lab-03/staff-queue.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-QUEUE-01 | API | AC-09 | IT Staff queue contents | Tickets from every Requester, each with owner, status and both priorities | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-02 | API | AC-09, BR-40 | `search` | Matches ticket number and summary, case-insensitive partial | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-03 | API | AC-09, BR-40 | Each filter alone | Category, requested priority, IT priority and status each narrow correctly | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-04 | API | BR-40 | `owner` | `unassigned` returns only null-owner rows; an id returns only that owner's | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-05 | API | BR-40 | Combined filters | AND semantics | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-06 | API | BR-40 | Each sortable field, both directions | Ordering correct; ties break by `ticketNumber desc` | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-07 | API | BR-40 | `sortBy=itPriority` | HIGH→MEDIUM→LOW by rank, not alphabetically; nulls last in `desc` | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-08 | API | BR-40 | Defaults | No parameters gives `updatedAt desc` and `pageSize` 25 | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-09 | API | AC-28, BR-40 | Every parameter with a junk value | Falls back to that parameter's default; never 400 | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-10 | API | BR-40 | Page past the end | `data: []` with accurate metadata, not an error | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-11 | API | BR-40 | Pagination envelope | Same four fields and shape as Lab 2 | `staff-queue.api.test.ts` | Planned |
| API-QUEUE-12 | API | FR-16, BR-25 | `GET /api/staff/assignees` | Active IT Staff and Administrators only; no Requester, no inactive user, no email field | `staff-queue.api.test.ts` | Planned |

### 2.5 API — IT Staff ticket operations — `server/tests/lab-03/staff-ticket-detail.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-TICKET-01 | API | BR-17 | Staff read another Requester's Ticket | 200 with the full Ticket object | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-02 | API | AC-10 | Claim an unassigned Ticket | Owner becomes the caller; visible to a second staff session | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-03 | API | AC-11 | Reassign to another active staff user | Ownership moves | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-04 | API | AC-11, BR-25 | Assign to an inactive user, a Requester, or an unknown id | 400 `INVALID_OWNER` each time; owner unchanged | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-05 | API | BR-28 | `ownerId: null` | Ticket returns to unassigned | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-06 | API | BR-28 | A staff member who is not the owner reassigns | Permitted | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-07 | API | AC-12, BR-29 | Set IT Priority | `itPriority` changes; `requestedPriority` is untouched | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-08 | API | BR-42 | `itPriority: null` or an unknown value | 400 `VALIDATION_ERROR` (`field: "itPriority"`) | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-09 | API | BR-31 | Table-driven: every permitted transition | Each succeeds and persists | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-10 | API | AC-13, BR-31 | Table-driven: every non-permitted pair | 409 `INVALID_STATUS_TRANSITION`; status unchanged | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-11 | API | BR-31 | Status set to its current value | 409, not a silent success | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-12 | API | AC-16, BR-05, BR-34 | Requester marks appears-resolved | `requesterResolvedAt` set; `currentStatus` unchanged; visible to staff | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-13 | API | BR-34 | Appears-resolved twice | 409 `ALREADY_INDICATED`; the first timestamp is not overwritten | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-14 | API | BR-34 | Appears-resolved on a Resolved, Closed or Cancelled Ticket | 409 `RESOLUTION_NOT_APPLICABLE` | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-15 | API | BR-16 | Appears-resolved by staff, and by another Requester | 403 for staff; 404 for the other Requester | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-16 | API | AC-26, FR-21 | Staff read and download an attachment on a Ticket they do not own | 200 with the original filename | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-17 | API | FR-21 | Staff attempt attachment upload and removal | 403 both times | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-18 | API | BR-27, BR-29 | A Ticket created in Lab 3 | Starts unassigned, status New, `itPriority` equal to `requestedPriority` | `staff-ticket-detail.api.test.ts` | Planned |
| API-TICKET-19 | API | BR-26 | Owner is deactivated | The Ticket keeps that owner and stays reassignable | `staff-ticket-detail.api.test.ts` | Planned |

### 2.6 API — Comments and notes — `server/tests/lab-03/comments-notes.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-COMMENT-01 | API | AC-14, BR-04, BR-22 | Requester comments on their own Ticket | 201; author and `createdAt` come from the server; readable by staff and Administrator | `comments-notes.api.test.ts` | Planned |
| API-COMMENT-02 | API | BR-04 | Staff comment on any Ticket | 201; readable by that Ticket's Requester | `comments-notes.api.test.ts` | Planned |
| API-COMMENT-03 | API | BR-16 | Requester comments on another's Ticket | 404 `TICKET_NOT_FOUND` | `comments-notes.api.test.ts` | Planned |
| API-COMMENT-04 | API | BR-23, BR-42 | Empty, whitespace-only, and 2001-character bodies | 400 `VALIDATION_ERROR` (`field: "body"`) | `comments-notes.api.test.ts` | Planned |
| API-COMMENT-05 | API | BR-23 | Boundary bodies | 1 character and 2000 characters both accepted | `comments-notes.api.test.ts` | Planned |
| API-COMMENT-06 | API | BR-22 | Client supplies `author` and `createdAt` | Ignored; the server's values are stored | `comments-notes.api.test.ts` | Planned |
| API-COMMENT-07 | API | BR-22 | Ordering | Oldest first | `comments-notes.api.test.ts` | Planned |
| API-NOTE-01 | API | AC-15, BR-04 | Staff create and read an Internal Note | 201 then 200; author and time from the server | `comments-notes.api.test.ts` | Planned |
| API-NOTE-02 | API | **AC-04**, BR-20 | Requester requests Internal Notes on their **own** Ticket | 404, identical to a non-existent Ticket; no note content, not even an empty array | `comments-notes.api.test.ts` | Planned |
| API-NOTE-03 | API | AC-04, BR-20 | Requester posts an Internal Note | 404 | `comments-notes.api.test.ts` | Planned |
| API-NOTE-04 | API | AC-15, BR-20 | Every Requester-visible response for a Ticket carrying notes | No note body, author or count appears anywhere in any of them | `comments-notes.api.test.ts` | Planned |
| API-NOTE-05 | API | BR-23 | Note body validation | Same bounds and same `field` as comments | `comments-notes.api.test.ts` | Planned |
| API-NOTE-06 | API | BR-04 | Administrator reads and posts notes | Permitted | `comments-notes.api.test.ts` | Planned |
| API-NOTE-07 | API | BR-21 | Edit and delete routes for comments and notes | No such route exists — `PATCH`/`PUT`/`DELETE` answer 404 `NOT_FOUND` | `comments-notes.api.test.ts` | Planned |

### 2.7 API — Administrator user management — `server/tests/lab-03/users-admin.api.test.ts`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| API-USER-01 | API | FR-22, BR-41 | User list | All users including inactive, ordered by name ascending | `users-admin.api.test.ts` | Planned |
| API-USER-02 | API | AC-27 | Search | Partial, case-insensitive match on name and on email | `users-admin.api.test.ts` | Planned |
| API-USER-03 | API | AC-27 | Role filter | Only that role; combines with search | `users-admin.api.test.ts` | Planned |
| API-USER-04 | API | BR-41 | Junk query values | Ignored; full list returned; never 400 | `users-admin.api.test.ts` | Planned |
| API-USER-05 | API | BR-41 | Response shape | A plain `data` array with no pagination metadata | `users-admin.api.test.ts` | Planned |
| API-USER-06 | API | AC-22, BR-35 | Create a user | 201; exactly one role; `mustChangePassword: true` | `users-admin.api.test.ts` | Planned |
| API-USER-07 | API | AC-17, BR-36 | Duplicate email, including a different capitalisation | 409 `EMAIL_ALREADY_EXISTS`; no user created | `users-admin.api.test.ts` | Planned |
| API-USER-08 | API | BR-42 | Creation validation | Name length, email format, missing `isActive`, password length each 400 with the right `field` | `users-admin.api.test.ts` | Planned |
| API-USER-09 | API | BR-18 | Role as an array, or an unknown value | 400; no user created, and no first-element fallback | `users-admin.api.test.ts` | Planned |
| API-USER-10 | API | AC-23, BR-35 | Edit name, email, role and activation state | Each persists; omitted fields are untouched | `users-admin.api.test.ts` | Planned |
| API-USER-10b | API | BR-42 | `PATCH` and set-initial-password on an id that does not exist | 404 `USER_NOT_FOUND` for both | `users-admin.api.test.ts` | Planned |
| API-USER-11 | API | BR-42 | `PATCH` with none of the four fields | 400 `VALIDATION_ERROR` | `users-admin.api.test.ts` | Planned |
| API-USER-12 | API | BR-36 | Edit to an email another user holds | 409 `EMAIL_ALREADY_EXISTS` | `users-admin.api.test.ts` | Planned |
| API-USER-13 | API | AC-20, BR-37 | Administrator deactivates themselves | 409 `SELF_DEACTIVATION`; account still active | `users-admin.api.test.ts` | Planned |
| API-USER-14 | API | BR-37 | Administrator changes their own role away from Administrator | 409 `SELF_DEACTIVATION` | `users-admin.api.test.ts` | Planned |
| API-USER-15 | API | AC-19, BR-38 | Deactivate the last active Administrator | 409 `LAST_ACTIVE_ADMINISTRATOR`; still active | `users-admin.api.test.ts` | Planned |
| API-USER-16 | API | AC-19, BR-38 | Re-role the last active Administrator | 409; role unchanged | `users-admin.api.test.ts` | Planned |
| API-USER-17 | API | AC-18, BR-12, BR-35 | Set a new initial password | `mustChangePassword: true`; that user's sessions are deleted | `users-admin.api.test.ts` | Planned |
| API-USER-18 | API | AC-18 | Log in with the new initial password | Succeeds, then every other endpoint answers 403 `PASSWORD_CHANGE_REQUIRED`; the old password fails | `users-admin.api.test.ts` | Planned |
| API-USER-19 | API | BR-39 | `DELETE /api/users/:id` | 404 `NOT_FOUND` — the route does not exist | `users-admin.api.test.ts` | Planned |
| API-USER-20 | API | BR-07 | Every user response | No `passwordHash`, and the initial password is never echoed | `users-admin.api.test.ts` | Planned |

### 2.8 Migration and Lab 2 regression — `server/tests/lab-03/migration.api.test.ts`

Beyond the handout's minimum file list; migration is graded evidence
(handout §5.2, Part 2) and needed a file of its own rather than being folded
into another suite.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| MIG-01 | Migration | AC-08 | Lab 2 `Requester` rows after migration | Present as `User` rows with the same ids and names — the table was renamed, not dropped and recreated | `migration.api.test.ts` | Planned |
| MIG-02 | Migration | AC-08 | Pre-existing Tickets and Attachments | Ticket number, requester, fields and attachment rows all unchanged and readable by the original owner | `migration.api.test.ts` | Planned |
| MIG-03 | Migration | AC-08, BR-36 | Migrated account state | `role: REQUESTER`, `mustChangePassword: true`, no usable password until changed, and every migrated `email` stored lower-cased | `migration.api.test.ts` | Planned |
| MIG-04 | Migration | BR-29 | `itPriority` backfill | Every migrated Ticket has `itPriority` equal to its `requestedPriority` | `migration.api.test.ts` | Planned |
| MIG-05 | Migration | BR-27 | Ownership of migrated Tickets | `ownerId` is null — unassigned | `migration.api.test.ts` | Planned |
| MIG-06 | Migration | AC-25 | `GET /api/requesters` | 404 `NOT_FOUND`; the route is gone | `migration.api.test.ts` | Planned |
| MIG-07 | Migration | AC-03, BR-03 | `X-Requester-Id` after migration | Has no effect on any endpoint, with or without a session | `migration.api.test.ts` | Planned |
| MIG-08 | Regression | BR-44 | Every Lab 2 Requester endpoint under a session | Create, list, detail, upload, download and soft-remove all behave as `docs/lab-02/api-spec.md` describes, except that a missing identity is now 401 rather than 400 | `migration.api.test.ts` | Planned |
| MIG-09 | Migration | BR-45 | Seed idempotency | Running the seed twice leaves the same row counts and no duplicate emails | `migration.api.test.ts` | Planned |
| MIG-10 | Migration | BR-45 | Seed composition | At least 4 active + 1 inactive Requester, 3 active + 1 inactive IT Staff, 1 active Administrator, Tickets across statuses/priorities/assigned and unassigned, plus example comments and notes | `migration.api.test.ts` | Planned |

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

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| UI-LOGIN-01 | UI | FR-01 | Initial render | Email, password, show/hide toggle, Sign In; no "forgot password" or "create account" link | `Login.test.tsx` | Planned |
| UI-LOGIN-02 | UI | BR-42 | Empty submit | Per-field messages below each control; no request sent | `Login.test.tsx` | Planned |
| UI-LOGIN-03 | UI | AC-01 | Successful login | Navigates to the role's landing route | `Login.test.tsx` | Planned |
| UI-LOGIN-04 | UI | AC-05, BR-06 | 401 response | One safe callout; both values kept; password not cleared | `Login.test.tsx` | Planned |
| UI-LOGIN-05 | UI | BR-43 | Network failure | Safe failure callout; Sign In usable again | `Login.test.tsx` | Planned |
| UI-LOGIN-06 | UI | FR-01 | Busy state | Button busy and disabled, fields disabled, `aria-busy` set | `Login.test.tsx` | Planned |
| UI-PWD-01 | UI | AC-02, BR-02 | Mandatory mode | Banner shown; no navigation items; a typed route returns here | `ChangePassword.test.tsx` | Planned |
| UI-PWD-02 | UI | FR-06 | Voluntary mode | Navigation intact, no banner, Cancel returns to the previous screen | `ChangePassword.test.tsx` | Planned |
| UI-PWD-03 | UI | BR-08 | Length rule | Helper text visible before any error; 7 and 73 characters rejected inline | `ChangePassword.test.tsx` | Planned |
| UI-PWD-04 | UI | BR-09 | Mismatch and reuse | Confirmation mismatch and "same as current" each show under the right field | `ChangePassword.test.tsx` | Planned |
| UI-PWD-05 | UI | BR-42 | Wrong current password | Message appears under `Current Password`, not as a screen failure | `ChangePassword.test.tsx` | Planned |
| UI-PWD-06 | UI | AC-02 | Success | Navigates to the role's landing route | `ChangePassword.test.tsx` | Planned |
| UI-SHELL-01 | UI | FR-09, AC-07 | Requester navigation | My Tickets and Create Ticket only; no queue or admin destination rendered at all | `AppShell.test.tsx` | Planned |
| UI-SHELL-02 | UI | FR-09 | IT Staff and Administrator navigation | Queue for staff; User Management first plus Queue for the Administrator | `AppShell.test.tsx` | Planned |
| UI-SHELL-03 | UI | FR-09 | Header identity | Authenticated name and role badge shown; no Change Requester control anywhere | `AppShell.test.tsx` | Planned |
| UI-SHELL-04 | UI | AC-06 | Logout | Calls the endpoint and lands on Login | `AppShell.test.tsx` | Planned |
| UI-SHELL-05 | UI | FR-09 | Mobile panel at 375px | Role items, then name, role badge, Change Password and Log Out as full-width rows | `AppShell.test.tsx` | Planned |
| UI-QUEUE-01 | UI | AC-09 | Desktop table | Nine columns in the specified order, with badges | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-02 | UI | AC-09 | Search and filters | Each control issues the right query parameter | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-03 | UI | AC-09 | Sorting | Clicking a sortable header starts descending and returns to page 1 | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-04 | UI | AC-09 | Pagination | Page size default 25; Previous/Next and page numbers work | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-05 | UI | AC-09 | Empty vs no-results | Two distinct blocks; no-results offers Clear Filters | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-06 | UI | AC-07 | 403 response | `zg-state--forbidden`, not the generic failure block | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-07 | UI | BR-43 | 500 response | Safe failure block with Retry | `StaffTicketQueue.test.tsx` | Planned |
| UI-QUEUE-08 | UI | AC-09 | Mobile at 375px | Cards, not a table; unassigned tickets visibly flagged | `StaffTicketQueue.test.tsx` | Planned |
| UI-DETAIL-01 | UI | AC-04, BR-20 | Requester view | No Internal Notes panel, heading, empty state or any other trace | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-02 | UI | FR-14 | Staff view | Operations panel present; Add and Remove attachment controls absent; Download present | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-03 | UI | AC-10, AC-11 | Owner control | Claim sets the signed-in user; the select lists only active staff and Administrators | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-04 | UI | AC-12 | IT Priority control | Saves on change; Requested Priority shown read-only above it | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-05 | UI | AC-13, BR-31 | Status select | Offers only transitions permitted from the current status | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-06 | UI | BR-33 | Closed and Cancelled | Confirmation dialog first; focus trapped and returned; Cancel leaves the status unchanged | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-07 | UI | AC-13 | 409 from a control | Inline message; the control reverts; the other two controls are unaffected | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-08 | UI | BR-23, BR-24 | Comment composer | Counter, disabled submit when empty or over 2000, and a body containing markup rendered as literal text | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-09 | UI | AC-15 | The two threads | Internal panel carries its warning border, lock header, distinct placeholder and "Add Internal Note" button; the panels are never adjacent | `StaffTicketDetail.test.tsx` | Planned |
| UI-DETAIL-10 | UI | AC-16, BR-34 | Problem Appears Resolved | Present for the owning Requester; absent for staff; replaced by a dated line once set | `StaffTicketDetail.test.tsx` | Planned |
| UI-USER-01 | UI | FR-22 | User list | Name, Email, Role badge, Status, Edit — five columns, no sort headers, no pagination | `UserManagement.test.tsx` | Planned |
| UI-USER-02 | UI | AC-27 | Search and role filter | Both issue the right query; clearing search restores the list | `UserManagement.test.tsx` | Planned |
| UI-USER-03 | UI | AC-22 | Create dialog | All five fields; role is single-select; helper text states the password rule | `UserManagement.test.tsx` | Planned |
| UI-USER-04 | UI | AC-17 | Duplicate email 409 | Inline message on the Email field; dialog stays open with values kept | `UserManagement.test.tsx` | Planned |
| UI-USER-05 | UI | AC-23 | Edit dialog | Pre-filled; Set New Initial Password is a separate section with its own button | `UserManagement.test.tsx` | Planned |
| UI-USER-06 | UI | AC-20, BR-37 | Editing one's own account | Status and Role disabled with an explanatory helper line | `UserManagement.test.tsx` | Planned |
| UI-USER-07 | UI | AC-19 | Last-Administrator 409 | Inline message; the control reverts | `UserManagement.test.tsx` | Planned |
| UI-USER-08 | UI | AC-18 | Set new initial password | Confirmation line shown; the password is never redisplayed | `UserManagement.test.tsx` | Planned |
| UI-USER-09 | UI | AC-21 | Non-Administrator reaches the route | `zg-state--forbidden` | `UserManagement.test.tsx` | Planned |

### 2.10 Accessibility — `client/tests/lab-03/accessibility.test.tsx`

The handout's §10 names accessibility among the coverage students must identify,
and Part 9 grades focus behaviour. Lab 3 adds no accessibility *rule* of its
own — Lab 2 §9 and `ui-spec.md` §12 are the contract — but it adds controls the
rules have to be proven against, so they get rows rather than living only in the
§5 checklist. A seventh client file, for the same reason `AppShell.test.tsx`
exists: these assertions span screens.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| A11Y-01 | UI | ui-spec §12 | Label association | Every field on Login, Change Password and both user dialogs is reachable by its visible label text | `accessibility.test.tsx` | Planned |
| A11Y-02 | UI | ui-spec §12 | Password show/hide toggles | Carry `title` and `aria-label`, and the label changes with the state | `accessibility.test.tsx` | Planned |
| A11Y-03 | UI | ui-spec §12 | Announced refusals | The login failure callout and every inline 409 message carry `role="alert"` | `accessibility.test.tsx` | Planned |
| A11Y-04 | UI | ui-spec §12, BR-20 | Internal Notes heading | A real heading in the document outline, positioned before its composer | `accessibility.test.tsx` | Planned |
| A11Y-05 | UI | ui-spec §12 | Dialog focus | Create User, Edit User and the status confirmation trap focus and return it to the trigger on close | `accessibility.test.tsx` | Planned |
| A11Y-06 | UI | ui-spec §12 | Colour is never the only signal | All eight status badges, all three priority badges and all three role badges render their label text | `accessibility.test.tsx` | Planned |
| A11Y-07 | UI | ui-spec §12 | Status select description | Carries `aria-describedby` naming the current status, since its option list changes with it | `accessibility.test.tsx` | Planned |
| A11Y-08 | UI | ui-spec §12 | Refusal states take focus | `zg-state--forbidden` and `zg-state--not-found` move focus to their heading | `accessibility.test.tsx` | Planned |
| A11Y-09 | UI | ui-spec §12 | Threads are lists | Both threads render as `<ol>` so position and count are announced | `accessibility.test.tsx` | Planned |

### 2.11 E2E — `e2e/lab-03/`

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| E2E-01 | E2E | AC-01, AC-06 | Log in, use the app, log out, then reuse the URL | Landing screen per role; after logout the direct URL returns to Login and the API refuses | `authentication.spec.ts` | Planned |
| E2E-02 | E2E | **AC-02** | Initial-password login and change | Normal application opens only after a valid new password is saved | `authentication.spec.ts` | Planned |
| E2E-03 | E2E | AC-05 | Invalid password, unknown email, inactive account | The same message and the same busy/failure feedback in all three cases | `authentication.spec.ts` | Planned |
| E2E-04 | E2E | AC-07, AC-21 | Role navigation and direct URLs | Each role sees only its own destinations; typing another role's URL yields the forbidden state and the API refuses | `authentication.spec.ts` | Planned |
| E2E-05 | E2E | AC-08, BR-44 | Requester regression under authentication | Create a Ticket, find it in My Tickets, open Detail, add and download an Attachment — no selector anywhere | `staff-ticket-flow.spec.ts` | Planned |
| E2E-06 | E2E | AC-09 | Queue in the browser | Search, filter, sort and paginate, then open Ticket Detail | `staff-ticket-flow.spec.ts` | Planned |
| E2E-07 | E2E | AC-10, AC-12, AC-13, AC-14, AC-15 | Full staff operation | Claim, set IT Priority, move status, post a Public Comment, add an Internal Note; the Requester then sees the comment and no trace of the note | `staff-ticket-flow.spec.ts` | Planned |
| E2E-08 | E2E | AC-16 | Requester resolution signal | Requester marks it; staff see it; status unchanged until staff resolve the Ticket | `staff-ticket-flow.spec.ts` | Planned |
| E2E-09 | E2E | AC-22, AC-18 | Administrator creates a user | The new account signs in and is forced through Change Password before reaching the application | `user-administration.spec.ts` | Planned |
| E2E-10 | E2E | AC-19, AC-20, AC-23, AC-27 | Administrator screen | Search, role filter, edit, duplicate-email refusal, self-deactivation refusal, last-Administrator refusal | `user-administration.spec.ts` | Planned |
| E2E-11 | E2E | AC-24 | Deactivation while signed in | The deactivated user's next action returns them to Login | `user-administration.spec.ts` | Planned |
| E2E-12 | E2E | AC-09 | Staff flow at 375px | Login, queue cards, and Ticket Detail with its two threads, with no horizontal scrolling at any step. User Management at mobile is covered by VIS-03 | `staff-ticket-flow.spec.ts` | Planned |

### 2.12 Visual and responsive — `e2e/lab-03/visual.spec.ts`

A fourth E2E file beyond the handout's minimum three, matching the Lab 2
arrangement: the screenshots the §5 checklist is filled in against are captured
by their own spec rather than as a side effect of a behavioural one.

| ID | Type | AC / BR | What it tests | Expected result | File | Status |
|---|---|---|---|---|---|---|
| VIS-01 | Visual | §5 checklist | Every Lab 3 screen and state at 1440×900 | Screenshots written under `artifacts/lab-03/screenshots/`; no horizontal overflow and no clipped scroller asserted as each is taken | `visual.spec.ts` | Planned |
| VIS-02 | Visual | §5 checklist | The same at 768×1024 | As above, including the two queue columns dropped at tablet | `visual.spec.ts` | Planned |
| VIS-03 | Visual | §5 checklist | The same at 375×812 | As above, with cards replacing both tables | `visual.spec.ts` | Planned |

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
| AC-01 | API-AUTH-01, UI-LOGIN-03, E2E-01 |
| AC-02 | API-AUTH-17, API-AUTH-18, UI-PWD-01, UI-PWD-06, E2E-02 |
| AC-03 | API-AUTHZ-08, MIG-07 |
| AC-04 | API-NOTE-02, API-NOTE-03, UI-DETAIL-01 |
| AC-05 | API-AUTH-04, UI-LOGIN-04, E2E-03 |
| AC-06 | API-AUTH-11, UI-SHELL-04, E2E-01 |
| AC-07 | API-AUTHZ-02, UI-SHELL-01, UI-QUEUE-06, E2E-04 |
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
| AC-24 | API-AUTHZ-10, E2E-11 |
| AC-25 | MIG-06, UI-SHELL-03, E2E-05 |
| AC-26 | API-TICKET-16, UI-DETAIL-02 |
| AC-27 | API-USER-02, API-USER-03, UI-USER-02, E2E-10 |
| AC-28 | API-QUEUE-09 |

## 4. Business-Rule Traceability

Every rule has at least one automated test, as `specification.md` §10 requires.

| BR | Evidence IDs | BR | Evidence IDs |
|---|---|---|---|
| BR-01 | API-AUTH-01, API-AUTH-04 | BR-24 | UI-DETAIL-08 |
| BR-02 | API-AUTH-17, API-AUTH-18, UI-PWD-01 | BR-25 | API-TICKET-04, API-QUEUE-12 |
| BR-03 | API-AUTHZ-08, MIG-07 | BR-26 | API-TICKET-19 |
| BR-04 | API-COMMENT-01, API-COMMENT-02, API-NOTE-06 | BR-27 | API-TICKET-18, MIG-05 |
| BR-05 | API-AUTHZ-03, API-TICKET-12 | BR-28 | API-TICKET-05, API-TICKET-06 |
| BR-06 | API-AUTH-02, API-AUTH-03, UI-LOGIN-04 | BR-29 | API-TICKET-07, API-TICKET-18, MIG-04 |
| BR-07 | UNIT-01, API-AUTH-07, API-AUTHZ-11, API-USER-20 | BR-30 | UNIT-03 |
| BR-08 | UNIT-02, API-AUTH-16, UI-PWD-03 | BR-31 | UNIT-03, API-TICKET-09, API-TICKET-10, API-TICKET-11 |
| BR-09 | API-AUTH-14, API-AUTH-16, UI-PWD-04 | BR-32 | API-AUTHZ-03 |
| BR-10 | API-AUTH-11 | BR-33 | UI-DETAIL-06 |
| BR-11 | UNIT-04, API-AUTH-13 | BR-34 | API-TICKET-12, API-TICKET-13, API-TICKET-14 |
| BR-12 | API-AUTH-14, API-AUTHZ-10, API-USER-17 | BR-35 | API-USER-06, API-USER-10, API-USER-17, API-USER-18 |
| BR-13 | API-AUTH-09, API-AUTH-10 | BR-36 | UNIT-05, API-AUTH-06, API-USER-07, API-USER-12, MIG-03 |
| BR-14 | API-AUTH-08 | BR-37 | API-USER-13, API-USER-14, UI-USER-06 |
| BR-15 | API-AUTH-12 | BR-38 | API-USER-15, API-USER-16 |
| BR-16 | API-AUTHZ-07, API-AUTHZ-09, API-COMMENT-03, API-TICKET-15 | BR-39 | API-USER-19 |
| BR-17 | API-TICKET-01 | BR-40 | API-QUEUE-02..11 |
| BR-18 | API-USER-09 | BR-41 | API-USER-01, API-USER-04, API-USER-05 |
| BR-19 | API-AUTHZ-01, API-AUTHZ-06 | BR-42 | API-AUTH-05, API-COMMENT-04, API-USER-08, API-USER-11 |
| BR-20 | API-NOTE-02, API-NOTE-03, API-NOTE-04, UI-DETAIL-01 | BR-43 | API-ERR-01, API-ERR-02, UI-LOGIN-05, UI-QUEUE-07 |
| BR-21 | API-NOTE-07 | BR-44 | MIG-08, E2E-05 |
| BR-22 | API-COMMENT-01, API-COMMENT-06, API-COMMENT-07 | BR-45 | MIG-09, MIG-10 |
| BR-23 | API-COMMENT-04, API-COMMENT-05, API-NOTE-05, UI-DETAIL-08 |  |  |

## 5. Responsive and Visual Checklist

Completed at each of VIS-01/02/03 against `ui-spec.md` §13:

- [ ] Zen Green tokens only — no colour appears that is not in Lab 2 §1.1
- [ ] Editable vs read-only fields visually distinct on Ticket Detail, both roles
- [ ] All eight status badges distinguishable side by side, text plus colour
- [ ] Role badge visually subordinate to status and priority badges
- [ ] Public Comments and Internal Notes unmistakable: border, fill, header,
      placeholder and button label all differ
- [ ] Internal Notes completely absent from the Requester view
- [ ] Validation messages directly below their field on Login, Change Password
      and both user dialogs
- [ ] Keyboard focus visible on every new control, including inside dialogs and
      the mobile filter sheet
- [ ] Role-specific navigation shows no destination the role may not use
- [ ] Forbidden, not-found and generic failure states distinguishable from each
      other
- [ ] No clipped labels, overlap, or horizontal scroll — especially the
      nine-column queue at 992px and the dropped columns at 768px
- [ ] Unassigned tickets recognisable at a glance in both table and card

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
# E2E + visual. Run from the repository root with the client and the API
# already running; Playwright reuses whatever is listening on 5173/3000.
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

## 7. Final Results

To be completed from the final `main` branch, in the format Lab 2 used: the
full `npm test` output for server and client, the Playwright summary, and this
plan's Status column updated to Pass for every row.

| Suite | Command | Tests | Result |
|---|---|---|---|
| Server unit + API + migration | `npm test --prefix server` | — | Pending |
| Client UI components | `npm test --prefix client` | — | Pending |
| E2E + visual | `npm run test:e2e` | — | Pending |

## 8. Known Limitations and Deferred Tests

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
