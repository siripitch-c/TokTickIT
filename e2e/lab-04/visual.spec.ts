import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  api,
  createTicketViaApi,
  expectNoClippedScroller,
  expectNoHorizontalOverflow,
  expectNoSpilledText,
  watchConsole,
  resetE2eData,
  signIn,
  signOut,
} from "../support/helpers.js";

// docs/lab-04/tests.md VIS-01..03, the IT Staff Dashboard half — the figures
// Part 5 of the submission asks for by path
// (artifacts/lab-04/screenshots/staff-dashboard/…).
//
// Written in Issue #49 rather than left to the QA issue, because Lab 3 was
// submitted with four figures missing for exactly that reason: everything
// visual was left to the last day. Issue #50 added the Requester dashboard and
// Issue #52 the rest, so this now writes every state `ui-spec.md` §13 names,
// in all three directories the handout §12 asks for:
//
//   staff-dashboard/      default, empty, forbidden, loading, failure
//   requester-dashboard/  default, empty, attention-required
//   actions-taken/        list, create, edit, validation, requester-view,
//                         cancel-dialog, resolution-conflict
//
// Thirty files per run, ten states at three widths.
//
// The two things a machine can decide — no horizontal scroll, nothing clipped
// or spilled — are asserted as each screenshot is taken, so a layout regression
// fails the run instead of waiting for somebody to notice it in a report.

const SHOTS = "artifacts/lab-04/screenshots";

test.beforeEach(() => {
  resetE2eData();
});

const VIEWPORTS = [
  { id: "VIS-01", name: "desktop", width: 1440, height: 900 },
  { id: "VIS-02", name: "tablet", width: 768, height: 1024 },
  { id: "VIS-03", name: "mobile", width: 375, height: 812 },
] as const;

/** A Requester dashboard with nothing on it, so AC-21's call to action shows. */
const EMPTY_REQUESTER_DASHBOARD = {
  metrics: { openTickets: 0, waitingForMe: 0, resolvedAwaitingConfirmation: 0 },
  attention: [],
  recentlyUpdated: [],
  recentlyResolved: [],
};

/** A dashboard with every number at zero and both lists empty (§4.4). */
const EMPTY_DASHBOARD = {
  metrics: {
    unassigned: 0,
    assignedToMe: 0,
    myOpenActions: 0,
    waitingForRequester: 0,
    highItPriority: 0,
    resolvedLast7Days: 0,
    byStatus: {
      NEW: 0,
      OPEN: 0,
      IN_PROGRESS: 0,
      WAITING_FOR_REQUESTER: 0,
      RESOLVED: 0,
      CLOSED: 0,
      REOPENED: 0,
      CANCELLED: 0,
    },
  },
  recentlyUpdated: [],
  needsAttention: [],
};

