# Lab 3 API Contract

This document is the authoritative, exact contract for every Lab 3 endpoint.
`specification.md` §8 is only a summary; this file is what the implementation
and the tests must match verbatim — field names, parameter names, cookie
attributes and status codes here are final unless they are changed here first.

Lab 2 endpoints that survive with their shape intact are covered in §6, which
spells out only what changes about them; `docs/lab-02/api-spec.md` remains the
reference for their request and response bodies.

## 1. Conventions

- **Base path:** `/api`
- **Identity:** an authenticated **session cookie**. The Lab 2
  `X-Requester-Id` header is removed from the contract entirely: it is not
  read, and sending it has no effect on any endpoint (BR-03, AC-25). Every
  protected endpoint derives the acting user from the session and from nothing
  else.
- **Session cookie:** name `tt_session`, value an opaque 256-bit random
  identifier that is the primary key of a `Session` row. Attributes
  `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` outside development —
  meaning everywhere except an unset `NODE_ENV`, `development` and `test`,
  which are the environments that run over plain http and where a `Secure`
  cookie would simply never be sent back (BR-15). `Max-Age` is 8 hours, matching the server-side `expiresAt` (BR-11).
  The cookie is set by `POST /api/auth/login` and cleared by
  `POST /api/auth/logout`. No session identifier is ever returned in a response
  body (BR-07, BR-13).
- **Cross-origin:** the client runs on `http://localhost:5173` and the API on
  `http://localhost:3000`, so the API answers with
  `Access-Control-Allow-Origin: <the configured client origin>` and
  `Access-Control-Allow-Credentials: true`. A wildcard origin is never used —
  it is incompatible with credentialed requests. The client sends every request
  with `credentials: "include"`.
- **CSRF:** `SameSite=Lax` is the control (BR-15). This contract has no CSRF
  token endpoint and no `X-CSRF-Token` header.
- **Content type:** `application/json` for all bodies except attachment upload,
  which stays `multipart/form-data`.
