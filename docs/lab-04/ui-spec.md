# TokTickIT — Lab 4 UI Specification

The screen-by-screen contract for Sprint 4: two dashboards, the Actions Taken
panel on Ticket Detail, the workflow feedback around resolution and stale
writes, and the final polish pass. Lab 2 §1–§9 and Lab 3 §1–§13 apply in full;
this document records only what Lab 4 adds or changes.

Rule references are to `specification.md` in this directory unless written as
*Lab 2 BR-xx* / *Lab 3 BR-xx*.

---

## 1. What Carries Over Unchanged

- Every `--zg-*` token from Lab 2 §1. **No new colour token is introduced**, as
  in Lab 3: metric cards, the Actions table and the conflict feedback are all
  built from tokens that already exist.
- `zg-field` and its five states, `zg-btn` and its six variants, the six
  `zg-state` blocks (loading, empty, no-results, error, forbidden, not-found),
  `zg-table`, the Lab 2 card, the Lab 3 badges, and `zg-confirm-dialog`.
- The 40px control height, label-above-control layout, required-field asterisk,
  and `role="alert"` validation messages directly below their control.
- Breakpoints: desktop ≥ 992px, tablet 768–991px, mobile < 768px.
- Lab 3 §3's rule that navigation never offers a destination the role may not
  use, and that hiding a control is never the authorization.

## 2. New Shared Components

### 2.1 Metric card (`zg-metric`)

The one new component in Lab 4, and deliberately small.

| Part | Rendering |
|---|---|
| Container | Lab 2 card (`--zg-surface`, 1px `--zg-border`, 8px radius, 16px padding), rendered as a `<a>` or `<button>` so it is focusable and announced as actionable |
| Label | 13px `--zg-muted`, sentence case, above the value |
| Value | 28px semibold `--zg-ink`; a zero is rendered as `0`, never hidden or replaced by a dash |
| Sub-line | 12px `--zg-muted`, one short sentence, used for the empty behaviour in BR-21 and BR-22 (for example "The queue is clear.") |
| Hover / focus | the Lab 2 card hover elevation, plus the standard 2px focus ring; the whole card is one target, not a card with a link inside it |

A card whose number is zero stays visible and stays actionable: the list behind
it is the evidence that it really is zero (BR-21). Colour is never the only
signal — a card carrying a priority or status meaning renders the Lab 3 badge
beside its label rather than tinting the card.

### 2.2 Action status badge (`zg-badge--action-*`)

Reuses the Lab 3 badge shape. Four values, each with its own text, so colour is
never the only cue:

| Status | Class | Fill / text | Glyph |
|---|---|---|---|
| Planned | `zg-badge--action-planned` | `--zg-pale` / `--zg-ink` | — |
| In Progress | `zg-badge--action-progress` | `--zg-accent` / white | — |
| Completed | `zg-badge--action-complete` | `--zg-pale` / `--zg-success` | ✓ before the label |
| Cancelled | `zg-badge--action-cancelled` | `--zg-surface` / `--zg-muted` | strikethrough label |

### 2.3 Stale-write feedback

A 409 `STALE_UPDATE` (BR-26) is not a validation message and not the generic
failure block. It renders as the Lab 3 conflict feedback (§2.6) immediately
above the control that was being saved, carrying the server's own sentence —
*"This ticket changed after you opened it. Reload to see the current version."*
for a Ticket and the same sentence naming the action for an Action, never a
message the screen invented — and a **Reload** button
that re-fetches the record and leaves the user's typed text in place where the
field still exists (BR-27, FR-24). The record is never silently resubmitted.
Reloading clears the block it was shown for: the record the warning described is
the record that just came back, so leaving it up would warn about nothing.

## 3. Application Shell Changes

- **Dashboard becomes the landing destination for every role** (FR-25):

  | Role | Nav items (in order) | Landing route after login |
  |---|---|---|
  | Requester | Dashboard, My Tickets, Create Ticket | `/dashboard` |
  | IT Staff | Dashboard, Ticket Queue | `/dashboard` |
  | Administrator | Dashboard, User Management, Ticket Queue | `/dashboard` |

  One route, two screens: `/dashboard` renders the Requester dashboard for a
  Requester and the staff dashboard for IT Staff and Administrator. A single
  route keeps the navigation identical for everyone and means a shared link
  always lands somewhere the recipient is allowed to be.
