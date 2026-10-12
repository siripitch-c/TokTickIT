# TokTickIT — Lab 4 API Contract

The REST contract for Sprint 4. It adds Actions Taken and the two dashboards,
and puts a version precondition on the Ticket write endpoints Lab 3 shipped.
Everything not described here keeps the contract in `docs/lab-03/api-spec.md`
and `docs/lab-02/api-spec.md` exactly as it is.

Rule references are to `specification.md` in this directory unless they are
written as *Lab 2 BR-xx* or *Lab 3 BR-xx*.

---

## 1. Conventions

Unchanged from Lab 3 and repeated only where Lab 4 adds something:

- **Base path** `/api`; identity is the `tt_session` cookie and nothing else.
- **Content type** `application/json`; timestamps are ISO 8601 UTC strings.
- **Error envelope** — unchanged, used for every non-2xx response:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "A follow-up note is required.", "field": "followUpNote" } }
  ```
  `field` is omitted when the error is not tied to one request field.
- **Lenient reads, strict writes** — a `GET` query parameter is never a 400; an
  unknown or invalid value falls back to its default. Request bodies are
  validated strictly (BR-29).
- **Version precondition (new in Lab 4)** — every write that changes an
  existing Ticket or Action carries the version the caller read:
  ```json
  { "version": 3, "...": "the fields being changed" }
  ```
  A missing or non-integer `version` answers **400** `VERSION_REQUIRED`
  (BR-28). A version that no longer matches the row answers **409**
  `STALE_UPDATE` and changes nothing (BR-26):
  ```json
  { "error": { "code": "STALE_UPDATE", "message": "This ticket changed after you opened it. Reload to see the current version.", "field": "version" } }
  ```
  The response body of every successful write carries the new `version`, so a
  client can continue without re-reading (BR-27).
- **Dashboards are summaries** — they return counts and short lists, never a
  full collection, and they are computed per request (BR-23, BR-24).

## 2. Enums

Carried over: `Role`, `RequestedPriority`, `ITPriority`, `CurrentStatus`
(`docs/lab-03/api-spec.md` §2). Added:

- `ActionStatus`: `PLANNED` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`
  (BR-05). `COMPLETED` and `CANCELLED` are final.

## 3. Authorization Model

The five gates from Lab 3 run unchanged and in the same order: session
resolution, authentication (401), password-change (403), role (403), ownership
(404). Lab 4 adds no new gate; it only places new endpoints behind the existing
ones.

| Operation group | Requester | IT Staff | Administrator | Refusal for a caller not permitted |
|---|---|---|---|---|
| Read the Actions of a Ticket | own Tickets | any Ticket | any Ticket | 403 for no session; 404 on another Requester's Ticket |
| Create / update / complete / cancel an Action | no | yes | yes | 403 |
| Staff dashboard | no | yes | yes | 403 |
| Requester dashboard | yes, own data only | no | no | 403 |
| Ticket status, owner, IT priority | no | yes | yes | 403 (Lab 3) |

An Administrator calling the requester dashboard is refused with 403 rather
than being shown somebody's data, because the endpoint has no subject other
than the caller (BR-23, AC-22).

`GET /api/health` stays public and unchanged from Lab 1: it reports that the
API is reachable and is what the final demonstration and the E2E global setup
check before anything else runs (handout §6).

## 4. Shared Object Shapes

### Action object

```json
{
  "id": 12,
  "ticketId": 57,
  "actionAt": "2026-10-13T02:15:00.000Z",
  "description": "Replaced the HDMI cable at the lectern and retested.",
  "result": "Projector shows the laptop image again.",
  "status": "COMPLETED",
  "performedBy": { "id": 6, "name": "Somsak Wattana", "role": "IT_STAFF" },
  "assignedTo":  { "id": 6, "name": "Somsak Wattana", "role": "IT_STAFF" },
  "followUpRequired": false,
  "followUpNote": null,
  "attachmentNotes": "See lectern-after.jpg on the ticket.",
  "createdAt": "2026-10-13T02:16:03.221Z",
  "updatedAt": "2026-10-13T02:40:11.880Z",
  "version": 3
}
```

`performedBy` and `assignedTo` use the Lab 3 **actor summary** — id, name and
role only, never an email address or any credential field (Lab 3 BR-07).

### Ticket object

Unchanged from Lab 3 except that it now carries `version` (BR-26) and, where
the endpoint documents it, `openActionCount` — the number of Actions still
Planned or In Progress, which is what the resolution gate counts (BR-18).

## 5. Actions Taken Endpoints

### `GET /api/tickets/:id/actions`

Lists the Actions of one Ticket, oldest action time first with the id as the
tie-break (BR-11).

| Case | Status | Body |
|---|---|---|
| Permitted caller | 200 | `{ "data": [ Action, … ] }` |
| No session | 401 | `UNAUTHENTICATED` |
| Requester, another user's Ticket | 404 | `NOT_FOUND` (BR-15) |
| Ticket does not exist | 404 | `NOT_FOUND` |

