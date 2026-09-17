# Lab 3 UI Specification — Zen Green, Roles and Operations

Sprint 3 screens, written against the design language established in
`docs/lab-02/ui-spec.md`. That document remains in force in full: the colour,
typography and spacing tokens, the field/button/badge/state components, the
validation-placement rules, the breakpoints and the accessibility rules are
**not** restated here and **not** changed. This file records only what Lab 3
adds or alters, so that one screen never has two specifications.

Where a Lab 2 rule is referenced it is written as *Lab 2 §x* or *Lab 2 BR-xx*.

## 1. What Carries Over Unchanged

- All `--zg-*` tokens in Lab 2 §1. **No new colour token is introduced.** Every
  new badge and panel below is built from tokens that already exist, because a
  second palette is exactly how a sprint turns one application into two.
- `zg-field` and its five states, including the read-only treatment
  (`--zg-readonly-bg`) that keeps editable and read-only fields distinguishable
  (Lab 2 §2.1).
- `zg-btn` and its six variants, including the busy state (Lab 2 §2.2).
- `zg-state` loading / empty / no-results / error blocks (Lab 2 §2.4) — Lab 3
  adds two more, `zg-state--forbidden` (§2.4) and `zg-state--not-found` (§2.5),
  bringing the set to six.
- `zg-attachment-row` in all six of its states (Lab 2 §2.5).
- The 40px single-line control height, the label-above-control layout, the
  required-field asterisk plus message rule, and `role="alert"` validation
  messages sitting directly below their control.
- Breakpoints: desktop ≥ 992px, tablet 768–991px, mobile < 768px.

## 2. New and Extended Shared Components

### 2.1 Status badge (`zg-badge--status-*`)

Lab 2 defined one status badge because there was one status. Lab 3 has eight
(BR-30), and they must stay readable side by side in a dense queue. Every badge
still renders **text plus colour, never colour alone**, and every fill below is
an existing token.

| Status | Class | Fill | Text | Extra signal |
|---|---|---|---|---|
| New | `zg-badge--status-new` | `--zg-pale` | `--zg-secondary` | — |
| Open | `zg-badge--status-open` | `--zg-pale` | `--zg-primary` | 1px `--zg-primary` border |
| In Progress | `zg-badge--status-in-progress` | `--zg-primary` | `#FFFFFF` | the only filled-green badge; it is the state a queue is scanned for |
| Waiting for Requester | `zg-badge--status-waiting` | `--zg-warning-bg` | `--zg-warning` | — |
| Resolved | `zg-badge--status-resolved` | `--zg-pale` | `--zg-success` | ✓ glyph before the label |
| Closed | `zg-badge--status-closed` | `--zg-readonly-bg` | `--zg-text-muted` | — |
| Reopened | `zg-badge--status-reopened` | `--zg-warning-bg` | `--zg-warning` | 1px `--zg-warning` border + ↻ glyph |
| Cancelled | `zg-badge--status-cancelled` | `--zg-disabled-bg` | `--zg-disabled-text` | label rendered in strikethrough |

Waiting and Reopened share the amber family deliberately: both mean "this
ticket is not moving under IT Staff power right now". They are separated by the
border, the glyph and their labels, so the pair is distinguishable without
relying on the shared hue.

### 2.2 IT Priority badge

Reuses Lab 2 §2.3 exactly: `LOW` / `MEDIUM` / `HIGH` with the same three fills.
The Lab 2 `zg-badge--unset` "Not set" variant survives only for migrated Lab 2
Tickets whose backfill has not run; a Ticket created in Lab 3 always has an IT
Priority (BR-29).

Requested Priority and IT Priority use the same three fills, which makes a
disagreement between them legible at a glance — that is the point of having
both — so wherever the two appear together they are always labelled, never two
bare badges side by side.

### 2.3 Role badge (`zg-badge--role`)

