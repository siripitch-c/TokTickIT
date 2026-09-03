# TokTickIT

TokTickIT is an IT service desk application being built through the CPE334 individual sprint workflow.

## Current branch scope

This branch contains everything through **Issue #13 — Create Ticket**, on
top of the Lab 1 foundation (Issues 1–4):

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
* GET `/api/requesters` — active Requesters only, no `email` in the response
* Development Requester Selection screen (loading/empty/error states),
  session-persisted selection, and a Change Requester action — this is now
  the app's real entry point, replacing the Lab 1 "Check System" demo page
* URL routing with a Requester route guard: `/select-requester`,
  `/my-tickets`, `/tickets/new`; any Requester-scoped route entered without a
  selected Requester redirects to the selector and returns afterwards
* Zen Green application shell — header, My Tickets / Create Ticket
  navigation with active-page indication, current Requester name, Change
  Requester, and a mobile hamburger panel
* POST `/api/tickets` — backend-generated `TKT-YYYY-NNNNNN` Ticket Number
  from an atomic per-year counter, ownership taken from `X-Requester-Id`,
  strict body validation
* POST `/api/tickets/:id/attachments` — JPG/JPEG/PNG/WEBP/PDF only, 5 MB per
  file, 5 active attachments per ticket, randomised names on disk
* GET `/api/related-systems` — active Related Systems for the ticket form
* Create Ticket screen with client-side validation, attachment selection,
  and the loading/validation/submitting/success/failure states from
  `docs/lab-02/ui-spec.md` §5.4

My Tickets (#14) and Ticket Detail with attachment download/removal (#15)
are not implemented on this branch; `/my-tickets` is a placeholder page.

## About the Development Requester selector

The Development Requester selector — the Selection screen, `GET
/api/requesters`, and the `X-Requester-Id` header that later ticket/
attachment endpoints will require — is a **Lab 2 testing mechanism only**.
It is **not authentication** and provides no real security: any client can
claim to be any Requester simply by sending a different id. Any `404`
returned by a ticket or attachment endpoint when the id in that header
doesn't own the requested resource (per `docs/lab-02/specification.md`
BR-12) is an ownership check performed against this testing header, not
proof of an authorization system that would resist a determined attacker.
Real authentication is planned to replace this mechanism entirely in Lab 3.

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

# Setup Frontend
```bash
cd ../client
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

Open the Vite URL shown in the client terminal. You should see the
Development Requester Selection screen first; after choosing a Requester and
continuing, the app shell opens on `/my-tickets` with your selected
Requester's name and a "Change Requester" action. Use "Create Ticket" to
submit a ticket — on success the screen shows the Ticket Number generated by
the backend. Refreshing the page keeps you signed in as the same Requester
for the rest of the browser session (sessionStorage); Change Requester
clears that and returns you to the selector.

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
Backend Tests (Supertest):
```bash
cd server
npm test
```
The API tests run against the same local PostgreSQL database configured in
`server/.env`, so run the migration and seed steps above first. They create
and clean up their own throwaway Requesters and tickets rather than reusing
the seeded demo identities.

Frontend Tests (Vitest):
```bash
cd client
npm test
```