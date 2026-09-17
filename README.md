# TokTickIT

TokTickIT is an IT service desk application being built through the CPE334 individual sprint workflow.

## What this repository contains

**Lab 3 is in progress.** Issues #29 and #30 have landed: the Development
Requester is now a real `User` account with a password, the API issues
server-side sessions, and the Requester selector is gone — the application
opens on a Login screen. See *Lab 3 so far* below.

The Lab 2 list that follows is a record of what that sprint delivered. Where
Lab 3 has since replaced something, it is marked.

The **Lab 2 sprint is complete** — Issues #11–#18, on top of the Lab 1
foundation (Issues 1–4):

* React + TypeScript + Vite frontend with Bootstrap styling
* Node.js + Express + TypeScript backend
* PostgreSQL database
* Prisma schema and generated-client configuration
* Vitest and Supertest test commands
* Environment and repository safety templates
* GET `/api/health` with a Supertest verification
* Prisma Category model, migration, and idempotent seed for four IT request categories
* GET `/api/categories` backed by Prisma with predictable ID ordering
* Prisma `Requester`, `RelatedSystem`, `Ticket`, and `Attachment` models
  (the latter two are schema-only in this issue; their routes/screens land
  in Issues #13–#15)
* Idempotent seed for ≥4 active Requesters, 1 inactive Requester, and 8
  Related Systems (including "Other / Not Listed")
* ~~GET `/api/requesters`~~ — **removed in Lab 3 Issue #30** (AC-25)
* ~~Development Requester Selection screen, session-persisted selection, and a
  Change Requester action~~ — **removed in Lab 3 Issue #30**; the entry point
  is now the Login screen
* URL routing with a route guard over `/my-tickets` and `/tickets/new`
  (in Lab 3 the guard reads the authenticated session instead of a selected
  Requester, and `/select-requester` no longer exists)
* Zen Green application shell — header, My Tickets / Create Ticket
  navigation with active-page indication, and a mobile hamburger panel (in
  Lab 3 the header shows the signed-in user, their role, and a `Profile ▾`
  menu instead of Change Requester)
* POST `/api/tickets` — backend-generated `TKT-YYYY-NNNNNN` Ticket Number
  from an atomic per-year counter, strict body validation (ownership came from
  `X-Requester-Id` in Lab 2; in Lab 3 it comes from the session)
* POST `/api/tickets/:id/attachments` — JPG/JPEG/PNG/WEBP/PDF only, 5 MB per
  file, 5 active attachments per ticket, randomised names on disk
* GET `/api/related-systems` — active Related Systems for the ticket form
* Create Ticket screen with client-side validation, attachment selection,
  and the loading/validation/submitting/success/failure states from
  `docs/lab-02/ui-spec.md` §5.4

* GET `/api/tickets` — the current Requester's tickets only, with search,
  filters, sorting and pagination; every query parameter is lenient, so a bad
  one falls back to its default rather than failing the request
* My Tickets screen — desktop table with sortable columns, mobile card list,
  search, four filters, pagination, and distinct loading/empty/no-results/
  error states

* GET `/api/tickets/:id` — one owned Ticket with its attachments, removed ones
  included; a Ticket owned by someone else answers exactly as a nonexistent one
  does, so its existence is never revealed
* GET `/api/attachments/:id`, `/api/attachments/:id/download` and DELETE
  `/api/attachments/:id` — metadata, the file itself, and soft removal with a
  required reason; a removed attachment is never downloadable again, by anyone
* Requester Ticket Detail screen — read-only ticket information, and an
  attachments panel that adds, downloads and soft-removes files, with a confirm
  step that will not proceed without a reason

* Playwright end-to-end suite (`e2e/lab-02/`) driving a real browser against
  the running client, API and database: the full create-to-detail flow, the
  route guard, attachment upload/download/removal, cross-Requester isolation,
  the no-results state, an API failure mid-submission, and the whole flow at
  375px — plus the responsive screenshots under
  `artifacts/lab-02/screenshots/` at 1440/768/375px, which also assert that no
  screen scrolls horizontally at any of the three widths

Everything in the Lab 2 sprint scope is implemented, tested and documented.
Each Issue was merged into `lab2-staging` through a peer-reviewed Pull
Request, and Issue #18 merges `lab2-staging` into `main`.

### Sample tickets for local testing

The seed creates the tickets the IT Staff Ticket Queue needs, with example
comments and notes on some of them (Issues #31 and #32). The
Lab 2 set below is separate: it fills My Tickets for Michael Brown and Jennifer
Anderson, and is required before the Lab 2 screenshot tests under **Test**:

```bash
cd server
npx tsx prisma/demo-tickets.ts
```
It gives Michael Brown 13 tickets (two pages at the default page size),
Jennifer Anderson 3, and leaves the other two Requesters empty so the empty
state can be seen. Safe to re-run: it clears its own previous tickets first.

## Lab 3 so far

Issue #29 — authentication foundation:

* The Lab 2 `Requester` model is now `User`, **renamed in place**. Every id,
  Ticket and Attachment from Lab 2 survives; nothing was recreated.
* `User` adds `passwordHash` (bcrypt), `role` (`REQUESTER` / `IT_STAFF` /
  `ADMINISTRATOR`), `mustChangePassword` and `updatedAt`.
* New `Session`, `PublicComment` and `InternalNote` tables; `Ticket` gains
  `ownerId` and `requesterResolvedAt`; `CurrentStatus` now has all eight values.
* `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` and
  `POST /api/auth/change-password`, with an `httpOnly`, `SameSite=Lax` session
  cookie that expires after 8 hours.

Issue #30 — authorization and Requester regression:

* Every Requester endpoint now takes its identity from the session. The
  `X-Requester-Id` header is not read anywhere, and `GET /api/requesters` is
  gone with the selector that used it.
* Three server-side gates run before every protected route: authenticated
  (401), past the mandatory password change (403), and holding the required
  role (403). Ownership still answers 404 so a resource belonging to someone
  else is not revealed to exist.
* Login, Change Password and a role-aware application shell; routing reads the
  session, and no destination a role may not use is rendered.

Issue #31 — IT Staff Ticket Queue:

* `GET /api/staff/tickets` — every Requester's Tickets for IT Staff and
  Administrators: search, five filters (Owner includes "unassigned"), sorting
  by ticket number, dates or IT Priority by rank, and 25 per page by default.
  Every query parameter is lenient.
* `GET /api/staff/assignees` — the active IT Staff and Administrators a Ticket
  can be assigned to, as names and roles only.
* The Ticket Queue screen: nine columns on a desktop, seven on a tablet, cards
  on a phone.
* The seed now also creates sixteen Tickets across every status, every
  priority, three Requesters, and assigned and unassigned ownership.
* Another role's address shows a "You do not have access" screen instead of
  silently redirecting.

Issue #32 — IT Staff Ticket operations:

* `PATCH /api/tickets/:id/owner`, `/it-priority` and `/status` for IT Staff and
  Administrators. Status moves follow the transition matrix, and any other move
  is refused as a conflict.
* `POST /api/tickets/:id/appears-resolved` — the Requester's "problem appears
  resolved" signal, recorded once and never changing the status.
* Public Comments (`/comments`) for everyone on a Ticket, and Internal Notes
  (`/notes`) for staff only. To a Requester, Internal Notes answer exactly as a
  Ticket that does not exist.
* Ticket Detail is one screen for every role: staff get an Operations panel,
  Download-only attachments and both threads; the Requester gets comments and the
  resolution button.
* Every endpoint returning a Ticket now includes its `requester` and `owner` as
  names and roles, and a new Ticket's IT Priority starts as its Requested
  Priority.
* The seed adds example comments and notes to some of its tickets.

Issue #33 — Administrator user management:

* `GET`, `POST` and `PATCH /api/users` and `POST /api/users/:id/initial-password`,
  for Administrators only. There is no delete: deactivation is the only way an
  account stops working.
* Email addresses are unique whatever their capitalisation; deactivating an
  account ends its open sessions at once; an Administrator cannot deactivate or
  demote themselves; and the last active Administrator cannot be removed.
* User Management: the list, search and role filter, and the Create and Edit
  dialogs, with an accessible focus trap shared by every dialog in the app.

Issue #34 — end-to-end, responsive and visual QA:

* Playwright suites under `e2e/lab-03/` for sign-in and role access, IT Staff
  ticket work and user administration, and screenshots of every Lab 3 screen at
  1440, 768 and 375px under `artifacts/lab-03/screenshots/`.
* A session that ends while in use — the account deactivated, say — now returns
  the person to Login at their next action, and saving a mandatory new password
  opens the application instead of showing the form a second time.
* The Lab 2 end-to-end tests sign in instead of choosing a Requester.

### Development sign-in credentials

Every seeded account uses the same **local-development password**:

```
ChangeMe123!
```

This is not a secret and is not anyone's real password. It exists so the
application can be run locally; no production credential belongs in this file
or anywhere else in the repository.

| Account | Role | Notes |
|---|---|---|
| `jennifer.anderson@example.edu` | Requester | active |
| `michael.brown@example.edu` | Requester | active, owns most demo tickets |
| `sarah.johnson@example.edu` | Requester | active |
| `david.lee@example.edu` | Requester | active, **must change password at first sign-in** |
| `former.student@example.edu` | Requester | inactive — sign-in is refused |
| `somsak.wattana@example.edu` | IT Staff | active |
| `nattapong.sri@example.edu` | IT Staff | active |
| `preecha.thongchai@example.edu` | IT Staff | active |
| `retired.technician@example.edu` | IT Staff | inactive |
| `anong.kittisak@example.edu` | Administrator | active |

Accounts **migrated from a Lab 2 database** (rather than created by the seed)
also start with this password and are all flagged to change it at first
sign-in, so a migrated account cannot be used until a real password is set.

### If `prisma migrate dev` reports drift

A database created with `prisma db push` has the tables but no record of the
migrations that would have built them, so Migrate sees a mismatch and offers to
reset — which would delete everything. Do not accept. Register the existing
migrations as already applied instead, from `server/`:

```bash
npx prisma migrate resolve --applied 20260814191724_init_category
npx prisma migrate resolve --applied 20260901092602_add_requester_ticket_attachment
npx prisma migrate resolve --applied 20260902191419_add_ticket_number_counter
```

`npx prisma migrate status` should then report that the schema is up to date,
and `npx prisma migrate dev` will apply only what is genuinely new.

## The Development Requester selector is gone

Lab 2 identified its caller with a **Development Requester selector**: a
Selection screen, `GET /api/requesters`, and an `X-Requester-Id` header that
the ticket and attachment endpoints trusted. It was never authentication —
any client could claim to be any Requester by sending a different id — and it
was documented as a testing mechanism throughout Lab 2.

Lab 3 removed it in two steps. Issue #29 added real accounts, passwords and
server-side sessions alongside it; **Issue #30 deleted it**: the Selection
screen, the route, the `sessionStorage` state, `GET /api/requesters`, and the
header itself. The header is no longer read by anything, so sending it has no
effect on any endpoint (`docs/lab-03/specification.md` AC-03, AC-25).

The ownership checks that Lab 2 performed against that header did not move —
they now run against the authenticated session instead, which is why a Lab 2
Ticket is still owned by, and still readable only by, the same person after
migration.

## Documentation

The sprint documents live under `docs/lab-02/`:

| File | What it holds |
|---|---|
| `specification.md` | Scope, functional requirements, business rules BR-01–BR-40, acceptance criteria AC-01–AC-17, data changes, definition of done |
| `api-spec.md` | The ten endpoints, their request/response shapes, and the error envelope |
| `ui-spec.md` | Zen Green design tokens, every screen and state, responsive rules, accessibility rules |
| `tests.md` | Every planned test with its id, the AC and BR traceability tables, the responsive checklist, and the recorded result of each run |
| `reviewer.md` | Peer review record — who reviewed what, the comments given and received, and the responses |
| `ai-use.md` | Which AI agent was used, the key prompts, and reflection on working with it |

Test evidence sits alongside them: `server/tests/lab-02/`,
`client/tests/lab-02/`, `e2e/lab-02/`, and the responsive screenshots in
`artifacts/lab-02/screenshots/`.

## Prerequisites

* Node.js (v18 or higher)
* npm
* PostgreSQL running locally (or via Docker)

## Setup

From the repository root, set up your environment variables:
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

## Setup Backend

From the repository root:

```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```
`prisma migrate dev` applies every existing migration on a fresh clone (the
Lab 1 `Category` migration, the Lab 2 `Requester`/`Ticket`/`Attachment`
migration, and the Ticket Number counter migration); it only prompts for a
new migration name if you've changed `schema.prisma` yourself and there's
new drift to capture.

Uploaded attachments are written to the directory named by `UPLOAD_DIR` in
`server/.env` (default `server/uploads/`, created on first upload and
git-ignored). The test suite overrides it with a temporary directory, so
running tests never writes into the repository.

## Setup Frontend

From the repository root — a second terminal is fine, and is what you will
want later when the API and the client both need to keep running:

```bash
cd client
npm install
```

The local database is PostgreSQL at localhost:5432. The seed is idempotent —
rerunning `npx prisma db seed` never creates duplicate Categories, Related
Systems, or Requesters. The client reads `VITE_API_URL` from `client/.env`;
its development value is `http://localhost:3000`. The database credentials
are development-only values from `.env.example`; never commit either `.env`
file or any real credentials.

## Run the app

Backend:
```bash
cd server
npm run dev
```

Frontend:
```bash
cd client
npm run dev
```

Open the Vite URL shown in the client terminal. You should see the **Login
screen**. Sign in with one of the accounts in *Development sign-in
credentials* above — `jennifer.anderson@example.edu` / `ChangeMe123!` is a
straightforward Requester.

A Requester lands on `/my-tickets`, with their name and role badge in the
header and a `Profile ▾` menu holding Change Password and Log Out. Use
"Create Ticket" to submit a ticket — on success the screen shows the Ticket
Number generated by the backend. Refreshing keeps you signed in: the session
lives in an `httpOnly` cookie for 8 hours, and the client asks
`GET /api/auth/me` on each load rather than storing anything itself.

Sign in as `david.lee@example.edu` to see the mandatory password change: every
screen and every protected endpoint stays unavailable until a new password is
saved.

Sign in as `somsak.wattana@example.edu` to see the **Ticket Queue**: every
Requester's tickets, with search, filters, sorting and pagination, all kept in
the address so a filtered view can be bookmarked. Administrators carry the queue
in their navigation too. Opening a ticket from the queue shows the staff Ticket Detail: claim
or reassign it, set its IT Priority, move its status (Closed and Cancelled ask
first), and write Public Comments and Internal Notes. Signed in as the ticket's
Requester, the same screen shows the Public Comments and a **Problem Appears
Resolved** button instead, and never any trace of Internal Notes.

Sign in as `anong.kittisak@example.edu` for **User Management**: every account,
with search and a role filter, a Create User dialog, and an Edit dialog for name,
email, role and status with a separate section for setting a new initial
password. It will not let an Administrator deactivate or demote their own
account, nor remove the last active Administrator.

## Production build

```bash
cd server
npm run build
npm start
```
`npm run build` compiles `src/` only (via `tsconfig.build.json`) so the output
is `dist/index.js`, which is what `npm start` runs. The root `tsconfig.json`
still covers `src`, `prisma`, and `tests` for typechecking with
`npx tsc --noEmit`.

The client build is `cd client && npm run build`.

## Test

Each block below starts from the repository root.

Backend Tests (Supertest):
```bash
cd server
npm test
```
The API tests run against the same local PostgreSQL database configured in
`server/.env`, so run the migration and seed steps above first. They create
and clean up their own throwaway accounts and tickets rather than reusing the
seeded demo identities.

The Lab 3 suites additionally create three scratch databases and drop them
again: `toktickit_migration_test`, where the migration files are replayed around
Lab 2-shaped data; `toktickit_seed_test`, where the seed runs from nothing; and
`toktickit_users_test`, where the user-management suite can make any account the
last active Administrator without touching the development database. The
PostgreSQL user in `DATABASE_URL` therefore needs permission to create a
database.

Frontend Tests (Vitest):
```bash
cd client
npm test
```
End-to-end and visual tests (Playwright; Lab 2 Issue #17, Lab 3 Issue #34):
```bash
npm install
npx playwright install chromium
npm run test:e2e
```
Run these from the repository root, not from `client/` or `server/`. They
drive a real browser against the running app, so both the API and the client
have to be up; Playwright reuses whatever is already listening on ports 3000
and 5173 and starts them itself only when nothing is.

**Before a run**, the database must be migrated and seeded, and the seeded
Administrator `anong.kittisak@example.edu` must still be the only active
Administrator and still use the development password: E2E-10 reaches the "last
active Administrator" refusal on that account. The run checks this first and
stops with a message if it does not hold.

The suite signs in as accounts of its own, each with an `e2e-` address, created
before the run and removed afterwards together with every ticket it created
(each marked `[e2e]` in its description). If a run is interrupted, remove them
by hand:
```bash
npm run e2e:cleanup --prefix server
```

It also writes the screenshots the visual checklists are read against: Lab 3's
into `artifacts/lab-03/screenshots/` (`authentication/`, `staff-queue/`,
`staff-ticket-detail/`, `user-management/`, checked against
`docs/lab-03/tests.md` §5) and Lab 2's into `artifacts/lab-02/screenshots/`.
Those are committed as sprint evidence; the Playwright HTML report and traces
are not (see `.gitignore`). Open the report from the last run with:
```bash
npm run test:e2e:report
```