| Value | Label | Visual |
|---|---|---|
| `REQUESTER` | Requester | `--zg-surface` fill, 1px `--zg-border`, `--zg-text-muted` text |
| `IT_STAFF` | IT Staff | same |
| `ADMINISTRATOR` | Administrator | same |

Deliberately the quietest badge in the system: a role is an attribute of a
person, not a state to be scanned for, and giving it a colour would put it in
competition with the status badge next to it in the user list and the ticket
header. Its outline style is what separates it from every state badge.

### 2.4 Forbidden state (`zg-state--forbidden`)

The fifth `zg-state` block, alongside Lab 2's loading / empty / no-results /
error; §2.5 adds the sixth.

- Content: a lock glyph, the line "You do not have access to this page.", and a
  single `zg-btn--secondary` returning to the role's own landing screen.
- It never explains *what* is behind the refusal and never names another user
  or Ticket (BR-16, BR-20).
- It is rendered when the API answers **403** `FORBIDDEN`. A **404** renders
  the ordinary not-found state instead — the client must not translate a 404
  into "forbidden", because that would undo the server's careful refusal to
  disclose existence.

### 2.5 Not-found state (`zg-state--not-found`)

Split out from Lab 2's generic error block, because Lab 3 has three distinct
reasons a screen can fail to load and they call for different words.

- Content: "This ticket does not exist, or you do not have access to it." plus a
  link back to the list.
- The wording is deliberately ambiguous between the two cases. The server
  already refuses to distinguish them (BR-16); the interface must not undo that
  by phrasing one of them more confidently.

### 2.6 Conflict feedback

A **409** never renders a whole-screen state. It appears as an inline
`--zg-error` message attached to the control that caused it — the status
select, the email field, the Problem Appears Resolved button — with the
control returned to its previous value. The screen keeps everything the user
had, exactly as Lab 2 BR-24 requires of a failed submit.

### 2.7 Thread (`zg-thread`)

Used by Public Comments and Internal Notes.

| Element | Class | Content |
|---|---|---|
| Thread container | `zg-thread` | vertical list, oldest first |
| Entry | `zg-thread-entry` | author name + role badge + relative time (absolute time in `title`), then the body |
| Body | `zg-thread-body` | rendered as plain text with `white-space: pre-wrap`; no markdown, no HTML (BR-24) |
| Composer | `zg-thread-composer` | textarea (starts ~80px, resizable taller only), live character counter, primary submit button |
| Empty | `zg-state--empty` | "No comments yet." / "No internal notes yet." |

The composer counter shows `n / 2000` and turns `--zg-error` past the limit;
the submit button is `zg-btn--disabled` while the trimmed body is empty or over
2000 characters (BR-23). Submitting shows `zg-btn--busy`, and on success the new
entry appears at the bottom of the thread and the textarea clears.

### 2.8 Internal note thread (`zg-thread--internal`)

The one component in this sprint whose visual design is a safety control. A
person must never post privately-intended text into the public thread by
mistake (handout §8.4), so the two threads never look alike:

- 4px `--zg-warning` left border on the whole panel, and a `--zg-warning-bg`
  panel fill — the public thread sits on plain `--zg-surface`.
- A permanent panel header: a lock glyph and the words **"Internal Notes —
  not visible to the Requester"**, in `--zg-warning` text, always present, never
  collapsed away.
- The composer placeholder repeats it: "Internal note — the Requester cannot
  see this."
- The submit button reads **Add Internal Note**, not "Post" or "Send", so the
  button text alone distinguishes the two composers.
- The two panels are never side by side at any breakpoint. Internal Notes
  always sits *below* Public Comments in the same single column, so the two
  composers cannot be adjacent on screen.

The difference is carried by border, fill, header text, placeholder text and
button label — five signals, not one — because colour alone would fail exactly
the users most likely to be harmed by the mistake.

## 3. Application Shell

The Lab 2 shell (Lab 2 §3) keeps its header bar, wordmark, breadcrumb row and
mobile hamburger. What changes:

