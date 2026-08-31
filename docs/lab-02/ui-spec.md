# Lab 2 Zen Green UI Specification

## Tokens and shared components

Primary `#006B3C` is header/primary action; secondary `#0B7A46` is active nav, hover, link and focus accent; pale `#EAF6EF` is selected/success emphasis; page `#F5F7F6`; cards are white with subtle border/shadow; text is dark charcoal-green. Editable controls are white with neutral border. Read-only controls have visibly distinct soft gray-green/warm-ivory fill. Error is dark red border/text immediately below the field; warning amber is reserved for warnings; success has text and icon, not color alone.

Use reusable `AppShell`, `FormField`, `ValidationMessage`, `AsyncState`, `Badge`, `TicketTable/TicketCard`, `Pagination`, `AttachmentSection`, `ConfirmDialog`, and accessible `IconButton`. Required labels precede controls with a textual/visual required marker. Focus is always visible; icon buttons have `aria-label` and tooltip.

## App shell and selector

Header identifies TokTickIT, offers My Tickets/Create Ticket, visibly marks the active page, displays selected requester name and has Change Requester. Mobile changes navigation to an accessible hamburger/menu.

Selector is a centered card with title, explanation that it is Lab 2 testing not login, active-requester dropdown, Continue button and Lab 3 authentication notice. It has loading, no-active-requesters blocking empty, error/retry, disabled Continue without a selection, keyboard operation and no ticket-route bypass.

## Create Ticket

Show read-only Requester, Ticket Number ("Generated after submission") and Ticket Date ("Set after submission") distinct from editable Category, Related System, Requested Priority, Summary, Description and Attachments. Category/system data fetch has loading/error/retry. Summary and description take full width; attachments sit below fields; show selected valid files, file size/type errors, active count, and removal of a pending file. Submit is primary; Cancel is secondary. On submit, show field errors without request when client validation fails; otherwise immediately disabled/busy. On success show Ticket Number and saved values; on API failure retain values and show safe retryable error; report per-file post-create upload failures independently.

## My Tickets

Show Create Ticket CTA, search by Ticket Number/Summary, single-select filters Category/Requested Priority/IT Priority/Status, clear filters, sortable headers, result count and page-size/pagination controls. Desktop is a readable table with Ticket Number, Summary, Category, Related System, Requested Priority, IT Priority, Status, Created and Updated; table row/card opens detail. Mobile uses labelled cards, never clipped columns. Distinguish skeleton/loading, API error/retry, true empty state (no tickets + Create CTA), and no-results state (clear-search/filter CTA). Sort state and page reset correctly when search/filter/sort changes.

## Ticket Detail and attachments

Show owned ticket fields read-only, local Ticket Date, text badges and a distinct Attachments panel only: add file, upload/busy, active download, soft remove, retained removed metadata. A removed item shows filename, size, uploaded date, removal date/reason and Removed label; it has neither download nor preview. Remove opens confirmation with required reason error. Detail must render loading/error/not-found safely and never expose comments, notes, actions or status-edit controls.

## Responsive and visual acceptance

Desktop >=992px uses multi-column form/table; tablet 768-991px two columns; mobile <768px one stacked column, tap targets and full-width actions as needed. At each breakpoint verify no horizontal scroll, clipping, overlap or hidden labels/buttons; readable screenshots cover selector, Create initial/invalid/busy/success/error/invalid file, My Tickets states, and detail active/removed states. Use semantic labels, native controls where suitable, keyboard navigation, focus visibility, sufficient contrast and badge text.
