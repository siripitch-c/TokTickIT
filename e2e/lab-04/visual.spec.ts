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
// visual was left to the last day. Issue #52 extends this file with the
// Requester dashboard and the rest of Lab 4's screens; the shape below is the
// Lab 3 one, so extending it is adding blocks rather than rewriting it.
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
}