- **Right side of the header** now shows the authenticated user's name, their
  role badge, and a `Profile ▾` disclosure containing **Change Password** and
  **Log Out**. Lab 2 §3 deliberately rendered the Requester name inline and
  deferred the disclosure with the note *"the disclosure returns in Lab 3, when
  a real account menu has more than two things in it."* It now has exactly
  that, so the disclosure arrives as planned. The name and role badge stay
  visible outside the disclosure; only the two actions live inside it.
- **Change Requester is gone** — the control, the route, and the
  `sessionStorage` state behind it (AC-25).
- **Navigation is role-specific** (FR-09, AC-07). No destination the role may
  not use is rendered at all — not disabled, not greyed:

  | Role | Nav items | Landing route after login |
  |---|---|---|
  | Requester | My Tickets, Create Ticket | `/my-tickets` |
  | IT Staff | Ticket Queue | `/staff/tickets` |
  | Administrator | User Management, Ticket Queue | `/admin/users` |

  The Administrator carries Ticket Queue because the authorization matrix
  grants Administrators the Ticket operations the handout names
  (`specification.md` §5). It is listed second, and User Management is the
  landing route, so account management reads as the Administrator's job and the
  queue as something they enter deliberately.
- **Hiding is not the control.** Every one of these routes is also refused by
  the server (FR-08); the navigation simply avoids offering a door that will
  not open.
- **Mobile (<768px)**: the hamburger panel carries the role's nav items, then a
  divider, then the user's name with role badge, Change Password, and Log Out
  as full-width rows ≥44px.
- **Unauthenticated**: the shell does not render at all. Login is a full-page
  screen with only the wordmark above it, so there is no header offering
  navigation to someone who has none.
- **A session that ends while in use** — the account deactivated, a new initial
  password set by an Administrator, or the session expired: the next request
  the server answers with 401 `UNAUTHENTICATED` drops the signed-in user, and
  Login replaces whatever screen was open (AC-24). No screen shows its own
  failure state for it, because retrying could never succeed. A refused login
  (`INVALID_CREDENTIALS`) and an unreachable server (BR-13) are not this.
- **Signed in but holding an initial password**: the shell *does* render, with
  no navigation items — see §5. The distinction matters: this person is
  authenticated, and Log Out is the one action `specification.md` BR-02 and
  `api-spec.md` §4 deliberately leave them. A full-page screen would strand
  somebody who cannot produce the initial password they were sent.

## 4. Login Screen

Route `/login`. FR-01, AC-01, AC-05.

### 4.1 Layout

A single centered `zg-card`, max-width 420px, vertically centered on
`--zg-bg`, at every breakpoint — a login form has nothing to reflow, so it has
one layout instead of three.

1. Wordmark + clock glyph above the card.
2. Title "Sign in to TokTickIT" (`--zg-text-xl`) and subtitle "Use the account
   your administrator created for you."
3. `Email *` — `type="email"`, `autocomplete="username"`, autofocus.
4. `Password *` — `type="password"`, `autocomplete="current-password"`, with a
   show/hide toggle (icon button carrying both `title` and `aria-label`, per
   Lab 2 §9).
5. `Sign In` — full-width `zg-btn--primary`.

There is no "Remember me" (sessions are fixed at 8 hours, BR-11), no "Forgot
password" link (password-reset email is excluded by the handout), and no
"Create an account" link (self-registration is excluded). Rendering a control
the product does not have would be worse than omitting it.

### 4.2 States

| State | Rendering |
|---|---|
| Default | Both fields editable, Sign In enabled |
| Validation | Empty email or password produces a message below that field on submit (Lab 2 §2.1); the request is not sent |
| Busy | `zg-btn--busy` with `aria-busy`, both fields `disabled` for the duration |
| Failure (401) | One `--zg-error-bg` callout above the fields: **"Email or password is incorrect."** Both values are kept, the password is not cleared, focus returns to the password field |
| Failure (network / 500) | The same callout with the Lab 2 safe-failure wording; the values are kept and Sign In becomes usable again |

