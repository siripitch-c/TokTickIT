import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  api,
  createTicketViaApi,
  resetE2eData,
  signIn,
  signOut,
  uniqueSummary,
} from "../support/helpers.js";

// docs/lab-04/tests.md E2E-02; specification.md BR-18, BR-19, AC-09, AC-10.
//
// The resolution gate, in a browser. The rule is enforced in the backend
// (API-FLOW-05) and the screen is tested in isolation (UI-FLOW-02); this is the
// one that proves the two agree - that a person meets the reason before they
// choose, and that the same request made outside the screen meets the refusal.

test.beforeEach(() => {
  resetE2eData();
});

const statusSelect = (page: Page) => page.getByLabel(/^Current Status$/);

/** Moves a Ticket along a path the matrix permits, reading the version each time. */
async function walk(page: Page, ticketId: number, path: readonly string[]) {
  for (const currentStatus of path) {
    const read = await api(page).get(`/api/tickets/${ticketId}`);
    const { version } = (await read.json()).data as { version: number };
    const moved = await api(page).patch(`/api/tickets/${ticketId}/status`, { version, currentStatus });
    expect(moved.status(), `moving to ${currentStatus}`).toBe(200);
  }
}

test.describe("Lab 4 — the resolution gate", () => {
  test("E2E-02 / AC-09, AC-10: Resolve is refused while an Action is open, and accepted once it is closed", async ({
    page,
  }) => {
    const summary = uniqueSummary("Office telephone has no dial tone");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, summary);
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);
    // New reaches neither Resolved nor anything else useful directly: the
    // matrix asks for the Ticket to be picked up first, which is also what a
    // desk does (BR-16).
    await walk(page, ticket.id, ["IN_PROGRESS"]);

    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByTestId("actions-taken")).toBeVisible();

    // Two Actions, left open.
    for (const description of [
      "Tested the handset on a known working socket in the next room.",
      "Asked the telephony supplier to check the line from their end.",
    ]) {
      await page.getByTestId("actions-taken").getByRole("button", { name: "Add Action" }).click();
      await page.getByLabel(/What was done/i).fill(description);
      await page.getByRole("button", { name: "Save action" }).click();
      await expect(page.getByLabel(/What was done/i)).toHaveCount(0);
    }
    await expect(page.getByTestId("actions-taken").getByRole("heading", { name: "Actions Taken (2)" })).toBeVisible();

    // --- AC-09: the reason is met before the choice ------------------------
    // Resolve stays listed rather than disappearing - removing it would leave
    // the reader guessing where it went - but it cannot be chosen, and the
    // sentence under the control says why, in the plural that matches the count.
    await page.reload();
    const resolve = statusSelect(page).locator('option[value="RESOLVED"]');
    await expect(resolve, "Resolve should still be listed").toHaveCount(1);
    await expect(resolve).toBeDisabled();
    await expect(
      page.getByText("2 actions on this ticket are still open. Complete or cancel them before resolving it."),
    ).toBeVisible();

    // --- AC-10: the server refuses the same move, made without the screen ---
    const read = await api(page).get(`/api/tickets/${ticket.id}`);
    const { version } = (await read.json()).data as { version: number };
    const refused = await api(page).patch(`/api/tickets/${ticket.id}/status`, {
      version,
      currentStatus: "RESOLVED",
    });
    expect(refused.status()).toBe(409);
    const error = (await refused.json()).error as { code: string; message: string };
    expect(error.code).toBe("OPEN_ACTIONS_REMAIN");
    expect(error.message, "the refusal should say how many are open").toMatch(/2/);

    // --- close them, one each way -----------------------------------------
    const first = page.getByRole("listitem").filter({ hasText: "Tested the handset" });
    // Two presses, by design: §6.4 has the first one open the form on the
    // missing Result rather than send a request, so the second is the one that
    // completes it. A dead button with its reason in a tooltip teaches nobody.
    await first.getByRole("button", { name: "Complete" }).click();
    await page.getByLabel(/^Result/i).fill("The handset works elsewhere, so the fault is the line.");
    await page.getByRole("button", { name: "Save action" }).click();
    await expect(first).toContainText("Planned");
    await first.getByRole("button", { name: "Complete" }).click();
    await expect(first).toContainText("Completed");

    const second = page.getByRole("listitem").filter({ hasText: "Asked the telephony supplier" });
    await second.getByRole("button", { name: "Cancel action" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel action" }).click();
    await expect(second).toContainText("Cancelled");

    // --- and now the gate opens -------------------------------------------
    // BR-18 counts Completed and Cancelled alike: closing an Action is closing
    // it, whichever way it ended.
    await page.reload();
    await expect(statusSelect(page).locator('option[value="RESOLVED"]')).toBeEnabled();
    await expect(
      page.getByText(/actions? on this ticket (is|are) still open/),
      "the reason should be gone once nothing is open",
    ).toHaveCount(0);

    await statusSelect(page).selectOption("RESOLVED");
    await expect(statusSelect(page)).toHaveValue("RESOLVED");

    const stored = (await (await api(page).get(`/api/tickets/${ticket.id}`)).json()).data as {
      currentStatus: string;
      resolvedAt: string | null;
      openActionCount: number;
    };
    expect(stored.currentStatus).toBe("RESOLVED");
    expect(stored.openActionCount).toBe(0);
    // Issue #49's column: the transition records when it happened, which is
    // what the dashboard's weekly metric reads (BR-21, BR-25).
    expect(stored.resolvedAt, "the transition should record its moment").not.toBeNull();
  });

  test("E2E-02 / BR-19: cancelling a Ticket is never gated on its Actions", async ({ page }) => {
    // The other half of the same rule, and the one most easily broken by a
    // gate written as "no terminal move while anything is open": a Ticket that
    // turns out not to be a problem must be closable with work still planned on
    // it, or the log becomes a reason to keep tickets open.
    const summary = uniqueSummary("Second monitor was never actually requested");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, summary);
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);
    await walk(page, ticket.id, ["IN_PROGRESS"]);
    await page.goto(`/tickets/${ticket.id}`);

    await page.getByTestId("actions-taken").getByRole("button", { name: "Add Action" }).click();
    await page.getByLabel(/What was done/i).fill("Asked the department whether the monitor is still needed.");
    await page.getByRole("button", { name: "Save action" }).click();
    await expect(page.getByLabel(/What was done/i)).toHaveCount(0);

    await page.reload();
    // Resolve is blocked...
    await expect(statusSelect(page).locator('option[value="RESOLVED"]')).toBeDisabled();
    // ...and Cancelled is not.
    await expect(statusSelect(page).locator('option[value="CANCELLED"]')).toBeEnabled();

    await statusSelect(page).selectOption("CANCELLED");
    // §6.2: a terminal move asks first, and the confirm names the move rather
    // than saying "OK" - so on this dialog it reads "Move to Cancelled", not
    // anything with the word Cancel on its own, which belongs to the way out.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Move to Cancelled" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(statusSelect(page)).toHaveValue("CANCELLED");
    const stored = (await (await api(page).get(`/api/tickets/${ticket.id}`)).json()).data as {
      currentStatus: string;
      openActionCount: number;
    };
    expect(stored.currentStatus).toBe("CANCELLED");
    expect(stored.openActionCount, "the open Action is still open, and that is allowed").toBe(1);
  });
});