- The Administrator keeps User Management ahead of Ticket Queue, as Lab 3 §3
  arranged it; only Dashboard is inserted in front.
- Active-page marking, the mobile hamburger panel, the profile disclosure and
  the session-ended behaviour are unchanged from Lab 3 §3.

## 4. IT Staff Dashboard

Route `/dashboard` for IT Staff and Administrator. FR-12–FR-16, BR-21.

### 4.1 Layout (desktop ≥ 992px)

1. **Page header** — "Dashboard", with the sub-line "Your work, and the
   queue right now."
2. **Metric grid** — six `zg-metric` cards in two rows of three, in this order:
   Unassigned · Assigned to me · My open actions · Waiting for Requester ·
   High IT priority · Resolved in the last 7 days.
3. **By status strip** — a single card containing the eight status counts as a
   horizontal list of badge + count pairs, each one a link to the queue
   filtered to that status. Zero rows are rendered, never dropped, so the strip
   is the same shape every day.
4. **Administrator counts** — for an Administrator only, two further
   `zg-metric` cards, Active users and Inactive users, in a row of their own
   under a divider labelled "Accounts". They open User Management itself: that
   screen carries search and role, and no filter on account status, so a link
   promising one would not be kept. The handout makes these two counts optional
   in the first place (§4.6), and adding a filter to a Lab 3 screen to serve
   them would be a larger change than the numbers are worth (corrected in Issue
   #49, which is where the gap was found). IT Staff never render this block
   (AC-18).
5. **Two lists side by side** — *Recently updated* (10 rows) and *Needs
   attention* (10 rows, High IT priority, oldest update first). Each row is
   ticket number, summary, status badge, IT priority badge, owner (or
   "Unassigned"), and relative time; the whole row opens the Ticket.

### 4.2 Tablet (768–991px)

Metric grid becomes two columns; the two lists stack, *Needs attention* first,
because at this width a reader sees one list without scrolling and it should be
the urgent one.

### 4.3 Mobile (< 768px)

Metric grid becomes one column; the by-status strip wraps to two columns of
badge + count. Touch targets stay ≥ 44px.

A list row is already the Lab 3 queue card at every width — ticket number and
badges on the first line, summary on the second, owner and time on the third —
so nothing transforms here. That is the same choice §6.2 made for the Actions
panel in Issue #47: two renderings of the same row are two things to keep
honest, and the row a desktop layout would drop first is the summary.

### 4.4 States

| State | Rendering |
|---|---|
| Loading | `zg-state--loading` skeleton cards in the grid's shape, then skeleton rows for the lists; the page header renders immediately so the screen never looks empty |
| Partially empty | a metric of 0 shows its sub-line; a list with no rows shows `zg-state--empty` inside the list card, not a page-level empty state |
| Forbidden | `zg-state--forbidden`, shown when the server answers 403 to the dashboard endpoint (AC-22). One route renders the screen the role may see (§3), so no address reaches the other variant; the state is the screen trusting the server over itself, and it is what a session whose role changed under it would meet |
| Safe failure | the whole dashboard fails as one unit: `zg-state--error` with **Retry**, because six half-loaded cards would be worse than one honest failure (AC-23) |

### 4.5 Drill-down

Every card and every status pair links to `/staff/tickets` with the query that
produced the number, so the queue's total and the card agree (AC-17):

| Card | Link |
|---|---|
| Unassigned | `?owner=unassigned&status=open` |
| Assigned to me | `?owner=me&status=open` |
| My open actions | `?actionsAssignedTo=me&actionStatus=open` |
| Waiting for Requester | `?status=WAITING_FOR_REQUESTER` |
| High IT priority | `?itPriority=HIGH&status=open` |
| Resolved in the last 7 days | `?status=RESOLVED` |
| A status pair | `?status=<that status>` |

`status=open` is the queue's existing shorthand for "not Resolved, Closed or
Cancelled". The two action parameters are new and documented in the queue's
lenient-parameter rule: an unknown value falls back to the default rather than
failing (Lab 3 BR-40).

## 5. Requester Dashboard

Route `/dashboard` for a Requester. FR-17–FR-20, BR-22.

### 5.1 Layout (desktop)

1. **Page header** — "Dashboard", sub-line "Your tickets at a glance."
2. **Three metric cards** — My open tickets · Waiting for me · Resolved,
   awaiting my confirmation.
3. **Attention required panel** — the Tickets behind the second and third
   cards, in one list, each row carrying why it is there ("Waiting for your
   reply" or "Resolved — please confirm"). Empty state: "Nothing needs you
   right now."
4. **Two short lists** — *Recently updated* (5) and *Recently resolved* (5).

Tablet keeps the three cards in one row and stacks the panels; mobile stacks
everything into one column with the Lab 2 My Tickets card shape for rows.

### 5.2 States

Loading, empty, forbidden and safe failure follow §4.4. A Requester with no
Tickets at all sees three zeros, the "Nothing needs you right now." line, and
an invitation to **Create Ticket** under the metric grid — the one call to
action on either dashboard, because for a Requester with nothing open, raising
a ticket is the only useful next step (AC-21).

### 5.3 Drill-down

| Card | Link |
|---|---|
| My open tickets | `/my-tickets?status=open` |
| Waiting for me | `/my-tickets?status=WAITING_FOR_REQUESTER` |
| Resolved, awaiting my confirmation | `/my-tickets?status=RESOLVED` |

## 6. Actions Taken on Ticket Detail

FR-01–FR-07, BR-01–BR-13. The panel sits **below Internal Notes** for IT Staff
and Administrator, and **below Public Comments** for a Requester (who has no
Internal Notes panel at all, Lab 3 §8.3). Panel order is otherwise unchanged
from Lab 3 §8.1.

### 6.1 Panel header

`Actions Taken` as a real heading, with the count in parentheses and, for
staff, a primary **Add Action** button on the right. For a Requester the button
is absent — not disabled (FR-06).

### 6.2 The list

One layout at every width, rather than a table that becomes cards: an ordered
list of entries, each carrying

| Part | Content |
|---|---|
| Status and when | `zg-badge--action-*` and `actionAt` as date and 24-hour time, on one line |
| What was done | the description, wrapped, preserving the line breaks the author typed |
| Result | the result, or an em dash while the Action is still open |
| Who | performed-by name, and "for <assignee>" when the assignee differs (BR-02) |
| Follow-up | "Yes — <note>" or "No" |
| Files | the attachment notes, when present (BR-08) |
| Controls | Edit, Complete and Cancel action for staff on an open Action |

The four label/value pairs sit in a grid that fits as many columns as the width
allows and falls to one on a phone, so the same markup reads as a row of
columns on a desktop and as a stacked card below 768px. The handout's §8.3 asks
for "an appropriate list or table", and a list is what keeps this honest: a
six-column table would need a second mobile rendering to maintain, and the
column that would be dropped first — Result — is the one the log exists for.

Entries are ordered oldest action time first with the id as the tie-break
(BR-11), so the panel reads as a work log from the top down. Controls become
full-width buttons of at least 44px below 768px.

### 6.3 Create and edit

**Add Action** opens an inline form at the top of the panel (not a modal —
the author needs the rest of the Ticket visible while writing). Fields in
order:

1. **When** — date-time field, defaults to now, must not be in the future or
   before the Ticket's creation time (BR-09).
2. **What was done** — textarea, 5–2000 characters, live counter. It uses Lab 2
   §2.1's textarea treatment: 120px tall to start, resizable taller only, never
   the 40px single-line control height.
3. **Result** — textarea, 0–2000, with the hint "Required to complete the
   action." (BR-06).
4. **Assigned to** — select of active IT Staff and Administrators, defaulting
   to the signed-in user; inactive accounts are not listed, and a stale
   selection is refused by the server with the field named (BR-04, AC-04).
5. **Status** — Planned · In Progress · Completed.
6. **Follow-up required** — a two-option radio group on its own row beneath the
   explanation, No by default, each option at least 44px tall. Choosing
   **Yes** reveals the **Follow-up note** field immediately below it, marked
   required from that moment; choosing No hides it and clears it (BR-07).
7. **Attachment notes** — single-line text, 0–2000, hint "Which file should a
   colleague look for?"
8. Actions: **Save action** (primary, busy state while saving, disabled for the
   duration so a double click cannot create two rows, BR-31) and **Cancel**.

Editing an open Action opens the same form in place of its row, pre-filled,
with the heading "Edit action". Editing is unavailable on a Completed or
Cancelled Action: its controls are not rendered, and the server refuses the
write as a conflict (AC-06).

### 6.4 Complete and cancel

- **Complete** stays pressable. With no result recorded it opens the edit form
  for that Action, focuses the Result field and shows its message, rather than
  sending a request or sitting disabled with the reason hidden in a tooltip —
  a dead control teaches nobody what is missing. The server refuses the same
  write independently (BR-06).
- **Cancel action** opens `zg-confirm-dialog` — "Cancel this action? It stays
  in the log and cannot be reopened." — with a destructive confirm button, as
  Lab 3 does for Closed and Cancelled tickets.
- Both write through `PATCH /api/actions/:id` with the row's version, and both
  re-render the row with its new badge and version on success.

### 6.5 Role differences on one screen

| Element | Requester | IT Staff / Administrator |
|---|---|---|
| Actions panel | present, read-only | present, writable |
| Add Action button | absent | present |
| Row controls (edit, complete, cancel) | absent | present on open Actions |
| Assignee column | shown as plain text | shown, and editable through the form |
| Internal Notes panel | absent (Lab 3) | present |

## 7. Ticket Workflow Feedback

FR-08–FR-11, BR-16–BR-20.

- The status select lists only the transitions BR-16 permits from the current
  status, exactly as Lab 3 did; Closed and Cancelled still confirm first.
- **Resolve with open Actions** — the option remains visible but the attempt is
  refused by the server. The Operations panel renders the conflict feedback
  under the status control: *"2 actions on this ticket are still open. Complete
  or cancel them before resolving it."* with a link that scrolls to the Actions
  panel. The select returns to the current status (AC-09).
  While `openActionCount > 0` the Resolve option is also rendered disabled with
  the same sentence as its `aria-describedby`, so a keyboard user learns the
  reason before choosing — but the server remains the authority (FR-08).
- **Requester resolution signal** — unchanged from Lab 3 §6: the button records
  the fact and is replaced by the line "You reported this looked resolved on
  …". The staff header shows the same fact. Nothing about the status changes
  (BR-20).
- **Stale write** — any refused write renders §2.3 beside the control that was
  being saved.

## 8. Final Polish Pass

Lab 4 is the last sprint, so the shell is audited as a whole (FR-22, FR-26):

- Every screen uses the same six `zg-state` blocks for the same meanings; no
  screen invents a seventh.
- Every destructive or terminal action confirms; every other write is
  immediate with a toast or an inline check.
- Every submit control disables itself for the duration of its request (BR-31).
- No control that does nothing, no placeholder copy, no route that renders an
  empty page, and no leftover from Lab 2's Development Requester mechanism.
- Console is clean in normal use: no React key warnings, no failed requests on
  a healthy server, no unhandled promise rejections.

## 9. State Matrix

Extends Lab 3 §10 with the two new screens.

| Screen | Modes | Processing | Validation | Success | Empty / no-results | Forbidden | Not-found | Conflict | Safe failure |
|---|---|---|---|---|---|---|---|---|---|
| Staff Dashboard | view | skeleton cards | — | — | per card and per list | state | — | — | block + Retry |
| Requester Dashboard | view | skeleton cards | — | — | per card and per list, plus Create Ticket | state | — | — | block + Retry |
| Ticket Detail — Actions (staff) | view + create + edit | busy button, per-row spinner | per field, live counters | row re-renders with new badge | panel empty state | — | — | §2.3 and the resolution conflict | callout inside the panel |
| Ticket Detail — Actions (Requester) | view | skeleton rows | — | — | panel empty state | — | — | — | callout |

## 10. Responsive Summary

| Viewport | Range | Lab 4 behaviour |
|---|---|---|
| Desktop | ≥ 992px | Dashboards: 3-column metric grid, two lists side by side. Actions: entries with their fields in a multi-column grid |
| Tablet | 768–991px | Dashboards: 2-column grid, lists stacked with *Needs attention* first. Actions: unchanged — the form is one column at every width (§6.3 lists the fields in order and asks for no grid) |
| Mobile | < 768px | Dashboards: single column, by-status strip in two columns. Actions: cards, controls full width ≥ 44px |

Non-negotiable at every size, as in Labs 2 and 3: no clipped labels, no
overlapping messages, no hidden buttons, and no unintended horizontal
scrolling — which the Actions list gets for free by never being a table, and
which the dashboards get by reflowing their grid rather than shrinking it.

## 11. Accessibility Additions

Lab 2 §9 and Lab 3 §12 apply in full. Lab 4 adds:

- A metric card is one focusable control with an accessible name that reads
  label then value then destination — "Unassigned, 4 tickets, open the queue
  filtered to unassigned" — so a screen-reader user never hears a bare number.
- The by-status strip is a list (`<ul>`), each pair a link, so its length is
  announced.
- `Actions Taken` is a real heading in the document outline, and the list of
  Actions is an `<ol>`, so position and count are announced as they are for the
  Lab 3 threads.
- The follow-up note field is tied to its radio group with
  `aria-describedby`, and becomes `aria-required="true"` the moment Yes is
  chosen, so the requirement is announced rather than only turning red.
- A disabled Resolve option carries `aria-describedby` pointing at the sentence
  explaining the open Actions, so the reason is available without trial.
- The stale-write feedback is `role="alert"`, and focus moves to its Reload
  button, because the user is about to lose work if they ignore it.
- Action status is text plus badge, never colour alone; Cancelled additionally
  uses a strikethrough so the two muted states cannot be confused.

## 12. Visual and Accessibility Checklist

Completed at all three viewports for every Lab 4 screen; the same list appears
in `tests.md` §5 and is ticked there against the captured screenshots.

**Visual**

- [ ] Zen Green tokens only — no colour that is not in Lab 2 §1.1
- [ ] Metric cards share one shape, one label size and one value size on both dashboards
- [ ] A zero metric renders `0` with its sub-line, never blank and never hidden
- [ ] All four action status badges are distinguishable side by side, text plus colour
- [ ] Editable and read-only fields stay visually distinct inside the Action form
- [ ] Validation messages sit directly below their field, including the revealed follow-up note
- [ ] The Actions panel is unmistakably separate from Public Comments and Internal Notes
- [ ] The Requester's Actions panel shows no write control of any kind
- [ ] Dashboard lists and the Actions table have no clipped text, overlap or horizontal scroll at 1440, 768 and 375
- [ ] Nothing from Lab 2's Requester-selector era remains on any screen

**Accessibility**

- [ ] Every metric card is reachable by keyboard and announces label, value and destination
- [ ] Focus is visible on every new control, including inside the Action form and the cancel dialog
- [ ] `Actions Taken` is a heading and the list is an ordered list
- [ ] The follow-up note is announced as required as soon as Yes is chosen
- [ ] The disabled Resolve option announces why it is disabled
- [ ] The stale-write alert is announced and takes focus
- [ ] Action status is never communicated by colour alone
- [ ] The cancel-action dialog traps focus and returns it to the trigger

## 13. Screenshot Paths

Playwright writes the Lab 4 captures to the three directories the handout §12
names:

```
artifacts/lab-04/screenshots/
├── staff-dashboard/      default, empty, forbidden, loading, failure
├── requester-dashboard/  default, empty, attention-required
└── actions-taken/        list, create, edit, validation, requester view,
                          cancel dialog, resolution conflict
```

Each directory holds a desktop, tablet and mobile capture of every state, at
1440×900, 768×1024 and 375×812, as in Lab 3.