The 401 callout is the same for a wrong password, an unknown address and a
deactivated account (BR-06, AC-05). The interface must not soften this with a
different tone or an extra hint for any of the three, since that would restore
exactly the distinction the server removed.

## 5. Change Password Screen

Route `/change-password`. FR-05, FR-06, BR-02, AC-02.

Reached two ways, with the same layout and the same endpoint:

- **Mandatory** — the account has `mustChangePassword: true`. The shell renders
  without navigation items and without a way to reach any other route; every
  in-app link is absent, and a typed URL redirects straight back here. The
  server enforces the same thing with 403 `PASSWORD_CHANGE_REQUIRED`, so the
  redirect is feedback, not the control. A `--zg-pale` banner explains: "Your
  account is using an initial password. Choose a new one to continue."
- **Voluntary** — reached from `Profile ▾ → Change Password`. Full navigation
  stays, no banner, and a Cancel button returns to the previous screen.

Fields: `Current Password *`, `New Password *`, `Confirm New Password *`, each
`type="password"` with a show/hide toggle. Helper text under New Password reads
"8–72 characters" (BR-08) and is present before any error, so the rule is
readable rather than discoverable only by failing.

| State | Rendering |
|---|---|
| Validation | Per-field messages: too short/long, identical to current password, confirmation mismatch (BR-09) |
| Wrong current password | 400 with `field: "currentPassword"` renders under that field, not as a screen-level failure |
| Busy | `zg-btn--busy`; all three fields disabled |
| Success | `zg-state--success` toast, then automatic navigation to the role's landing route (AC-02). In the mandatory case this is the first moment the application is reachable |
| Failure | Lab 2 safe-failure callout; every typed value is kept |

## 6. Requester Screens After Migration

My Tickets, Create Ticket and Ticket Detail keep the layouts in Lab 2 §5–§7
unchanged at all three breakpoints (BR-44, AC-08). The differences:

- The Development Requester Selection screen and its route are **deleted**.
- Ticket Detail's read-only `Requester` field now shows the Ticket's own
  Requester, from the `requester` of the Ticket object (`api-spec.md` §5)
  rather than from a selector. For a Requester that is their own name; for staff
  opening the same screen it is the person who raised the Ticket, not
  themselves.
- Ticket Detail gains, below the Attachments panel and in this order:
  1. **Public Comments** (`zg-thread`, §2.7) — readable and writable by the
     Requester on their own Ticket (FR-19, AC-14).
  2. **Problem Appears Resolved** — a `zg-btn--secondary` in its own bordered
     row with the caption "Tell IT Staff the problem looks fixed. They decide
     when the ticket is resolved." (BR-05, BR-34, AC-16).
- Internal Notes are **absent from the Requester's Ticket Detail** — no panel,
  no heading, no empty state, nothing that would reveal the feature exists
  (BR-20, AC-04).

### Problem Appears Resolved states

| State | Rendering |
|---|---|
| Available | Enabled button |
| Busy | `zg-btn--busy` |
| Already signalled | Button replaced by a `--zg-pale` line: "You reported this looked resolved on 10 Sep 2026, 15:04." |
| Not applicable | Button absent when the Ticket is Resolved, Closed or Cancelled (BR-34) — the state has passed, so an inert control would only invite a click |
| Conflict (409) | Inline `--zg-error` message under the row; the button returns to its previous state (§2.6) |

## 7. IT Staff Ticket Queue

Route `/staff/tickets`. FR-13, AC-09.

### 7.1 Layout (desktop ≥ 992px)

Full-width `zg-card`, following the structure of Lab 2 My Tickets so the two
lists are recognisably the same component family.