for (const viewport of VIEWPORTS) {
  test(`${viewport.id}: the IT Staff Dashboard at ${viewport.width}px (${viewport.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // FR-26: nothing on the console across the whole walk, not just at the end.
    const expectQuietConsole = watchConsole(page);

    const capture = async (on: Page, state: string) => {
      const where = `staff-dashboard (${state}) at ${viewport.width}px`;
      await expectNoHorizontalOverflow(on, where);
      await expectNoClippedScroller(on, where);
      await expectNoSpilledText(on, where);
      await on.screenshot({ path: `${SHOTS}/staff-dashboard/${viewport.name}-${state}.png`, fullPage: true });
    };

    // --- default: the real dashboard, over the seeded desk ---------------
    await signIn(page, ACCOUNTS.staff);
    await page.goto("/dashboard");
    await expect(page.getByTestId("metric-grid")).toBeVisible();
    await expect(page.getByTestId("by-status")).toBeVisible();
    await capture(page, "default");

    // --- empty: produced rather than reached -----------------------------
    // The seeded database always holds tickets, so a desk with nothing on it
    // cannot be reached by using the application. This one request is answered
    // with zeros; everything else on the screen is the real thing.
    await page.route("**/api/dashboard/staff", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_DASHBOARD) }),
    );
    await page.reload();
    await expect(page.getByTestId("metric-unassigned")).toContainText("0");
    // BR-21: a zero is rendered, never hidden — which is the thing this figure
    // exists to show.
    await expect(page.getByTestId("recently-updated")).toContainText("No open tickets have been updated.");
    await capture(page, "empty");
    await page.unroute("**/api/dashboard/staff");

    // --- forbidden: the server refuses this dashboard --------------------
    // There is one `/dashboard` route and it renders the screen the role may
    // see (ui-spec.md §3), so no address carries a Requester to the staff
    // variant and the forbidden state is the screen trusting the server over
    // itself (§4.4, AC-22). It is produced the way the empty state above is:
    // by making the endpoint answer, here with the 403 the server sends a
    // caller who is not staff. The staff member stays signed in, so this is
    // the staff dashboard's own state and not another screen's.
    await page.route("**/api/dashboard/staff", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "FORBIDDEN", message: "You do not have access." } }),
      }),
    );
    await page.goto("/dashboard");
    await expect(page.getByTestId("zg-state-forbidden")).toBeVisible();
    await capture(page, "forbidden");
    await page.unroute("**/api/dashboard/staff");

    // --- loading: the skeleton, caught by holding the answer --------------
    // §4.4's first row. The only way to photograph a state that exists for a
    // few hundred milliseconds is to stop time: the response is held until the
    // capture is taken, then released.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/dashboard/staff", async (route) => {
      await held;
      await route.continue();
    });
    const loading = page.goto("/dashboard");
    await expect(page.getByTestId("zg-state-loading")).toBeVisible();
    await capture(page, "loading");
    release();
    await loading;
    await page.unroute("**/api/dashboard/staff");

    // --- failure: the whole dashboard fails as one unit -------------------
    // §4.4's last row, and AC-23: one honest failure with Retry rather than six
    // half-loaded cards. A 500 rather than a dropped connection, because that
    // is what the error envelope documents and what the screen is written for.
    await page.route("**/api/dashboard/staff", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }),
      }),
    );
    await page.goto("/dashboard");
    await expect(page.getByTestId("zg-state-error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await capture(page, "failure");
    await page.unroute("**/api/dashboard/staff");

    expectQuietConsole(`staff-dashboard at ${viewport.width}px`);
  });

  test(`${viewport.id}: the Requester Dashboard at ${viewport.width}px (${viewport.name})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const expectQuietConsole = watchConsole(page);

    const capture = async (on: Page, state: string) => {
      const where = `requester-dashboard (${state}) at ${viewport.width}px`;
      await expectNoHorizontalOverflow(on, where);
      await expectNoClippedScroller(on, where);
      await expectNoSpilledText(on, where);
      await on.screenshot({
        path: `${SHOTS}/requester-dashboard/${viewport.name}-${state}.png`,
        fullPage: true,
      });
    };

    // --- default: the real dashboard over Tickets made for the occasion -----
    // `resetE2eData` clears the fixtures before each viewport, so the Requester
    // starts with nothing and a "default" capture would be indistinguishable
    // from the empty one. Three Tickets are raised through the API, and two of
    // them moved by a staff member — the attention panel only has anything to
    // show once somebody has asked the Requester a question or resolved their
    // problem, and only staff can do either.
    await signIn(page, ACCOUNTS.requester);
    const waiting = await createTicketViaApi(page, "Laptop will not wake from sleep");
    const resolved = await createTicketViaApi(page, "Shared drive shortcut is missing");
    await createTicketViaApi(page, "New monitor cable needed");
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);

    /**
     * Walks a Ticket along a path the matrix permits, reading the version it
     * must send at every step (BR-16, BR-26). A new Ticket is New, and New
     * reaches neither Waiting for Requester nor Resolved directly — it has to
     * be picked up first, which is what a real desk does anyway.
     */
    const walk = async (ticket: { id: number; ticketNumber: string }, path: readonly string[]) => {
      for (const currentStatus of path) {
        const read = await api(page).get(`/api/tickets/${ticket.id}`);
        const { version } = (await read.json()).data as { version: number };
        const moved = await api(page).patch(`/api/tickets/${ticket.id}/status`, { version, currentStatus });
        expect(moved.status(), `moving ${ticket.ticketNumber} to ${currentStatus}`).toBe(200);
      }
    };

    await walk(waiting, ["IN_PROGRESS", "WAITING_FOR_REQUESTER"]);
    await walk(resolved, ["IN_PROGRESS", "RESOLVED"]);
    await signOut(page);

    await signIn(page, ACCOUNTS.requester);
    await page.goto("/dashboard");
    await expect(page.getByTestId("metric-grid")).toBeVisible();
    // Both kinds of attention row are on screen, which is what the panel is for.
    await expect(page.getByTestId("attention")).toContainText("Waiting for your reply");
    await expect(page.getByTestId("attention")).toContainText("Resolved — please confirm");
    await capture(page, "default");

    // --- attention-required: the panel on its own -------------------------
    // §13 names this as a state of its own, and a second full-page shot would
    // only repeat the one above. The panel is captured as an element instead,
    // so the figure is the thing the state is about: both reasons in words,
    // beside the Ticket they belong to.
    const attention = page.getByTestId("attention");
    await attention.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page, `requester-dashboard (attention) at ${viewport.width}px`);
    await attention.screenshot({
      path: `${SHOTS}/requester-dashboard/${viewport.name}-attention-required.png`,
    });

    // --- empty: AC-21's one call to action --------------------------------
    // The fixture Requester has Tickets, so an empty desk is produced rather
    // than reached; everything else on the screen is the real application.
    await page.route("**/api/dashboard/requester", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(EMPTY_REQUESTER_DASHBOARD),
      }),
    );
    await page.reload();
    await expect(page.getByTestId("create-ticket-cta")).toBeVisible();
    await expect(page.getByTestId("attention")).toContainText("Nothing needs you right now.");
    await capture(page, "empty");
    await page.unroute("**/api/dashboard/requester");

    expectQuietConsole(`requester-dashboard at ${viewport.width}px`);
  });

  test(`${viewport.id}: the Actions Taken area at ${viewport.width}px (${viewport.name})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const expectQuietConsole = watchConsole(page);

    /**
     * The panel rather than the page. Ticket Detail is long, and at 1440px a
     * full-page shot of it reduces the Actions area to a strip the §5 checklist
     * cannot be read against - which is the Lab 3 lesson about the trio of
     * screenshots, applied before it happens again. The page-level assertions
     * still run against the whole document.
     */
    const capture = async (state: string, target = page.getByTestId("actions-taken")) => {
      const where = `actions-taken (${state}) at ${viewport.width}px`;
      await expectNoHorizontalOverflow(page, where);
      await expectNoClippedScroller(page, where);
      await expectNoSpilledText(page, where);
      await target.scrollIntoViewIfNeeded();
      await target.screenshot({ path: `${SHOTS}/actions-taken/${viewport.name}-${state}.png` });
    };

    // --- a Ticket with a work log on it -----------------------------------
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, "Lecture capture misses the first minutes");
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);
    const me = (await (await api(page).get("/api/auth/me")).json()).data as { id: number };

    // Three Actions through the API, so the list has something to be before
    // anything is typed: one finished, one still planned, one cancelled. The
    // fourth status, In Progress, arrives with the edit below.
    const addAction = async (body: Record<string, unknown>) => {
      const res = await api(page).post(`/api/tickets/${ticket.id}/actions`, {
        assignedToId: me.id,
        followUpRequired: false,
        ...body,
      });
      expect(res.status(), `creating "${String(body.description).slice(0, 40)}"`).toBe(201);
      return (await res.json()).data as { id: number };
    };

    await addAction({
      description: "Collected the room's capture logs and read the first five minutes.",
      result: "The encoder starts 90 seconds after the scheduled time.",
      status: "COMPLETED",
    });
    const planned = await addAction({
      description: "Scheduled a firmware update for the lectern encoder.",
      status: "PLANNED",
    });
    const toCancel = await addAction({
      description: "Considered replacing the capture card before the update.",
      status: "PLANNED",
    });
    void toCancel;

    await page.goto(`/tickets/${ticket.id}`);
    const panel = page.getByTestId("actions-taken");
    await expect(panel).toBeVisible();

    // --- list -------------------------------------------------------------
    await expect(panel.getByRole("heading", { name: /^Actions Taken/ })).toBeVisible();
    await capture("list");

    // --- create: the inline form, empty -----------------------------------
    await panel.getByRole("button", { name: "Add Action" }).click();
    await expect(page.getByLabel(/What was done/i)).toBeVisible();
    await capture("create");

    // --- validation: every message below its own field ---------------------
    // Submitted empty on purpose: §6.2 puts each message directly under the
    // field it belongs to, and the checklist is read against this picture.
    await page.getByRole("button", { name: "Save action" }).click();
    await expect(page.getByText(/must be between 5 and/i).first()).toBeVisible();
    await capture("validation");

    // The follow-up note is the one field that appears only when it is needed,
    // and it is the one the checklist asks about by name.
    await page.getByRole("radio", { name: "Yes" }).click();
    await expect(page.getByLabel(/Follow-up note/i)).toBeVisible();
    // Submitted again, so the note carries its own message. The first version
    // of this capture stopped at revealing the field, which showed that it
    // appears and not what §12 asks about - that its message sits under it too.
    await page.getByRole("button", { name: "Save action" }).click();
    await expect(page.getByText(/A follow-up note is required/i)).toBeVisible();
    await capture("validation-follow-up");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel(/What was done/i)).toHaveCount(0);

    // --- edit: the same form, opened on an existing Action -----------------
    const plannedRow = page.getByRole("listitem").filter({ hasText: "Scheduled a firmware update" });
    await plannedRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel(/What was done/i)).toHaveValue(/firmware/);
    await capture("edit");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    // --- cancel-dialog: the confirmation before a destructive move ---------
    const cancelRow = page.getByRole("listitem").filter({ hasText: "Considered replacing the capture card" });
    await cancelRow.getByRole("button", { name: "Cancel action" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The viewport, not the page. A modal is `position: fixed`, and a full-page
    // capture paints it - and its dim overlay - once, at the height the viewport
    // happened to be, leaving the rest of a long Ticket Detail undimmed. The
    // first version of this shot did that and read as a layout defect at 375px,
    // where the dialog landed at the foot of a 3700px image. What the figure is
    // about is the dialog centred over a dimmed screen, which is what the
    // viewport shows and what a person actually sees.
    await expectNoHorizontalOverflow(page, `actions-taken (cancel-dialog) at ${viewport.width}px`);
    await page.screenshot({
      path: `${SHOTS}/actions-taken/${viewport.name}-cancel-dialog.png`,
      fullPage: false,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // --- resolution-conflict: a stale write, refused -----------------------
    // Somebody else saves the Action this tab is holding, and then this tab
    // writes. BR-27's conflict, not a validation error: the block says the
    // record moved underneath and offers Reload.
    //
    // Through a *row* control rather than the edit form. The form reports a
    // refusal as a plain callout; `RowConflict`, which is the block with the
    // Reload button and the focus move (§2.3, A11Y-06), belongs to the row. The
    // first version of this capture used the form and found no Reload, which is
    // correct behaviour and the wrong screen to photograph.
    const current = (await (await api(page).get(`/api/tickets/${ticket.id}/actions`)).json()).data as {
      id: number;
      version: number;
      description: string;
    }[];
    const stale = current.find((a) => a.id === planned.id)!;
    const moved = await api(page).patch(`/api/actions/${planned.id}`, {
      version: stale.version,
      description: `${stale.description} Rescheduled by somebody else.`,
    });
    expect(moved.status(), "the other writer's save should land").toBe(200);

    // The page still holds the version from before that save.
    await plannedRow.getByRole("button", { name: "Cancel action" }).click();
    const staleDialog = page.getByRole("dialog");
    await staleDialog.getByRole("button", { name: "Cancel action" }).click();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
    await capture("resolution-conflict");

    // --- requester-view: the same panel, with nothing to press -------------
    await signOut(page);
    await signIn(page, ACCOUNTS.requester);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Add Action" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Cancel action" })).toHaveCount(0);
    await capture("requester-view");

    expectQuietConsole(`actions-taken at ${viewport.width}px`);
  });
}