- **Timestamps:** ISO 8601 UTC strings (e.g. `2026-05-12T09:14:00.000Z`).
- **Error envelope** — unchanged from Lab 2, and used for every non-2xx
  response including 401 and 403:
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Password must be between 8 and 72 characters.",
      "field": "newPassword"
    }
  }
  ```
  `field` is omitted when the error is not tied to one request field. `code` is
  a stable machine-readable string; `message` is human-readable, safe to show
  directly, and never contains a stack trace, SQL, file path, another user's
  email address, or password material (BR-43).
- **Pagination envelope** — unchanged from Lab 2, and reused by the IT Staff
  queue:
  ```json
  {
    "data": [ /* array of items */ ],
    "pagination": { "page": 1, "pageSize": 25, "totalItems": 84, "totalPages": 4 }
  }
  ```
- **Lenient reads, strict writes.** The Lab 2 split is preserved. `GET` query
  parameters never produce a 400: an unknown key, an invalid enum value or an
  unparseable number falls back to that parameter's default (BR-40, AC-28).
  Request *bodies* on write endpoints are validated strictly and answer 400
  (BR-42).

## 2. Enums

- `Role`: `REQUESTER` | `IT_STAFF` | `ADMINISTRATOR` — exactly one per user
  (BR-18).
- `RequestedPriority`: `LOW` | `MEDIUM` | `HIGH` — unchanged from Lab 2, and
  never modified after creation (BR-29).
- `ITPriority`: `LOW` | `MEDIUM` | `HIGH`. Unlike Lab 2 this is no longer
  always `null`: it is initialised from `requestedPriority` when a Ticket is
  created, and is writable by IT Staff and Administrator (BR-29). The column
  stays nullable only so the migration can backfill Lab 2 rows.
- `CurrentStatus`: `NEW` | `OPEN` | `IN_PROGRESS` | `WAITING_FOR_REQUESTER` |
  `RESOLVED` | `CLOSED` | `REOPENED` | `CANCELLED` (BR-30). Lab 2 shipped this
  column as an enum holding a single value precisely so this sprint could add
  the other seven without a column-type migration.

## 3. Authentication and Authorization Model

Applied as middleware, in this order, before any route handler runs:

1. **Session resolution.** The `tt_session` cookie is looked up. Missing,
   unknown, or expired means the request is unauthenticated; an expired row is
   deleted when it is encountered (BR-11).
2. **Authentication gate.** An unauthenticated request to anything other than
   the public endpoints below answers **401** `UNAUTHENTICATED` (BR-19).
3. **Password-change gate.** If the session's user has
   `mustChangePassword: true`, every endpoint except `GET /api/auth/me`,
   `POST /api/auth/change-password` and `POST /api/auth/logout` answers **403**
   `PASSWORD_CHANGE_REQUIRED` (BR-02, AC-02). This is a server gate; the client
   redirect is only its visible half.
4. **Role gate.** Each user carries exactly one role (FR-07), and the role
   the endpoint requires is checked against the
   authorization matrix in `specification.md` §5 → **403** `FORBIDDEN` when it
   fails (BR-19). The gate is the enforcement point required by FR-08: no
   endpoint relies on the interface having hidden its control.
5. **Ownership gate.** For Requester-scoped resources, a resource belonging to
   another user answers **404**, never 403, so its existence is not disclosed
   (BR-16). A Requester asking for Internal Notes is treated the same way
   (BR-20, AC-04).

Because the role gate runs before the ownership gate, the two refusals are never
interchangeable and every endpoint below inherits the same rule: **a caller in
the wrong role gets 403; a caller in the right role reaching another user's
resource gets 404.** Where an endpoint says "Requester role only", a staff
caller is therefore refused with 403, not 404.

Public endpoints, requiring no session: `GET /api/health`,
`POST /api/auth/login`, `GET /api/categories`, `GET /api/related-systems`.
Reference data stays public because it is neither personal nor sensitive, and
the Login screen is the only thing in front of it.

**Deactivation takes effect immediately.** Setting `isActive: false` on a user
deletes that user's `Session` rows in the same transaction, so an open browser
loses access on its next request rather than at expiry (BR-12, AC-24).

## 4. Authentication Endpoints

The **safe user object** — the shape returned for the caller themselves:
```json
{
  "id": 3,
  "name": "Jennifer Anderson",
  "email": "jennifer.anderson@example.edu",
  "role": "REQUESTER",
  "isActive": true,
  "mustChangePassword": false,
  "createdAt": "2026-05-12T09:14:00.000Z",
  "updatedAt": "2026-09-10T08:02:00.000Z"
}
```
`passwordHash` is not a field of this object and appears in no response
anywhere (BR-07).

### `POST /api/auth/login`
FR-01, FR-02.
- Session: not required. An already-authenticated caller may log in again; the
  previous session row is deleted and replaced, so one browser never
  accumulates sessions.
- Request body:
  ```json
  { "email": "jennifer.anderson@example.edu", "password": "ChangeMe123!" }
  ```
- `email` is trimmed and lower-cased before lookup, the same normalisation
  every write applies, so capitalisation never decides whether an account is
  found (BR-36).
- Validation: `email` and `password` required and non-blank → else **400**
  `VALIDATION_ERROR` with the offending `field`. A blank submission is a 400
  rather than a 401 because nothing was actually attempted.
- **401** `INVALID_CREDENTIALS` for *all* of: unknown email, wrong password,
  and inactive account (BR-01, BR-06, AC-05). One message —
  `"Email or password is incorrect."` — and no `field`. The handler performs
  the same bcrypt comparison in every failing branch, comparing against a fixed
  dummy hash when no user was found, so response time does not separate the
  cases (BR-14).
- No lockout, no attempt counter, no `Retry-After` (BR-14). Each failure is
  written to the server log with the attempted address and the remote address;
  no endpoint exposes that log.
- **200** response: `Set-Cookie: tt_session=...` with the §1 attributes, and
  ```json
  { "data": <safe user object> }
  ```
  The client reads `role` to choose the landing destination and
  `mustChangePassword` to decide whether that destination is Change Password
  (AC-01, AC-02).

### `POST /api/auth/logout`
FR-04.
- Session: required; exempt from the password-change gate — a user who must
  change their password must still be able to leave.
- Request body: none.
- Deletes the session row, then clears the cookie with an expired
  `Set-Cookie`. Replaying the old cookie afterwards is an unknown session and
  answers **401** `UNAUTHENTICATED` (BR-10, AC-06).
- **204** No Content. There is no body; nothing about a destroyed session is
  worth returning.
- A second call is an ordinary unauthenticated request and answers 401. The
  client treats both outcomes as "you are logged out".

### `GET /api/auth/me`
FR-03.
- Session: required; exempt from the password-change gate, because the client
  needs this response in order to learn that a password change is required.
- **200** response: `{ "data": <safe user object> }` (BR-13).
- **401** `UNAUTHENTICATED` when there is no valid session. It never answers
  200 with a null or empty user, so the client cannot confuse "not signed in"
  with "signed in as nobody" (BR-13).
- This is what the client calls on every page load to rehydrate identity. The
  Lab 2 `sessionStorage` Requester state is gone (AC-25).

### `POST /api/auth/change-password`
- Session: required; exempt from the password-change gate — it is the way out
  of it. Available to every role, and used for both the mandatory change
  (FR-05) and a voluntary one (FR-06); the endpoint does not distinguish them.
- Request body:
  ```json
  {
    "currentPassword": "ChangeMe123!",
    "newPassword": "correct horse battery staple",
    "confirmPassword": "correct horse battery staple"
  }
  ```
  `currentPassword` is required even during a mandatory first-login change: the
  user typed it on the Login screen moments earlier, and requiring it means an
  unattended signed-in browser cannot have its password silently replaced.
- Validation, all **400** `VALIDATION_ERROR` carrying `field`:
  - `currentPassword` — required; a wrong value answers 400 with
    `field: "currentPassword"`, not 401, because the session itself is valid.
  - `newPassword` — required, 8–72 characters (BR-08).
  - `newPassword` must differ from `currentPassword` (BR-09).
  - `confirmPassword` — required, must equal `newPassword` (BR-09).
- On success the new hash is stored, `mustChangePassword` becomes `false`, and
  **every other session for that user is deleted** while the current one is
  kept. A password change is exactly the moment other open sessions should
  stop.
- **200** response: `{ "data": <safe user object> }` with
  `mustChangePassword: false`, which is the client's signal to leave the Change
  Password screen (AC-02).

## 5. Shared Object Shapes

### Actor summary
Every place a person is named in a response — a Ticket owner, a comment
author, a note author — uses this shape and nothing wider:
```json
{ "id": 7, "name": "Somsak Wattana", "role": "IT_STAFF" }
```
Email addresses are deliberately absent. A Requester reading a Public Comment
has no need for the address of the staff member who wrote it, and the
Administrator user list (§9) is the one place addresses are returned.

### Ticket object
The Lab 2 Ticket object plus the fields this sprint adds:
```json
{
  "id": 118,
  "ticketNumber": "TKT-2026-000118",
  "requesterId": 3,
  "requester": { "id": 3, "name": "Jennifer Anderson", "role": "REQUESTER" },
  "categoryId": 2,
  "relatedSystemId": 7,
  "summary": "Laptop battery drains quickly",
  "description": "The battery drains much faster than usual...",
  "requestedPriority": "MEDIUM",
  "itPriority": "MEDIUM",
  "currentStatus": "IN_PROGRESS",
  "ownerId": 7,
  "owner": { "id": 7, "name": "Somsak Wattana", "role": "IT_STAFF" },
  "requesterResolvedAt": null,
  "createdAt": "2026-05-12T09:14:00.000Z",
  "updatedAt": "2026-09-10T08:02:00.000Z",
  "attachments": [ /* Lab 2 attachment metadata objects */ ]
}
```
- `ownerId` and `owner` are `null` on an unassigned Ticket (BR-27).
- `requesterResolvedAt` is `null` until the Requester signals it (BR-34).
- The object is identical for every role. Nothing in it is role-restricted, so
  there is one shape to test and no branch that could leak by mistake — the
  role-restricted content is Internal Notes, and those live behind their own
  endpoint (§8).

### Comment and note object
```json
{
  "id": 55,
  "ticketId": 118,
  "author": { "id": 7, "name": "Somsak Wattana", "role": "IT_STAFF" },
  "body": "I have ordered a replacement battery.",
  "createdAt": "2026-09-10T08:02:00.000Z"
}
```
Identical for both kinds (BR-22). There is no `updatedAt` and no `isEdited`,
because both are append-only (BR-21).

## 6. Lab 2 Endpoints After Migration

These keep their paths, request bodies and response shapes. What changes is
where identity comes from, and who may call them (BR-44, AC-08).

| Endpoint | Change in Lab 3 |
|---|---|
| `GET /api/health` | none; still public |
| `GET /api/categories` | none; still public |
| `GET /api/related-systems` | none; still public |
| `GET /api/requesters` | **removed.** It existed only to populate the Development Requester selector. It has no caller in Lab 3, and it returned a list of real people to anyone who asked, which is no longer acceptable (AC-25). |
| `POST /api/tickets` | Requester role only (FR-10); IT Staff and Administrator answer **403** `FORBIDDEN`. `requesterId` comes from the session and a `requesterId` in the body is ignored (BR-03, AC-03). `itPriority` is now initialised from `requestedPriority` instead of being `null` (BR-29). |
| `GET /api/tickets` | Requester role only (FR-10), scoped to the session user's own Tickets. Query contract unchanged. IT Staff and Administrator use `GET /api/staff/tickets` (§7) instead — this endpoint stays the Requester's "My Tickets" and answers **403** `FORBIDDEN` to other roles, so its meaning never depends on who is asking. |
| `GET /api/tickets/:id` | Role-aware. A Requester may read only their own (404 otherwise, BR-16); IT Staff and Administrator may read any (BR-17). One endpoint rather than a staff duplicate: the ownership rule then exists in exactly one place. |
| `POST /api/tickets/:id/attachments` | Requester role only (FR-11): another role answers **403**, another Requester's Ticket answers **404**. Staff do not upload in Lab 3. |
| `DELETE /api/attachments/:id` | Requester role only (FR-11): another role answers **403**, another Requester's Ticket answers **404**. Staff do not remove in Lab 3. |
| `GET /api/attachments/:id` | Readable by anyone who may read the parent Ticket (FR-21, AC-26): the owning Requester, IT Staff, Administrator. Anyone else gets 404. |
| `GET /api/attachments/:id/download` | Same widened rule. The Lab 2 behaviour that a soft-removed attachment is never downloadable *by anyone* is unchanged. |

Every one of these now answers **401** `UNAUTHENTICATED` without a session,
where Lab 2 answered 400 for a missing `X-Requester-Id`. That status change is
deliberate and is the only breaking change to the Lab 2 contract.

## 7. IT Staff Ticket Endpoints

### `GET /api/staff/tickets`
The Ticket Queue (FR-13, AC-09). IT Staff and Administrator only → **403**
`FORBIDDEN` for a Requester, which is safe to state plainly because the
existence of a queue is not a secret. This refusal is the server half of
AC-07: hiding the queue from Requester navigation is feedback, not the
control.

Query parameters, all optional and all lenient (BR-40, AC-28):

| Param | Type | Default | Notes |
|---|---|---|---|
| `search` | string | — | `ticketNumber` or `summary`, case-insensitive partial — the same two fields Lab 2 searches |
| `category` | integer (Category id) | — | |
| `requestedPriority` | `LOW`\|`MEDIUM`\|`HIGH` | — | |
| `itPriority` | `LOW`\|`MEDIUM`\|`HIGH` | — | |
| `status` | any `CurrentStatus` value | — | |
| `owner` | integer (User id) or `unassigned` | — | `unassigned` matches `ownerId IS NULL`; `me` is **not** accepted, because the client already knows its own id and a magic value would be one more thing to test |
| `sortBy` | `ticketNumber`\|`createdAt`\|`updatedAt`\|`itPriority` | `updatedAt` | |
| `sortDir` | `asc`\|`desc` | `desc` | |
| `page` | integer ≥ 1 | `1` | |
| `pageSize` | `10`\|`25`\|`50` | `25` | larger default than the Requester list, because a shared queue is scanned rather than browsed |

- Filters combine with AND. Ties break by `ticketNumber desc`, as in Lab 2.
- `sortBy=itPriority` orders `HIGH` → `MEDIUM` → `LOW` by rank, not
  alphabetically; a null `itPriority` (a Lab 2 row the migration has not
  touched) sorts last in `desc`.
- **200** response: the pagination envelope, `data` being an array of Ticket
  objects **without** the `attachments` array — the queue never renders
  attachment detail per row, and loading it for 25 Tickets would be wasteful.
- A `page` past the end returns `data: []` with accurate metadata, not an
  error (Lab 2 BR-17).

### `GET /api/staff/assignees`
FR-16. The list of people a Ticket may be assigned to (BR-25). IT Staff and
Administrator only → **403** `FORBIDDEN`.
- **200** response: `{ "data": [ <actor summary>, ... ] }` — active IT Staff
  and Administrator users only, ordered by name.
- Two callers use it: the reassign control on Ticket Detail, and the Owner
  filter on the queue, which needs the same names.
- It exists so that IT Staff can do both without being given the Administrator
  user list, which carries email addresses and activation state (§9). It is the
  narrowest response that makes those two controls work.

### `PATCH /api/tickets/:id/owner`
Claim or reassign (FR-15, AC-10, AC-11). IT Staff and Administrator only.
- Request body: `{ "ownerId": 7 }`, or `{ "ownerId": null }` to release the
  Ticket back to unassigned.
- A claim is simply this call with the caller's own id. There is no separate
  claim endpoint: it is the same state change, and one endpoint means one set
  of rules to enforce.
- Any IT Staff or Administrator may reassign, not only the current owner
  (BR-28).
- An owner who is deactivated *after* being assigned stays on the Ticket and is
  still returned in `owner` (BR-26). The check below applies to the incoming
  `ownerId` only, never to the value already stored.
- **400** `INVALID_OWNER` when `ownerId` names a user who does not exist, is
  inactive, or has the Requester role (BR-25). The message does not say which,
  because the caller has no need to enumerate accounts.
- **404** `TICKET_NOT_FOUND` when the Ticket does not exist.
- **200** response: `{ "data": <Ticket object> }` with `owner` populated.

### `PATCH /api/tickets/:id/it-priority`
FR-17, AC-12. IT Staff and Administrator only.
- Request body: `{ "itPriority": "HIGH" }`
- **400** `VALIDATION_ERROR` (`field: "itPriority"`) when the value is absent
  or not one of the three. `null` is not accepted: once set, a Ticket always
  has an IT Priority.
- `requestedPriority` is never touched by this endpoint (BR-29, AC-12).
- **200** response: `{ "data": <Ticket object> }`.

### `PATCH /api/tickets/:id/status`
FR-18, AC-13. IT Staff and Administrator only (BR-32) — a Requester gets
**403** `FORBIDDEN`, and this one is a 403 rather than a 404 because the
Requester can already see the Ticket; the refusal reveals nothing.
- Request body: `{ "currentStatus": "IN_PROGRESS" }`
- **400** `VALIDATION_ERROR` when the value is not a `CurrentStatus` member.
- **409** `INVALID_STATUS_TRANSITION` when the value is a valid status but the
  move is not permitted from the Ticket's current status by the matrix in
  `specification.md` BR-31. The message names both ends of the attempted move
  — that is the Ticket's own state, not another user's data. The status is
  unchanged (AC-13).
- Setting the status to its current value is also a **409**: the matrix has no
  self-transitions, and silently accepting a no-op would hide a client bug.
- The confirmation required before Closed or Cancelled (BR-33) is a client
  responsibility; the API has no `confirm` parameter, because a flag a client
  can set unconditionally is not a safeguard.
- **200** response: `{ "data": <Ticket object> }`.

### `POST /api/tickets/:id/appears-resolved`
The Requester resolution signal (FR-12, BR-34, AC-16). Requester role only. The
two refusals differ and the difference is deliberate: an IT Staff or
Administrator caller answers **403** `FORBIDDEN`, because they are permitted to
see the Ticket and the refusal discloses nothing; another Requester answers
**404** `TICKET_NOT_FOUND`, because for them the Ticket must not exist (BR-16).
- Request body: none.
- Sets `requesterResolvedAt` to the server clock. It does **not** change
  `currentStatus` (BR-05) — formally resolving stays with the staff roles.
- **409** `RESOLUTION_NOT_APPLICABLE` when the Ticket is already `RESOLVED`,
  `CLOSED` or `CANCELLED` (BR-34).
- **409** `ALREADY_INDICATED` when `requesterResolvedAt` is already set. The
  signal is a fact with a time, not a toggle; re-sending it would rewrite when
  the Requester said it.
- **200** response: `{ "data": <Ticket object> }` with `requesterResolvedAt`
  populated.

## 8. Public Comments and Internal Notes

The two pairs are deliberately symmetrical in shape and asymmetrical in
access. Note what a Requester receives from each: a 200 with data from
`/comments`, and a 404 from `/notes` — identical to a Ticket that does not
exist (BR-20, AC-04).

### `GET /api/tickets/:id/comments`
- Requester (own Ticket only), IT Staff, Administrator (BR-04).
- A Requester asking about another user's Ticket gets **404**
  `TICKET_NOT_FOUND` (BR-16).
- **200** response: `{ "data": [ <comment object>, ... ] }`, oldest first — a
  conversation reads downwards.
- Not paginated. A Ticket thread is short by nature, and paginating it would
  add a contract to test for no practical gain.

### `POST /api/tickets/:id/comments`
- Same access rule (FR-19, AC-14).
- Request body: `{ "body": "I have ordered a replacement battery." }`
- Validation: `body` required, trimmed, 1–2000 characters; whitespace-only is
  rejected → **400** `VALIDATION_ERROR` (`field: "body"`) (BR-23).
- `author` and `createdAt` come from the session and the server clock. A client
  that sends either is ignored, not rejected — they are simply not part of the
  accepted body (BR-22).
- **201** response: `{ "data": <comment object> }`.

### `GET /api/tickets/:id/notes`
- IT Staff and Administrator only.
- A Requester — whether or not they own the Ticket — receives **404**
  `TICKET_NOT_FOUND`, never 403 and never an empty array (BR-20, AC-04). An
  empty `data: []` would confirm the endpoint exists; 403 would confirm the
  Ticket exists. Both are answers a Requester should not be able to obtain.
- **200** response: `{ "data": [ <note object>, ... ] }`, oldest first.

### `POST /api/tickets/:id/notes`
- IT Staff and Administrator only (FR-20, AC-15); a Requester receives **404**
  as above (AC-04).
- Request body and validation identical to a comment (BR-23).
- **201** response: `{ "data": <note object> }`.

## 9. Administrator User Endpoints

Administrator only. Every endpoint in this section answers **403** `FORBIDDEN`
to a Requester or IT Staff caller (AC-21) — plainly, because the existence of
user management is not a secret and hiding it would only make the refusal
harder to diagnose.

The **admin user object** adds the two fields the safe user object omits for
other people, because managing accounts is exactly what this screen is for:
```json
{
  "id": 12,
  "name": "Nattapong Sri",
  "email": "nattapong.sri@example.edu",
  "role": "IT_STAFF",
  "isActive": true,
  "mustChangePassword": true,
  "createdAt": "2026-09-01T02:00:00.000Z",
  "updatedAt": "2026-09-10T08:02:00.000Z"
}
```
It still carries no `passwordHash` (BR-07).

### `GET /api/users`
FR-22, FR-23, AC-27.
- Query parameters, lenient as everywhere else (BR-41):

  | Param | Type | Default | Notes |
  |---|---|---|---|
  | `search` | string | — | `name` or `email`, case-insensitive partial |
  | `role` | `REQUESTER`\|`IT_STAFF`\|`ADMINISTRATOR` | — | at most one |

- **200** response: `{ "data": [ <admin user object>, ... ] }` ordered by name
  ascending.
- Not a pagination envelope: the handout excludes user-list pagination, so
  adding the metadata would describe a capability that does not exist (BR-41).
- Inactive users are included and are distinguished by `isActive`. A user
  management screen that hid deactivated accounts would make reactivating one
  impossible.

### `POST /api/users`
FR-24, AC-22.
- Request body:
  ```json
  {
    "name": "Nattapong Sri",
    "email": "nattapong.sri@example.edu",
    "role": "IT_STAFF",
    "isActive": true,
    "initialPassword": "Welcome2026!"
  }
  ```
- Validation, **400** `VALIDATION_ERROR` with `field`:
  - `name` — required, trimmed, 2–100 characters.
  - `email` — required, trimmed, a syntactically valid address, ≤ 200
    characters.
  - `role` — required, exactly one `Role` value (BR-18, BR-35). An array is a
    validation error, not a silently-taken first element.
  - `isActive` — required boolean. It is explicit rather than defaulted so that
    creating a deactivated account is a decision rather than an accident.
  - `initialPassword` — required, 8–72 characters (BR-08).
- **409** `EMAIL_ALREADY_EXISTS` when the trimmed address matches an existing
  user case-insensitively, active or not (BR-36, AC-17). No user is created.
- The new account is stored with `mustChangePassword: true` (BR-35, AC-22), so
  the initial password can only be used once, to set a real one.
- **201** response: `{ "data": <admin user object> }`.

### `PATCH /api/users/:id`
FR-25, BR-35, AC-23. Accepts any subset of the four editable fields; anything absent
is left alone.
- Request body: `{ "name": "...", "email": "...", "role": "...", "isActive": false }`
- Validation as for creation, applied only to the fields present. A body with
  none of the four is **400** `VALIDATION_ERROR` — an empty PATCH is a client
  bug, not a no-op worth confirming.
- **404** `USER_NOT_FOUND` when the id does not exist.
- **409** `EMAIL_ALREADY_EXISTS` when the new address belongs to a different
  user (BR-36).
- **409** `SELF_DEACTIVATION` when an Administrator sets `isActive: false` on
  their own account, or changes their own `role` away from `ADMINISTRATOR`
  (BR-37, AC-20). Both remove the acting user's own access.
- **409** `LAST_ACTIVE_ADMINISTRATOR` when the change would leave no active
  Administrator — deactivating the last one, or re-roling them (BR-38, AC-19).
  The check counts active Administrators *after* the proposed change, inside
  the same transaction, so two concurrent requests cannot each believe another
  Administrator remains.
- Deactivating a user deletes their sessions in the same transaction (BR-12,
  AC-24) and leaves any Tickets they own assigned to them (BR-26).
- Changing a role does **not** set `mustChangePassword`; a role change is not a
  credential change.
- **200** response: `{ "data": <admin user object> }`.

### `POST /api/users/:id/initial-password`
FR-26, BR-35, AC-18.
- Request body: `{ "initialPassword": "Welcome2026!" }`
- Validation: required, 8–72 characters (BR-08) → else **400**
  `VALIDATION_ERROR` (`field: "initialPassword"`).
- Stores the new hash, sets `mustChangePassword: true`, and deletes that
  user's sessions — the point of resetting a password is that whoever was
  using the old one stops (BR-12).
- An Administrator may run this on their own account; it is not
  self-deactivation, it just means their next request lands on Change
  Password.
- **404** `USER_NOT_FOUND` when the id does not exist.
- **200** response: `{ "data": <admin user object> }` with
  `mustChangePassword: true`. The password itself is never echoed (BR-07); the
  Administrator already has the value they typed and it is theirs to pass on.

## 10. Status Code Reference

| Status | Code strings | Meaning |
|---|---|---|
| 200 | — | Successful retrieval or update |
| 201 | — | User, Comment or Note created |
| 204 | — | Logout; session destroyed, no body |
| 400 | `VALIDATION_ERROR`, `INVALID_OWNER`, `INVALID_CATEGORY`, `INVALID_RELATED_SYSTEM` | Request body failed validation (BR-42). Never returned for a query parameter (BR-40). |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | No valid session, or a login attempt that failed for any reason (BR-01, BR-06) |
| 403 | `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED` | Authenticated, but the role may not perform the operation, or the account must change its password first (BR-02, BR-19) |
| 404 | `TICKET_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `USER_NOT_FOUND`, `NOT_FOUND` | Missing resource, a Requester reaching another user's resource (BR-16), a Requester reaching Internal Notes (BR-20), a removed-attachment download, or an unmatched API path |
| 409 | `EMAIL_ALREADY_EXISTS`, `INVALID_STATUS_TRANSITION`, `SELF_DEACTIVATION`, `LAST_ACTIVE_ADMINISTRATOR`, `RESOLUTION_NOT_APPLICABLE`, `ALREADY_INDICATED`, `ATTACHMENT_LIMIT_REACHED`, `ALREADY_REMOVED` | The request is well-formed and permitted, but conflicts with the current state |
| 413 | `FILE_TOO_LARGE` | Attachment exceeds 5 MB (unchanged from Lab 2) |
| 415 | `UNSUPPORTED_FILE_TYPE` | Attachment type not allowed (unchanged from Lab 2) |
| 500 | `INTERNAL_ERROR` | Unexpected server error; the message is always generic (BR-43) |

## 11. What This Contract Deliberately Does Not Have

- **No refresh-token endpoint.** Sessions are server-side rows with an 8-hour
  life; there is nothing to refresh.
- **No `GET /api/users/:id`.** The list response already carries every field
  the Edit dialog needs, so a single-user read would be a second way to obtain
  the same data and a second place to get authorization wrong.
- **No user deletion endpoint**, in any form (BR-39).
- **No bulk or import/export endpoints**, excluded by the handout.
- **No endpoint that returns a password, a hash, or a session identifier** —
  including the initial-password endpoints, which return only the account's
  new state (BR-07).