1. Header row: "Ticket Queue" title + subtitle "Every ticket, across all
   requesters."; `Clear Filters` (`zg-btn--secondary`) on the right. There is no
   Create Ticket button — neither IT Staff nor Administrator raise tickets in
   Lab 3.
2. Controls row: search input ("Search by ticket number or summary…",
   debounced), then five filter selects — Category, Requested Priority, IT
   Priority, Current Status, Owner. Owner offers "All owners", "Unassigned",
   and each active IT Staff or Administrator by name, from
   `GET /api/staff/assignees` (FR-16).
3. Table (`zg-table`), columns: **Ticket No.** (sortable), **Summary**,
   **Requester**, **Category**, **Requested Priority** (badge), **IT Priority**
   (badge, sortable), **Current Status** (badge), **Owner**, **Last Updated**
   (sortable). Sort indicators and behaviour are Lab 2 §6.1's, including the
   rule that a newly chosen column starts descending and that changing the sort
   returns to page 1.
4. Footer row: "Showing X to Y of Z tickets", pagination control, and a page
   size select (10/25/50, default 25).

**Why these nine columns** (handout §8.3 requires the choice to be justified
and warns against a mega-grid): a queue exists so that a staff member can
answer "what should I pick up, and is it mine?". Ticket No. and Summary
identify the work. Requester is new relative to Lab 2's list and is essential
here precisely because this list is not single-requester. Owner answers "is it
mine, someone else's, or free" — the single most common reason to scan this
screen. The four filterable badge columns are shown so a person can see why a
row survived a filter instead of guessing. Last Updated is the default sort and
a column that is sorted but not visible would be a control with no feedback.

**What is deliberately excluded**: Created Date (Last Updated is the field a
queue is worked by, and two date columns is where a grid starts to become
unreadable — Created Date remains on Ticket Detail and remains sortable via the
API); Related System (the least used field for recognising work, and the first
Lab 2 dropped at tablet); Description (up to 2000 characters); attachment count
and comment count (they would each cost a column to answer a question Ticket
Detail answers better).

### 7.2 Layout (tablet 768–991px)

Search takes a full row; the five filters sit in a 2×3 grid with the last cell
empty. The table drops **Category** and **Requested Priority** from view — both
remain available as filters — leaving seven columns. This is the same technique
and the same first casualty as Lab 2 §6.2, extended by one column because Lab 3
starts with one more. Owner and Current Status are never dropped: they are the
two columns the screen exists for.

### 7.3 Layout (mobile < 768px)

The table is replaced by `zg-queue-card` items — never a horizontally scrolling
table. Each card, top to bottom:

- Ticket No. and Last Updated on one small muted line.
- Summary in bold, wrapping normally.
- A badge row: Current Status, IT Priority, Requested Priority.
- A footer line: Requester name, then Owner name or the text **Unassigned** in
  `--zg-warning` — an unclaimed ticket is the one thing a staff member scanning
  a phone is looking for.

The whole card is a link to Ticket Detail, matching the correction Lab 2 §6.3
records: the same action must not become a button merely because the viewport
narrowed. Search is a full-width input; the five filters collapse into a
`zg-filter-sheet` bottom sheet with Apply and Clear Filters. Pagination is
Previous/Next plus "Page X of Y".

### 7.4 States

| State | Rendering |
|---|---|
| Loading | `zg-state--loading` skeleton rows; the controls render immediately so a filter can be typed while the first page loads |
| Empty | `zg-state--empty` — "No tickets have been created yet." No call to action: staff cannot create one |
| No-results | `zg-state--no-results` — "No tickets match your filters." plus Clear Filters, visually distinct from Empty (Lab 2 §2.4) |
| Forbidden | `zg-state--forbidden` (§2.4) for a Requester who reaches the route |
| Failure | Lab 2 safe-failure block with Retry |

An invalid query parameter is never an error state: the queue renders with that
parameter's default and the corresponding control shows the default it fell
back to, so the screen and the URL agree (BR-40, AC-28).

## 8. IT Staff Ticket Detail

