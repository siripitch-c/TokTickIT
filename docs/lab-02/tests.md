# Lab 2 Test Plan and Results

## 1. Strategy

Run unit/UI tests with the client runner, API/integration tests against isolated test PostgreSQL and uploads directory, and Playwright E2E against seeded data. Mock only external/browser boundaries; ownership, validation, Prisma queries and filesystem behavior are integration-tested. No required test may be skipped, disabled or commented out.

## 2. Planned tests

| ID | Coverage | Actual file path |
|---|---|---|
| API-REQ-01..04 | active requester list; inactive exclusion; selector API failure/empty behavior | `server/tests/lab-02/requesters.api.test.ts` |
| API-CREATE-01..09 | required/trim/length/enum/reference validation; ticket defaults; atomic unique number; no partial persistence; server-side validation authority | `server/tests/lab-02/create-ticket.api.test.ts` |
| API-LIST-01..12 | owner scoping; search; each AND filter including IT unset; all sort/direction/default/tie-breaker; pages 1/beyond; sizes/default invalid values | `server/tests/lab-02/my-tickets.api.test.ts` |
| API-DETAIL-01..04 | owned detail; foreign/missing 404; returned removed metadata; requester header validation | `server/tests/lab-02/ticket-detail.api.test.ts` |
| API-ATT-01..14 | allowed/blocked type, 5 MiB boundary, fifth/sixth cap, safe storage name, owner upload/meta/download/remove, reason bounds, removed download 404, upload failure cleanup | `server/tests/lab-02/attachments.api.test.ts` |
| UI-CTX-01..06 | selector states; session restore; route guard; Change Requester clears list/draft; accessible controls | `client/src/tests/lab-02/RequesterContext.test.tsx` |
| UI-CREATE-01..11 | loaded references; all field errors; valid submit/success; busy/double-click; server error value retention; zero-five/invalid attachments | `client/src/tests/lab-02/CreateTicket.test.tsx` |
| UI-LIST-01..12 | loading/error/empty/no-results; search/filter/clear; sort/page/page-size; cards/table; context switch | `client/src/tests/lab-02/MyTickets.test.tsx` |
| UI-DETAIL-01..10 | owned/not-found state; read-only fields; attachment upload/busy/error/download/remove confirmation/reason/removed UI | `client/src/tests/lab-02/RequesterTicketDetail.test.tsx`, `client/src/tests/lab-02/AttachmentSection.test.tsx` |
| E2E-01..12 | selector -> create -> number -> list -> detail -> add/download/remove; A/B isolation; validation/failure; desktop/tablet/mobile screenshots | `e2e/lab-02/requester-ticket-flow.spec.ts` |

## 3. Acceptance-criterion traceability

| AC | Evidence IDs |
|---|---|
| AC-01 | API-CREATE-01, UI-CREATE-05, E2E-01 |
| AC-02 | UI-CTX-03, E2E-02 |
| AC-03 | API-DETAIL-02, E2E-08 |
| AC-04 | UI-CREATE-02 |
| AC-05 | E2E-10 |
| AC-06 | UI-CREATE-08, E2E-06 |
| AC-07 | API-ATT-05, UI-DETAIL-06 |
| AC-08 | API-ATT-12, E2E-09 |
| AC-09 | API-LIST-01, E2E-08 |
| AC-10 | UI-LIST-04, E2E-05 |
| AC-11 | API-REQ-02, UI-CTX-02 |
| AC-12 | UI-CTX-05, UI-LIST-12, E2E-07 |
| AC-13 | UI-DETAIL-08, API-ATT-10 |
| AC-14 | E2E-10, VIS-01..03 |
| AC-15 | API-LIST-08, UI-LIST-08 |
| AC-16 | API-CREATE-09, UI-CREATE-07 |
| AC-17 | API-ATT-09, E2E-04 |

## 4. Business-rule traceability

BR-01..02: API-CREATE-01..03. BR-03..06/28: API-REQ-01..04 and UI-CTX-01..06. BR-07..13: API-LIST-01..12, API-DETAIL-02 and UI-LIST-01..12. BR-14..18: API-CREATE-01..09 and UI-CREATE-01..11. BR-19..25: API-ATT-01..14 and UI-DETAIL-01..10. BR-26..27: accessibility assertions plus E2E-10..12/VIS-01..03. Every test implementation must retain these IDs in its test title/comment for a reviewable one-to-one link.

## 5. Responsive and visual checklist

VIS-01 desktop 1440px; VIS-02 tablet 768px; VIS-03 mobile 375px. At each: Zen Green tokens; editable/read-only distinction; inline validation; primary/secondary/disabled/busy hierarchy; focus and labels/tooltips; no clipping/overlap/horizontal overflow; table-to-card behavior; badges with words; selector/Create/My Tickets/Detail states. Save approved Playwright screenshots under `artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/`.

## 6. Commands and final results

Document exact repository commands in README, then run from clean clone: server `npm test`, client `npm test`, and Playwright `npm run test:e2e`. Record date, commit SHA, command, pass/fail, test count and screenshot paths here after implementation. **Current status: planned only; no tests have been executed yet.**

## 7. Deferred work

None for Lab 2. Authentication, IT workflow, comments/notes/actions and ticket lifecycle changes are explicitly out of scope, not deferred required tests.