A Ticket with no Actions answers `{ "data": [] }` with 200 — an empty log is a
valid state, not an error, and every Ticket created before Lab 4 is in it
(§7 of the specification).

### `POST /api/tickets/:id/actions`

Creates an Action. IT Staff and Administrator only (BR-14).

Request:

```json
{
  "actionAt": "2026-10-13T02:15:00.000Z",
  "description": "Replaced the HDMI cable at the lectern and retested.",
  "result": "",
  "assignedToId": 6,
  "status": "PLANNED",
  "followUpRequired": true,
  "followUpNote": "Check again after the weekend lecture.",
  "attachmentNotes": ""
}
```

- `actionAt` optional, defaults to now; must not be in the future and must not
  precede the Ticket's `createdAt` (BR-09).
- `description` required, 5–2000 characters (BR-10).
- `result` optional while the Action is not Completed; required when `status`
  is `COMPLETED` (BR-06).
- `assignedToId` optional, defaults to the caller; must be an **active** user
  whose role is IT Staff or Administrator (BR-04).
- `status` optional, defaults to `PLANNED`; a create may use `PLANNED`,
  `IN_PROGRESS` or `COMPLETED`, never `CANCELLED` — cancelling something that
  was never planned is not a record anybody needs.
- `followUpRequired` required boolean; when true, `followUpNote` is required
  and must be 5–1000 characters; when false, any note sent is stored as `null`
  (BR-07).
- No `performedById` is accepted: sending one changes nothing (BR-03, AC-02).

| Case | Status | Body |
|---|---|---|
| Created | 201 | the Action object |
| Validation failure | 400 | `VALIDATION_ERROR` with `field` |
| Assignee inactive or wrong role | 400 | `INVALID_ASSIGNEE`, field `assignedToId` (AC-04) |
| Requester | 403 | `FORBIDDEN` (AC-07) |
| No session | 401 | `UNAUTHENTICATED` |
| Ticket not found | 404 | `NOT_FOUND` |

### `PATCH /api/actions/:id`

Updates, reassigns, completes or cancels one Action. IT Staff and
Administrator only. Every call carries `version` (BR-26, BR-28).

```json
{ "version": 2, "status": "COMPLETED", "result": "Projector shows the laptop image again." }
```

Accepted fields: `actionAt`, `description`, `result`, `assignedToId`,
`status`, `followUpRequired`, `followUpNote`, `attachmentNotes`. Any field
omitted is left as it is.

| Case | Status | Body |
|---|---|---|
| Updated | 200 | the Action object with its new `version` |
| Missing or non-integer version | 400 | `VERSION_REQUIRED` |
| Version does not match | 409 | `STALE_UPDATE` (AC-13) |
| Action already Completed or Cancelled | 409 | `ACTION_FINAL` (AC-06) |
| Transition not permitted by BR-05 | 409 | `INVALID_ACTION_TRANSITION` |
| Completing with no result | 400 | `VALIDATION_ERROR`, field `result` (BR-06) |
| Follow-up required with no note | 400 | `VALIDATION_ERROR`, field `followUpNote` (AC-03) |
| Assignee inactive or wrong role | 400 | `INVALID_ASSIGNEE`, field `assignedToId` |
| Requester | 403 | `FORBIDDEN` |
| Action not found | 404 | `NOT_FOUND` |

There is no `DELETE`: an Action is retired by cancelling it (BR-13).

## 6. Ticket Endpoints Changed by Lab 4

`PATCH /api/tickets/:id/status`, `PATCH /api/tickets/:id/owner` and
`PATCH /api/tickets/:id/it-priority` keep their Lab 3 paths, roles and response
shapes, and gain two behaviours:

1. **Version precondition.** The body must carry `version`; a mismatch answers
   409 `STALE_UPDATE` (BR-26, BR-28, AC-13, AC-14).
2. **Resolution gate on status.** Moving to `RESOLVED` while the Ticket has any
   Action in `PLANNED` or `IN_PROGRESS` answers 409 (BR-18, AC-09):

```json
{
  "error": {
    "code": "OPEN_ACTIONS_REMAIN",
    "message": "2 actions on this ticket are still open. Complete or cancel them before resolving it.",
    "field": "status"
  }
}
```

Cancelling a Ticket is never gated by its Actions (BR-19, AC-11). Every other
transition rule is the matrix in BR-16, and a move it does not permit still
answers 409 `INVALID_TRANSITION` as it did in Lab 3 (AC-12).

`GET /api/tickets/:id` and `GET /api/staff/tickets` now include `version` on
each Ticket, and `GET /api/tickets/:id` additionally includes
`openActionCount`, so the interface can disable Resolve before the user presses
it while the server still makes the decision.

`GET /api/staff/tickets` also accepts two new optional query parameters, which
exist so the dashboard's *My open actions* card can drill down into the queue
(`ui-spec.md` §4.5):

