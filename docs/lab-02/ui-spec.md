# Lab 2 UI Specification — Zen Green Theme

This document is the authoritative visual and interaction contract for
every Lab 2 screen. `specification.md` §6 is only a summary; this file is
what the implementation and visual/UI tests must match. Class names below
are illustrative conventions (`kebab-case`, prefixed `zg-` for shared
primitives) — the implementation may rename them, but every state listed
here must exist and be independently checkable in a screenshot or DOM
query.

## 1. Design Tokens

### 1.1 Color

| Token | Value | Required use |
|---|---|---|
| `--zg-primary` | `#006B3C` | App header background, primary button fill, strong emphasis text on light backgrounds |
| `--zg-secondary` | `#0B7A46` | Active tab underline/indicator, focus ring accent, links, hover state on secondary controls |
| `--zg-pale` | `#EAF6EF` | Selected row/tab background, success banner background, subtle section emphasis — deliberately **not** reused for read-only fields, which get their own token below, so "success" and "read-only" never look like the same fill |
| `--zg-bg` | `#F5F7F6` | Page background |
| `--zg-surface` | `#FFFFFF` | Card/panel background |
| `--zg-border` | `#DDE5E1` | Default card and input border |
| `--zg-text` | `#1E2A24` | Body text (dark charcoal-green, never pure black `#000`) |
| `--zg-text-muted` | `#5B6B63` | Helper text, timestamps, secondary labels |
| `--zg-editable-bg` | `#FFFFFF` | Editable field background |
| `--zg-editable-border` | `#C7D2CC` | Editable field border (neutral, not green, not gray-only) |
| `--zg-readonly-bg` | `#EEF1EE` | Read-only field background (soft gray-green, per `specification.md` §6) |
| `--zg-readonly-border` | `#CDD6D0` | Read-only field border (deliberately grayer/darker than `--zg-pale`'s border so the two don't read as the same fill at a glance) |
| `--zg-error` | `#8A1F1F` | Error text and border |
| `--zg-error-bg` | `#FBEAEA` | Error banner/callout background |
| `--zg-warning` | `#8A5B00` | Warning text |
| `--zg-warning-bg` | `#FFF3DC` | Warning callout/badge background (amber) |
| `--zg-success` | `#0B7A46` | Success text/icon (reuses secondary green) |
| `--zg-disabled-bg` | `#EDEFED` | Disabled control background |
| `--zg-disabled-text` | `#9AA5A0` | Disabled control text |

Decision: `specification.md` §6 already commits read-only fields to a
"soft gray-green background" (one of the two options handout §7 allows).
This document follows that choice rather than introducing a new one, but
picks a specific gray-green (`--zg-readonly-bg`) that is visibly grayer
and darker-bordered than `--zg-pale` (the success/selected token), so the
two states never look identical side by side even though both sit in the
green family. `specification.md` §11 does not currently record this
gray-green-vs-ivory decision at all; since handout §8.10 expects
meaningful implementation choices to live there, you may want to add a
one-line entry to `specification.md` §11 confirming "soft gray-green" as
the final choice, for traceability.

### 1.2 Typography

| Token | Value | Use |
|---|---|---|
| `--zg-font` | System UI stack (`-apple-system, "Segoe UI", Roboto, sans-serif`) | All text |
| `--zg-text-xs` | 12px / 16px line-height | Helper text, timestamps, badge labels |
| `--zg-text-sm` | 14px / 20px | Field labels, table cells, secondary buttons |
| `--zg-text-base` | 16px / 24px | Body text, input values, primary buttons |
| `--zg-text-lg` | 20px / 28px | Section headings (e.g. "Attachments") |
| `--zg-text-xl` | 28px / 36px | Screen titles ("Create Ticket", "My Tickets") |
| Label weight | 600 | Every field label, consistently, across all screens |
| Value weight | 400 | Field values and body copy |

### 1.3 Spacing

| Token | Value |
|---|---|
| `--zg-space-1` | 4px |
| `--zg-space-2` | 8px |
| `--zg-space-3` | 16px |
| `--zg-space-4` | 24px |
| `--zg-space-5` | 32px |
| `--zg-space-6` | 48px |

Rules:
- Field label to control gap: `--zg-space-1`.
- Control to validation message gap: `--zg-space-1` (message sits
  immediately below the control it validates — never a top-of-form
  summary alone, per handout §8.3).