Route `/tickets/:id`, the same route the Requester uses. FR-14. The screen is
the Lab 2 Ticket Detail (Lab 2 §7) with an Operations panel inserted and the
Internal Notes thread appended; the identifying fields, the Attachments panel
and the layout rules are unchanged.

### 8.1 Panel order (all breakpoints, single column below 992px)

1. **Ticket header** — Ticket Number, Summary, Current Status badge, and the
   Requester's name with role badge.
2. **Ticket information** — Category, Related System, Requested Priority,
   Description, Created Date, Last Updated. All read-only, in the
   `zg-field--readonly` treatment, for every role. Nothing a Requester typed is
   editable by staff: correcting a Requester's words in place would destroy the
   record of what was reported.
3. **Operations** (IT Staff and Administrator only; absent for the Requester).
4. **Attachments** — Lab 2's panel. For staff the rows render in their normal
   state but with **no Add Attachment control and no Remove control**, since
   those actions belong to the Requester (§6 of `api-spec.md`); Download is
   present (FR-21, AC-26). Soft-removed rows keep Lab 2's rule: no Download
   control at all.
5. **Public Comments** — `zg-thread` (§2.7).
6. **Internal Notes** — `zg-thread--internal` (§2.8), IT Staff and
   Administrator only.

### 8.2 Operations panel

Three controls in one bordered `--zg-surface` panel, each saving independently
so that one failure never discards the other two:

| Control | Behaviour |
|---|---|
| **Ticket Owner** | A select listing active IT Staff and Administrator users plus "Unassigned", with a `Claim` `zg-btn--secondary` beside it that sets the owner to the signed-in user in one click. Saving is immediate on change (FR-15, AC-10, AC-11). When the current owner has since been deactivated (BR-26) the select shows that person as a disabled option marked "(inactive)" so the field still reflects the Ticket truthfully, and choosing anyone else replaces them |
| **IT Priority** | A select of Low/Medium/High, saving on change. The Requested Priority is displayed immediately above it, read-only, so the two are compared rather than confused (BR-29, AC-12) |
| **Current Status** | A select listing **only the transitions permitted from the current status** by BR-31 — an impossible move is not offered. The server still rejects it (409, AC-13), and the two together are the point: the select is convenience, the server is the rule |

Each control shows a `zg-btn--busy`-equivalent inline spinner while saving, a
brief `--zg-success` check on success, and on failure an inline `--zg-error`
message with the control reverted (§2.6).

**Closed and Cancelled** open a `zg-confirm-dialog` before saving (BR-33) — the
same `zg-dialog` shell used by the Administrator dialogs (§9.3), with a
modifier that narrows it and gives it a destructive confirm button —
carrying the Lab 2 remove-modal behaviour: focus trapped, focus returned to the
select on close, and the confirming button `zg-btn--destructive`. The dialog
names the consequence — "Cancelled tickets cannot be reopened." / "A closed
ticket can only be reopened." — rather than asking "Are you sure?".

### 8.3 Role differences on one screen

| Element | Requester (owner) | IT Staff / Administrator |
|---|---|---|
| Ticket information | read-only | read-only |
| Operations panel | absent | present |
| Attachments: Add / Remove | present | absent |
| Attachments: Download | present | present |
| Public Comments | read + write | read + write |
| Internal Notes | absent entirely | present |
| Problem Appears Resolved | present | absent; instead the header shows "Requester reported this resolved on …" when set |

## 9. Administrator User Management

Route `/admin/users`. FR-22, AC-21, AC-27.

### 9.1 Layout (desktop ≥ 992px)

1. Header row: "User Management" title + subtitle "Accounts, roles and access.";
   `+ Create User` (`zg-btn--primary`) on the right.
2. Controls row: search input ("Search by name or email…", debounced) and one
   Role select ("All roles" / Requester / IT Staff / Administrator). Two
   controls only — the handout excludes multiple simultaneous filters.