| Parameter | Values | Meaning |
|---|---|---|
| `actionsAssignedTo` | `me` or a user id | only Tickets carrying at least one Action assigned to that user |
| `actionStatus` | `open` (default when `actionsAssignedTo` is present), `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` | which of that user's Actions count |

Both follow the queue's lenient rule (Lab 3 BR-40): an unrecognised value falls
back to its default rather than failing the request. Every other queue
parameter, the ordering and the pagination envelope are unchanged.

## 7. Dashboard Endpoints

### `GET /api/dashboard/staff`

IT Staff and Administrator only (BR-14). No query parameters: the dashboard is
the same for everyone except for the "mine" metrics, which come from the
session.

```json
{
  "metrics": {
    "unassigned": 4,
    "assignedToMe": 7,
    "myOpenActions": 3,
    "waitingForRequester": 2,
    "highItPriority": 5,
    "resolvedLast7Days": 6,
    "byStatus": {
      "NEW": 3, "OPEN": 4, "IN_PROGRESS": 6, "WAITING_FOR_REQUESTER": 2,
      "RESOLVED": 5, "CLOSED": 11, "REOPENED": 1, "CANCELLED": 2
    }
  },
  "administratorMetrics": { "activeUsers": 12, "inactiveUsers": 3 },
  "recentlyUpdated": [
    { "id": 57, "ticketNumber": "TKT-2026-003347", "summary": "Projector in room 305 shows no signal",
      "currentStatus": "IN_PROGRESS", "itPriority": "HIGH",
      "owner": { "id": 6, "name": "Somsak Wattana", "role": "IT_STAFF" },
      "updatedAt": "2026-10-13T02:40:11.880Z" }
  ],
  "needsAttention": [ /* same row shape */ ]
}
```

- Every count is defined in BR-21 and computed at request time (BR-24).
- `administratorMetrics` is present only for an Administrator and absent for IT
  Staff (FR-16, AC-18).
- `recentlyUpdated` holds at most 10 open Tickets ordered by `updatedAt`
  descending; `needsAttention` holds at most 10 open Tickets with IT Priority
  `HIGH`, oldest update first.
- `resolvedLast7Days` uses Asia/Bangkok day boundaries (BR-25).
- Drill-down is by the existing queue contract: each card maps to a
  `GET /api/staff/tickets` query the client also uses for its link, so the card
  and the list cannot disagree (AC-17).

| Case | Status |
|---|---|
| IT Staff or Administrator | 200 |
| Requester | 403 `FORBIDDEN` |
| No session | 401 `UNAUTHENTICATED` |

### `GET /api/dashboard/requester`

Requester only, and only ever the caller's own data (BR-23, FR-20).

```json
{
  "metrics": {
    "openTickets": 3,
    "waitingForMe": 1,
    "resolvedAwaitingConfirmation": 2
  },
  "recentlyUpdated": [
    { "id": 41, "ticketNumber": "TKT-2026-002770", "summary": "Keyboard keys stopped responding",
      "currentStatus": "WAITING_FOR_REQUESTER", "requestedPriority": "MEDIUM",
      "updatedAt": "2026-10-12T08:05:44.001Z" }
  ],
  "recentlyResolved": [ /* same row shape */ ]
}
```

- Both lists hold at most 5 rows.
- A `requesterId` in the query string is ignored; the answer is the caller's
  own data (AC-20).
- A Requester with no Tickets receives zeros and empty arrays, never an error
  (AC-21).

| Case | Status |
|---|---|
| Requester | 200 |
| IT Staff or Administrator | 403 `FORBIDDEN` |
| No session | 401 `UNAUTHENTICATED` |

## 8. Duplicate Submission

Creating an Action, a Comment or a Note is a plain `POST`, and a double click
is prevented in the interface by disabling the control for the duration of the
request (BR-31). On the server the operations are written so that a retry is
harmless: each create is a single insert inside one transaction, so a retry
after a timeout either lands once or not at all — there is no partial state to
repair. No idempotency key is introduced; it would add a protocol for a problem
a disabled button and a single-statement insert already close at this scale.

## 9. Status Code Reference

| Code | Meaning in Lab 4 |
|---|---|
| 200 | Read succeeded, or a write that changed an existing row |
| 201 | An Action was created |
| 400 | Invalid body, missing version, or an invalid assignee |
| 401 | No session, or an expired one |
| 403 | Authenticated but the role may not do this |
| 404 | The Ticket or Action does not exist, or belongs to another Requester |
| 409 | Stale version, a final Action, a transition the matrix forbids, or open Actions blocking resolution |
| 500 | Unexpected server fault, generic message only (BR-30) |

## 10. What This Contract Deliberately Does Not Have

- No `DELETE` for an Action (BR-13), a Ticket, or a user (Lab 3 BR-39).
- No attachment upload on an Action — *Attachment notes* is text (BR-08).
- No dashboard query parameters: no date range, no role switch, no "view as".
- No idempotency-key header (§8).
- No bulk endpoints, no export, and no analytics beyond the counts in BR-21
  and BR-22.