- Field group to field group gap: `--zg-space-3`.
- Section to section gap (e.g. main fields to Attachments): `--zg-space-5`.
- Card internal padding: `--zg-space-4` desktop/tablet, `--zg-space-3`
  mobile.

## 2. Shared Components and States

### 2.1 Field control (`zg-field`)

Every field is a group of: label, control, optional helper text, optional
validation message. States, each with a distinct visual treatment (not
color alone):

| State | Class | Visual treatment |
|---|---|---|
| Editable, default | `zg-field--editable` | White bg, `--zg-editable-border`, normal text |
| Editable, focused | `zg-field--editable zg-field--focus` | 2px `--zg-secondary` focus ring, border color `--zg-secondary` |
| Read-only | `zg-field--readonly` | `--zg-readonly-bg` fill, `--zg-readonly-border`, cursor `not-allowed`, no focus ring, `aria-readonly="true"` |
| Invalid | `zg-field--invalid` | `--zg-error` border (2px), error icon inside control, message rendered directly below in `--zg-error` text |
| Disabled | `zg-field--disabled` | `--zg-disabled-bg` fill, `--zg-disabled-text`, `disabled` attribute set (not just styled) |

Required-field marker: a red asterisk (`--zg-error` color) immediately
after the label text, e.g. `Summary *`. Per handout §8.3, the asterisk is
never sufficient alone — every required field must also produce a
validation message on failed submit; a field must never rely on the
asterisk as its only failure indicator.

Validation message: `role="alert"` text node, `--zg-error` color,
`--zg-text-sm`, positioned directly under the control, prefixed with no
icon duplication if the field border already shows the error icon (avoid
redundant iconography).