3. Table (`zg-table`), columns: **Name**, **Email**, **Role** (role badge),
   **Status**, **Edit**. Exactly the five the handout names, in that order.
   Status renders as the text **Active** in `--zg-text` or **Inactive** in
   `--zg-text-muted` with a dot glyph — not a badge, so it never reads as a
   ticket status. There are no sortable headers and no pagination: both are
   excluded by the handout, and rendering a control that does nothing would be
   worse than omitting it. The list is ordered by name (BR-41).

### 9.2 Layout (tablet and mobile)

Tablet keeps all five columns; the row is short enough to survive. Below 768px
the table becomes `zg-user-card` items: Name in bold with the role badge on the
same line, email on a muted second line, Status on a third, and a full-width
`Edit` `zg-btn--secondary`. Search and the role select stack full-width above
the list.

### 9.3 Create User dialog

`zg-dialog`, focus-trapped, returning focus to `+ Create User` on close.

Fields: `Name *`, `Email *`, `Role *` (select, exactly one — BR-18), `Status *`
(radio: Active / Inactive), `Initial Password *` with helper text "8–72
characters. The user must change it at first sign-in." (BR-35, AC-22).

| State | Rendering |
|---|---|
| Validation | Per-field messages for name length, email format, missing role, missing status, password length |
| Duplicate email (409) | Inline message on the Email field: "An account with this email address already exists." The dialog stays open with every value kept (AC-17) |
| Busy | `zg-btn--busy`; the dialog cannot be dismissed while saving |
| Success | Dialog closes, `zg-state--success` toast, the list refreshes with the new account visible |
| Failure | Lab 2 safe-failure callout inside the dialog; nothing is discarded |

### 9.4 Edit User dialog

Same dialog with Name, Email, Role and Status pre-filled (FR-25, AC-23), plus a
separate bordered **Set New Initial Password** section at the bottom with its
own field and its own `Set Password` button — a different endpoint, so a
different button, and a password is never changed as a side effect of renaming
someone.

Guard rails, all rendered as inline `--zg-error` messages on the offending
control with the value reverted (§2.6):

| Rule | Message |
|---|---|
| Self-deactivation, or self-demotion from Administrator (BR-37, AC-20) | "You cannot remove your own administrator access." |
| Last active Administrator (BR-38, AC-19) | "At least one administrator must stay active." |
| Duplicate email (BR-36) | "An account with this email address already exists." |

The two Administrator safety rules additionally render the Status radio and the
Role select as `zg-field--disabled` when the signed-in Administrator is editing
their own account, with the reason as helper text. The server enforces both
regardless (409), and the disabled control exists only to explain the refusal
before it happens.

Setting a new initial password shows a confirmation line — "This account must
choose a new password at its next sign-in." — and never displays or echoes the
password afterwards (BR-07, AC-18).

## 10. Screen Modes and Feedback Coverage

Handout §8.6 asks which modes each screen has and where each feedback condition
appears. Nothing here invents a formal state per error; the shared blocks in §2
and Lab 2 §2.4 carry all of it.

| Screen | Modes | Processing | Validation | Success | Empty / no-results | Forbidden | Not-found | Conflict | Safe failure |
|---|---|---|---|---|---|---|---|---|---|
| Login | form | busy button | per field | navigate away | — | — | — | — | callout |
| Change Password | form | busy button | per field | toast + navigate | — | — | — | — | callout |
| My Tickets | list | skeleton | — | — | both (Lab 2) | state | — | — | block |
| Create Ticket | create | busy button | per field | success panel (Lab 2) | — | state | — | — | callout |
| Ticket Detail (Requester) | view | skeleton | composer counter | inline (§2.7, §6) | thread empty | state | state | inline (§2.6) | block |
| Ticket Queue | list | skeleton | — | — | both | state | — | — | block |
| Ticket Detail (staff) | view + inline edit | per-control spinner | composer counter | inline check | thread empty | state | state | inline (§2.6) | block |
| User Management | list + create + edit | skeleton / busy button | per field | toast | both | state | — | inline in dialog | block + callout |

