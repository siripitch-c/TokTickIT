import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  expectNoClippedScroller,
  expectNoHorizontalOverflow,
  expectNoSpilledText,
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

    // --- forbidden: a Requester who types the address --------------------
    await signOut(page);
    await signIn(page, ACCOUNTS.requester);
    await page.goto("/dashboard");
    await expect(page.getByTestId("zg-state-forbidden")).toBeVisible();
    await capture(page, "forbidden");
  });
}