Control height (per handout §8.3, "inputs use one consistent height"):
every single-line control — text input, select, the Ticket Number/
Requester read-only fields — is a fixed `40px` tall across every screen.
`Description` is the one documented exception (BR-20 needs room for up to
2000 characters): it starts at `~120px` and may be resized taller by the
Requester, but never shorter than its start height, and its extra height
must not push page buttons off-screen or force horizontal scroll at any
breakpoint (per §8's responsive rules).

### 2.2 Buttons (`zg-btn`)

| Variant | Class | Visual | Use |
|---|---|---|---|
| Primary | `zg-btn--primary` | `--zg-primary` fill, white text | Submit, Continue, Create Ticket |
| Secondary | `zg-btn--secondary` | White fill, `--zg-secondary` border + text | Cancel, Clear Filters, Change Requester |
| Tertiary | `zg-btn--tertiary` | No border/fill, `--zg-secondary` text, underline on hover | Inline links, "Back to My Tickets" |
| Destructive | `zg-btn--destructive` | White fill, `--zg-error` border + text; on hover, `--zg-error` fill + white text | Remove Attachment |
| Disabled | `zg-btn--disabled` | `--zg-disabled-bg`/`--zg-disabled-text`, `disabled` attribute, no hover effect | Any button while its action is unavailable |
| Busy | `zg-btn--busy` | Same fill as its variant but with an inline spinner replacing/preceding the label text, `aria-busy="true"`, `disabled` attribute set (per BR-22) | Submit while a request is in flight |

Icon-only buttons (e.g. a download or remove icon on an attachment row)
always carry: a visible `title` tooltip, an `aria-label` matching the
tooltip text, and a focus outline identical to text buttons (per BR-39).
An icon is never the sole content of a button without both attributes.

### 2.3 Badges (`zg-badge`)

Used for Requested Priority, IT Priority, and Current Status. Every badge
renders **text + color**, never color alone (per handout §8.8 and BR-39's
accessibility intent extended to color-blindness).

| Value | Badge class | Fill | Text |
|---|---|---|---|
| `LOW` | `zg-badge--low` | `--zg-pale` | `--zg-secondary` |
| `MEDIUM` | `zg-badge--medium` | `--zg-warning-bg` | `--zg-warning` |
| `HIGH` | `zg-badge--high` | `--zg-error-bg` | `--zg-error` |
| `NEW` (Current Status) | `zg-badge--status-new` | `--zg-pale` | `--zg-secondary` |
| IT Priority `null` | `zg-badge--unset` | `--zg-disabled-bg` | `--zg-disabled-text`, label text reads "Not set" |

### 2.4 Loading, empty, no-results, and error states (`zg-state`)

Every screen or panel that fetches data implements all four applicable
states as distinct, independently-renderable blocks — never a single
generic "something went wrong" fallback covering more than one meaning.

| State | Class | Content |
|---|---|---|
| Loading | `zg-state--loading` | Centered spinner + "Loading…" text; skeleton rows for list screens |
| Empty (zero records exist) | `zg-state--empty` | Icon, one-line explanation, primary call-to-action where applicable (e.g. "You haven't created any tickets yet." + Create Ticket button) |
| No-results (filters/search matched zero of many) | `zg-state--no-results` | Icon, "No tickets match your filters." + a Clear Filters action; visually distinct from Empty (different icon/copy; per BR-37) |
| Error (safe API failure) | `zg-state--error` | Warning icon, generic safe message (never a raw stack trace or DB string, per api-spec.md §6), Retry action where applicable |

### 2.5 Attachment row (`zg-attachment-row`)

| State | Class | Visual |
|---|---|---|
| Active | `zg-attachment-row--active` | Filename, size, upload date, Download + Remove icon buttons |
| Uploading | `zg-attachment-row--uploading` | Filename, inline progress/spinner, no action buttons yet |
| Upload error | `zg-attachment-row--upload-error` | Filename struck through or flagged, `--zg-error` inline message, Retry action (per BR-33) |
| Removed | `zg-attachment-row--removed` | Filename, size, upload date, removal date, removal reason, `--zg-disabled-text`; **no** Download button rendered (not just disabled — absent, per BR-30) |
| Selected pre-upload (Create Ticket only) | `zg-attachment-row--pending` | Filename, size, a remove-from-selection (×) control, no server state yet |
| Invalid selection | `zg-attachment-row--invalid` | Filename, `--zg-error` message ("Unsupported file type" / "File exceeds 5 MB"), not added to the pending list |

## 3. Application Shell

- Header bar: `--zg-primary` background, white text/icons, height 64px
  desktop / 56px mobile.
- Left: TokTickIT wordmark + clock-glyph icon (app identity).
- Center/left-of-center (desktop ≥992px): "My Tickets" and "Create
  Ticket" nav items, each a `zg-nav-item`; the active route gets
  `zg-nav-item--active` (white bottom border 3px + slightly bolder text —
  not color alone, since both are already white-on-green).
- Right: current Requester name + a "Change Requester" `zg-btn--tertiary`
  (rendered in white/`--zg-pale` text on the green header), both rendered
  inline rather than behind the mockup's `Profile ▾` disclosure. Decision:
  the Requester name is the one piece of context that proves which testing
  identity is active (handout §8), so hiding it behind a disclosure would
  cost a click on every screen to answer "who am I right now?", and it
  would put the Lab 2 identity switch one keyboard step further away for
  no benefit. The disclosure returns in Lab 3, when a real account menu
  has more than two things in it.
- Mobile (<768px): wordmark + hamburger icon only; tapping the hamburger
  opens a full-width `zg-mobile-nav` panel (slide-down) containing My
  Tickets, Create Ticket, current Requester name, and Change Requester,
  each a full-width tappable row ≥44px tall.
- Breadcrumb row (below header, above page content) on My Tickets, Create
  Ticket, and Ticket Detail: e.g. `My Tickets > Ticket Details`, using
  `--zg-text-muted`, with the last segment in `--zg-text` and the earlier
  segments as `zg-btn--tertiary` links.

## 4. Development Requester Selection Screen

Route: `/select-requester`. Per AC-02/BR-04, any route that needs a
current Requester (My Tickets, Create Ticket, Ticket Detail) redirects
here automatically when no Requester is selected, and back to the
originally-requested route once one is chosen; this guard is implemented
once at the app-shell/routing level, not duplicated per screen (see
`tests.md` E2E-02).

Layout: single centered `zg-card` (max-width 480px) on `--zg-bg`
background, vertically centered.

Card contents, top to bottom:
1. Icon (person + gear glyph) in a `--zg-pale` circular badge.
2. Heading: "Select Development Requester" (`--zg-text-xl`).
3. Explanatory copy (`--zg-text-sm`, `--zg-text-muted`): "Choose a
   development requester to simulate the current requester context for
   Lab 2. This is for testing only and is not a login screen."
4. Field: "Development Requester *" label + `zg-field--editable` select
   dropdown, populated from `GET /api/requesters`.
5. Info callout (`zg-callout--info`, `--zg-pale` background, info icon):
   "Only active development requesters are shown."
6. Notice callout (`zg-callout--neutral`, shield icon, `--zg-disabled-bg`
   background): "Authentication coming in Lab 3 — In Lab 3, this
   selection will be replaced with secure authentication so you can
   access the system with your own account."
7. Actions row: `Cancel` (`zg-btn--secondary`, disabled/no-op until a
   later lab, or omitted if there is nowhere to cancel to) and
   `Continue →` (`zg-btn--primary`), right-aligned. `Continue` is
   `zg-btn--disabled` until a Requester is selected in the dropdown.

States:
- **Loading** (`zg-state--loading`): dropdown replaced by a skeleton bar
  while `GET /api/requesters` is in flight; Continue disabled.
- **Empty** (`zg-state--empty`, per BR-09): dropdown area replaced by
  "No active development requesters are available. Please contact an
  administrator." with no Continue action rendered as usable.
- **Error** (`zg-state--error`, per BR-08): dropdown area replaced by a
  safe error message + `Retry` (`zg-btn--secondary`); Continue remains
  disabled; the Requester cannot proceed into the application from this
  state.
- **Populated**: dropdown lists every active Requester's `name` only
  (never `email`, per api-spec.md §3).

Keyboard/accessibility: the select is a native `<select>` or an
ARIA-compliant combobox reachable and operable by keyboard alone (arrow
keys + Enter); `Continue` and `Retry` are real `<button>` elements with
visible focus rings using `--zg-secondary`.

## 5. Create Ticket Screen

Route: `/tickets/new`.

### 5.1 Layout (desktop ≥992px)

Single centered column, max-width 840px, inside a `zg-card`.

Top to bottom:
1. Screen title "Create Ticket" (`--zg-text-xl`) + breadcrumb.
2. **System-generated row** (read-only, `zg-field--readonly` throughout),
   3 columns: "Ticket Number" (shows a placeholder such as "Generated
   after submit" pre-submit), "Ticket Date" (shows today's date/time in
   local format pre-submit — the same value that becomes the Ticket's
   `createdAt`, per `specification.md` §7 — and is not re-fetched or
   re-rendered after submit, since it does not change), and "Requester"
   (current selected Requester's name, sourced from context, never
   editable).
3. **Classification row** (editable), 3 columns: "Category *" (select),
   "Related System *" (select), "Requested Priority *" (select:
   Low/Medium/High).
4. **Summary** (editable, full width, single-line input, 150 char
   counter shown once >120 chars entered, per the 5–150 rule in BR-19).
5. **Description** (editable, full width, resizable textarea, min-height
   ~120px, 2000 char counter shown once >1800 chars entered, per BR-20).
6. **Attachments** section (`zg-section`, heading "Attachments"): a
   drag-or-browse drop zone (`zg-dropzone`), the list of
   `zg-attachment-row--pending`/`--invalid` rows for files chosen so far
   (0–5), and helper text "JPG, PNG, WEBP, or PDF — up to 5 MB each,
   maximum 5 files."
7. Actions row: `Cancel` (`zg-btn--secondary`, returns to My Tickets) and
   `Submit Ticket` (`zg-btn--primary`), right-aligned. `Submit Ticket`
   becomes `zg-btn--busy` and disabled the instant it is clicked, per
   BR-22, until the request resolves.

### 5.2 Layout (tablet 768–991px)

Same field grouping, but the classification row collapses from 3 columns
to 2 (Category + Related System on one row, Requested Priority on its
own full-width row below). System-generated row collapses from 3 columns
to 2 (Ticket Number + Ticket Date on one row, Requester on its own
full-width row below).

### 5.3 Layout (mobile <768px)

Every field group stacks to a single column, full width. The system-
generated row still visually precedes classification fields but each
field is now its own full-width block. Attachments drop zone is
full-width and remains touch-tappable (≥44px target). Submit and Cancel
buttons stack full-width, Submit above Cancel, both ≥44px tall.

### 5.4 States

- **Initial**: all editable fields empty, no validation messages, Submit
  enabled (not busy).
- **Validation failure**: on Submit click, every invalid field shows its
  `zg-field--invalid` styling and message simultaneously (not one at a
  time); focus moves to the first invalid field; no API call is made
  (AC-04).
- **Submitting**: Submit is `zg-btn--busy`; every field is disabled for the
  duration of the request — using the real `disabled` attribute, per §9's
  rule that a disabled control never relies on styling or ARIA alone — to
  prevent edits mid-request; no duplicate submission is possible
  (BR-22/AC-16). (An earlier draft of this section said `aria-disabled`,
  which contradicted §9; §9 is the rule that stands.)
- **Success**: the form is replaced (not just overlaid) by a
  `zg-state--success` panel: a check icon, "Ticket created" heading, the
  generated Ticket Number in large `--zg-text-xl` monospace-styled text,
  and two actions — `View Ticket` (`zg-btn--primary`, goes to Ticket
  Detail) and `Create Another` (`zg-btn--secondary`, resets the form).
  If any attachment failed to upload (BR-25), a `zg-callout--warning` is
  shown above the actions naming the specific failed file(s).
- **API failure** (BR-24/AC-06): the form remains visible with every
  entered value intact; a `zg-state--error` banner appears above the
  fields ("Something went wrong saving your ticket. Please try again.");
  Submit returns to its normal enabled (non-busy) state.
- **Invalid attachment selection** (BR-26/BR-27): the offending file
  appears as `zg-attachment-row--invalid` with its specific reason (type
  or size) and is not counted toward the 0–5 total; other valid
  selections are unaffected.
- **6th attachment attempted** (BR-28, checked client-side before
  submission attempts to add a 6th): the drop zone shows an inline
  message "Maximum 5 attachments per ticket." and does not add the file
  to the pending list.

## 6. My Tickets Screen

Route: `/my-tickets`.

### 6.1 Layout (desktop ≥992px)

Full-width `zg-card` inside the centered app max-width container.

1. Header row: "My Tickets" title (`--zg-text-xl`) + subtitle ("View and
   track all of your support requests.") on the left; `Clear Filters`
   (`zg-btn--secondary`) and `+ Create Ticket` (`zg-btn--primary`) on the
   right.
2. Controls row: search input (icon-prefixed, placeholder "Search by
   ticket number or summary…", debounced), then four filter selects —
   Category, Requested Priority, IT Priority, Current Status — each
   defaulting to "All …".
3. Table (`zg-table`), columns: Ticket No. (sortable), Created Date
   (sortable), Summary, Category, Requested Priority (badge), IT Priority
   (badge), Current Status (badge), Last Updated (sortable). Sortable
   column headers show a `↕`/`↑`/`↓` indicator reflecting current sort
   state; clicking toggles direction, clicking a different column
   switches primary sort field (BR-15/AC-15). A newly chosen column starts
   **descending**, matching BR-15's default rather than flipping to ascending
   for no stated reason. Changing the sort returns to page 1, since a
   reordered list makes the old page number meaningless.

   Each row is clickable (whole row, not just the ticket number) and opens
   Ticket Detail. The row keeps its native table semantics — a `role` on the
   `<tr>` would replace `row` and drop it out of the table for assistive
   technology — so the whole-row click is a pointer convenience and the
   Ticket No. cell holds the real, focusable link that keyboard and screen
   reader users follow.
4. Footer row: "Showing X to Y of Z tickets" (`--zg-text-sm`,
   `--zg-text-muted`) on the left; pagination control (`Previous` /
   numbered pages with an ellipsis for long ranges / `Next`) on the
   right; a page-size select (10/25/50) beside it.

Note: Requester and Ticket Owner columns from the illustrative Figure 1
mockup are **not** included — Lab 2's My Tickets is single-Requester
scoped by definition (BR-11), and "Ticket Owner" is IT Staff-workflow
data explicitly excluded per `specification.md` §3.

### 6.2 Layout (tablet 768–991px)

Search + filters wrap to two rows (search full-width; four filters in a
2×2 grid). Table drops the "Category" column from view (still available
via filter) to avoid horizontal scroll; remaining columns keep their
sortability.

### 6.3 Layout (mobile <768px)

Table is replaced entirely by a stacked list of `zg-ticket-card`
components (never a horizontally-scrolling table). Each card shows, top
to bottom: Ticket No. + Created Date (small, muted) on one line;
Summary (bold, wraps normally); a badge row (Requested Priority, IT
Priority, Current Status); Category + Last Updated as a small muted
footer line. The whole card is tappable. Search is a full-width input
above the list; filters collapse into a single "Filters" button that
opens a `zg-filter-sheet` bottom sheet containing the same four selects
plus a full-width "Apply" and "Clear Filters" action. Each select takes
effect as it is changed, the same as on desktop; "Apply" closes the sheet
to reveal the list it has already filtered, rather than gating the filters
behind a second tap that could be forgotten. Pagination becomes
`Previous`/`Next` only (no numbered page buttons) plus "Page X of Y"
text, to keep controls thumb-reachable.

### 6.4 States

- **Loading**: skeleton rows (desktop table) or skeleton cards (mobile),
  5 placeholders. Search and filters stay visible and stay usable — an
  earlier draft said "interactive but disabled", which cannot be both, and
  disabling them was the worse reading: every keystroke in a debounced search
  starts a load, so disabling on load would take the field away mid-word and
  drop the focus. They are disabled only for the very first load of the
  screen, when there is not yet a list for them to act on.
- **Empty** (BR-37, zero owned tickets ever): table/card area replaced by
  `zg-state--empty` — "You haven't created any tickets yet." + `Create
  Ticket` primary button. Search/filter controls are hidden in this
  state (there is nothing to filter).
- **No-results** (BR-37, filters/search matched zero of a non-empty set):
  table/card area replaced by `zg-state--no-results` — "No tickets match
  your filters." + `Clear Filters` button. Search/filter controls remain
  visible and interactive.
- **Error**: `zg-state--error` replaces the table/card area entirely;
  Retry action re-fetches with the same query parameters.
- **Requester switch while viewing** (BR-07/UI-LIST-07): the entire list
  area transitions back through Loading for the new Requester; filters
  and search term reset to default (do not carry over between
  Requesters).

## 7. Requester Ticket Detail Screen

Route: `/tickets/:id`.

### 7.1 Layout (desktop ≥992px)

`zg-card`, max-width 960px, breadcrumb "My Tickets > Ticket Details" with
a `← Back to My Tickets` `zg-btn--tertiary` at the top-right of the
breadcrumb row.

1. **Ticket information panel** (all `zg-field--readonly`), arranged in a
   4-column grid matching the Create Ticket field set exactly, so a
   Requester recognizes the same information they entered:
   Row 1: Ticket No. · Ticket Date · Category · Related System
   Row 2: Requester · Requested Priority (badge) · IT Priority (badge) ·
   Current Status (badge)
   Row 3 (full width): Summary
   Row 4 (full width): Description
2. Visual separator (`--zg-border` rule + `--zg-space-5` gap) clearly
   dividing Ticket information from Attachments — the handout requires
   these be clearly distinguished, so this is a hard visual break, not
   just a heading change.
3. **Attachments panel** (`zg-section`, heading "Attachments (`n`
   active)"):
   - List of `zg-attachment-row` items (active + removed, per BR-29 —
     removed ones stay visible as metadata).
   - "+ Add Attachment" control (`zg-btn--secondary`) at the top of the
     panel, opening the same drop-zone pattern as Create Ticket,
     disabled once 5 active attachments exist (BR-28) with a tooltip
     explaining why.
   - Each active row has Download (icon + "Download" or icon-only with
     tooltip) and Remove (icon-only, destructive, tooltip "Remove
     attachment") controls.
   - Clicking Remove opens a `zg-modal--confirm` requiring: a "Removal
     reason *" textarea (5–200 chars, BR-31) and `Cancel` /
     `Remove Attachment` (`zg-btn--destructive`) actions; the destructive
     action is disabled until the reason passes length validation.

No Public Comments, Internal Notes, Service Actions, or Event Log
sections are rendered anywhere on this screen (explicitly excluded, per
`specification.md` §3 and the note about Figure 1's illustrative mockup).

### 7.2 Layout (tablet 768–991px)

Ticket information grid drops to 2 columns (Ticket No./Ticket Date,
Category/Related System, Requester/Requested Priority, IT
Priority/Current Status); Summary and Description remain full width.
Attachments panel is unchanged (list layout already works at this width).

### 7.3 Layout (mobile <768px)

Ticket information becomes a single stacked column, one field per row,
each still visually read-only per §2.1. Attachment rows stack their
filename/metadata above their action buttons (icon buttons remain
side-by-side, ≥44px targets) rather than compressing onto one line.

### 7.4 States

- **Loading**: skeleton blocks for the info panel and a skeleton list for
  Attachments.
- **Not found / not owned** (BR-12/AC-03): the entire card is replaced by
  a `zg-state--error` variant reading "Ticket not found." with a
  `Back to My Tickets` action — identical wording whether the ticket
  truly doesn't exist or belongs to another Requester, per BR-12; no
  ticket data of any kind is rendered first and then hidden (no data
  flash, per UI-DETAIL-02).
- **Add-attachment busy/success/error** (BR-33): the "+ Add Attachment"
  drop zone shows `zg-attachment-row--uploading` during upload; on
  success the row becomes `zg-attachment-row--active` in place; on
  failure it becomes `zg-attachment-row--upload-error` with a Retry
  action, and no other row on the ticket is affected.
- **Remove validation** (BR-31/AC-13): submitting the confirm modal with
  an empty or too-short/too-long reason keeps the modal open and shows
  the field-level message; the row is not altered until a valid reason is
  accepted.
- **Removed attachment** (BR-30): row shows removal date + reason,
  `--zg-disabled-text` styling, and renders no Download control at all
  (not a disabled one).

## 8. Responsive Breakpoint Summary

| Viewport | Range | Behavior |
|---|---|---|
| Desktop | ≥ 992px | Multi-column layouts as specified per screen; page content centered with a sensible max-width (960–1200px depending on screen); full nav bar visible. |
| Tablet | 768–991px | Two-column layout where practical; Summary/Description always full width; My Tickets table drops the Category column; nav bar unchanged. |
| Mobile | < 768px | All fields/cards stack to a single column; hamburger nav; touch targets ≥44px; My Tickets uses cards, not a table; filters collapse into a bottom sheet; no horizontal page scrolling anywhere. |

All sizes, non-negotiable per handout §8.7: no clipped labels, no
overlapping validation messages, no hidden buttons, no unreadable
(truncated-without-a-tooltip) attachment names.

## 9. Accessibility Rules

- Every interactive control (button, link, select, input, custom
  dropdown) has a visible focus indicator using a 2px `--zg-secondary`
  outline with a minimum 2px offset — never `outline: none` without a
  replacement. **Exception:** controls sitting on the `--zg-primary` header
  (nav items, Change Requester, the mobile hamburger) use a 2px white
  outline at the same offset instead, because `--zg-secondary` is a green
  on a green background and would not be visible there. The rule being
  served is visibility, not the specific token.
- Every icon-only control has both a visible `title` tooltip and an
  `aria-label`; text-carrying buttons do not additionally require
  `aria-label` if their visible text is descriptive (per BR-39).
- Color is never the only signal: badges pair color with text, error
  fields pair color with an icon + message, disabled controls pair
  styling with the actual `disabled` attribute.
- Form fields associate their `<label>` with their control via `for`/`id`
  (or wrapping), so screen readers announce the label on focus.
- Validation messages use `role="alert"` so they are announced when they
  appear without requiring the user to already have focus on them.
- Modals (e.g. the Remove Attachment confirmation) trap focus while open
  and return focus to the triggering control on close.

## 10. Visual Inspection Checklist and Screenshot Paths

Manual checklist to complete at each of the three viewports for Create
Ticket, My Tickets, and Ticket Detail (mirrors `tests.md` §5):

- [ ] Zen Green color tokens applied correctly (header, badges, fields)
- [ ] Editable vs. read-only fields are visually distinct (gray-green vs.
      white, not merely a border-weight difference)
- [ ] Validation messages appear directly below their field, not only in
      a top-of-form summary
- [ ] Button hierarchy (primary/secondary/tertiary/destructive/disabled/
      busy) is visually distinguishable at a glance
- [ ] Keyboard focus is visible on every interactive control
- [ ] Every icon-only control has a visible tooltip on hover/focus
- [ ] No clipped labels, overlapping elements, or unintended horizontal
      scroll at any of the three viewports
- [ ] My Tickets: desktop table vs. mobile card layout, both fully
      readable, no truncated column headers without a tooltip
- [ ] Badges show text plus color, never color alone
- [ ] Removed attachments show no Download control at all
- [ ] Empty state and no-results state are visually distinct from each
      other on My Tickets

Screenshots are saved to:
`artifacts/lab-02/screenshots/{create-ticket,my-tickets,ticket-detail}/{desktop,tablet,mobile}.png`

— matching the paths already declared in `tests.md` §5 (VIS-01/02/03),
so the same files serve both the automated visual test suite and this
manual checklist.