## 11. Responsive Breakpoint Summary

Extends Lab 2 §8; the ranges are unchanged.

| Viewport | Range | Lab 3 behaviour |
|---|---|---|
| Desktop | ≥ 992px | Ticket Queue is a nine-column table; User Management is a five-column table; Ticket Detail is single-column with the Operations panel full width |
| Tablet | 768–991px | Queue drops Category and Requested Priority from view; User Management keeps all five columns; dialogs become 90% width with internal scrolling |
| Mobile | < 768px | Queue and User Management become cards; Login and Change Password are unchanged (they have one layout); dialogs become full-screen sheets with the action buttons pinned to the bottom; touch targets ≥ 44px |

Non-negotiable at every size, as in Lab 2: no clipped labels, no overlapping
validation messages, no hidden buttons, and no unintended horizontal scrolling
on any screen — including the nine-column queue table, which is why two columns
are dropped at tablet rather than allowed to overflow.

## 12. Accessibility Additions

Lab 2 §9 applies in full. Lab 3 adds:

- Password show/hide toggles are icon buttons with both `title` and
  `aria-label`, and the label changes with the state ("Show password" /
  "Hide password").
- The Login failure callout and every inline 409 message are `role="alert"`, so
  a refusal is announced rather than silently appearing.
- The Internal Notes panel header is a real heading in the document outline, not
  styled text, so a screen-reader user reaches "Internal Notes — not visible to
  the Requester" before reaching its composer.
- Both threads are `<ol>` lists so their entry count and position are announced.
- Each operations control has its own `<label>`; the status select carries
  `aria-describedby` pointing at a line naming the current status, since its
  option list changes with that status.
- `zg-state--forbidden` and `zg-state--not-found` render inside the page's main
  landmark and move focus to their heading, so a refusal is not silent for a
  keyboard user who has just navigated.
- Dialogs (Create User, Edit User, the status confirmation) follow Lab 2's modal
  rule: focus trapped while open, focus returned to the trigger on close.

## 13. Visual Inspection Checklist and Screenshot Paths

Completed at all three viewports for each screen below, mirroring `tests.md` §5.

- [ ] Zen Green tokens only — no colour appears that is not in Lab 2 §1.1
- [ ] Editable vs read-only fields visually distinct on Ticket Detail for both
      roles
- [ ] All eight status badges distinguishable side by side, each showing text
      plus colour
- [ ] Role badge is visually subordinate to status and priority badges
- [ ] Public Comments and Internal Notes are unmistakable at a glance: border,
      fill, header, placeholder and button label all differ
- [ ] Internal Notes panel is completely absent from the Requester's view
- [ ] Validation messages sit directly below their field on Login, Change
      Password and both user dialogs
- [ ] Keyboard focus visible on every new control, including inside dialogs and
      the mobile filter sheet
- [ ] Role-specific navigation shows no destination the role may not use
- [ ] Forbidden and not-found states are distinguishable from each other and
      from the generic failure state
- [ ] No clipped labels, overlap, or horizontal scroll — especially the
      nine-column queue table at 992px and the dropped columns at 768px
- [ ] Unassigned tickets are recognisable at a glance in both the table and the
      mobile card

Screenshots are saved to the four directories the handout §12 names:

```
artifacts/lab-03/screenshots/
├── authentication/      login, change-password (mandatory and voluntary), logout
├── staff-queue/         default, filtered, no-results, empty, forbidden
├── staff-ticket-detail/ staff view, requester view, internal notes, confirm dialog
└── user-management/     list, create dialog, edit dialog, guard-rail refusals
```

each as `{desktop,tablet,mobile}[-state].png`, matching the paths declared in
`tests.md` §5 so the same files serve both the automated visual suite and this
manual checklist.
