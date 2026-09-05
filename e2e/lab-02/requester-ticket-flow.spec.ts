import { expect, test } from "@playwright/test";
import {
  PNG_BYTES,
  REQUESTER_A,
  REQUESTER_B,
  changeRequesterButton,
  chooseRequester,
  createTicket,
  expectNoHorizontalOverflow,
  openCreatedTicket,
  uniqueSummary,
} from "./helpers.js";

// tests.md E2E-01..07. These run against the real client, the real API and the
// real database — the point of them is the seams the component tests and the
// API tests each mock away.

test.describe("Requester ticket flow", () => {
  test("E2E-01: select a Requester, create a ticket, find it in My Tickets, open its Detail (AC-01)", async ({
    page,
  }) => {
    const summary = uniqueSummary("Projector in room 4 will not power on");

    await chooseRequester(page, REQUESTER_A);
    const ticketNumber = await createTicket(page, summary);

    // BR-01: the number is generated, formatted, and shown back on success.
    expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);

    // The ticket just created is the one the Requester finds in the list.
    await page.goto("/my-tickets");
    await page.locator("#ticket-search").fill(summary);
    await expect(page.getByRole("link", { name: ticketNumber })).toBeVisible();

    // …and the row leads to that ticket's Detail screen (BR-38).
    await page.getByRole("link", { name: ticketNumber }).click();
    await expect(page.getByTestId("detail-ticket-number")).toHaveText(ticketNumber);
    await expect(page.getByText(summary)).toBeVisible();
    await expect(page.getByTestId("current-requester-name")).toHaveText(REQUESTER_A);
  });

  test("E2E-02: a Requester-scoped route with nothing selected lands on the selector (AC-02)", async ({
    page,
  }) => {
    // Arrive with no context at all, the way a bookmarked or shared URL does.
    await page.goto("/select-requester");
    await page.evaluate(() => sessionStorage.clear());

    await page.goto("/my-tickets");

    await expect(page.getByRole("heading", { name: "Select Development Requester" })).toBeVisible();
    await expect(page).toHaveURL(/\/select-requester$/);
    // The guarded screen never mounted: none of its furniture is on the page.
    await expect(page.getByRole("heading", { name: "My Tickets" })).toHaveCount(0);
  });

  test("E2E-03: add, download and soft-remove an attachment from Ticket Detail (AC-08, AC-17)", async ({
    page,
  }) => {
    const filename = "e2e-evidence.png";

    await chooseRequester(page, REQUESTER_A);
    await createTicket(page, uniqueSummary("Screen flickers when the laptop is docked"));
    await openCreatedTicket(page);

    // Add — the row appears in the list once the upload lands (BR-33).
    await expect(page.getByRole("heading", { name: /attachments \(0 active\)/i })).toBeVisible();
    await page.getByRole("button", { name: /add attachment/i }).click();
    await page.locator("#add-attachment").setInputFiles({
      name: filename,
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await expect(page.getByRole("heading", { name: /attachments \(1 active\)/i })).toBeVisible();

    // Download — AC-17: it arrives under the name it was uploaded with, not
    // the randomised name it is stored under (BR-32).
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: `Download ${filename}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(filename);

    // Remove — BR-31 requires a reason before the destructive action unlocks.
    await page.getByRole("button", { name: `Remove ${filename}` }).click();
    const confirm = page.getByTestId("remove-modal");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Remove Attachment" })).toBeDisabled();
    await page.locator("#removal-reason").fill("Uploaded the wrong screenshot");
    await confirm.getByRole("button", { name: "Remove Attachment" }).click();

    // BR-29/BR-30: the metadata and the reason stay; no Download control is
    // rendered at all, and the slot goes back to the ticket's allowance.
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("heading", { name: /attachments \(0 active\)/i })).toBeVisible();
    await expect(page.getByText("Reason: Uploaded the wrong screenshot")).toBeVisible();
    await expect(page.getByRole("button", { name: `Download ${filename}` })).toHaveCount(0);
  });

  test("E2E-04: another Requester can neither list nor open the ticket (AC-03, AC-09)", async ({
    page,
  }) => {
    const summary = uniqueSummary("Payroll export fails on the last step");

    await chooseRequester(page, REQUESTER_A);
    await createTicket(page, summary);
    const ticketId = await openCreatedTicket(page);

    // Switch identity the way the header offers it (BR-07: nothing stale left).
    await changeRequesterButton(page).click();
    await expect(page.getByRole("heading", { name: "Select Development Requester" })).toBeVisible();
    await page.locator("#requester-select").selectOption({ label: REQUESTER_B });
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page.getByTestId("current-requester-name")).toHaveText(REQUESTER_B);

    // BR-11: it is not in this Requester's list, even when searched for.
    await page.goto("/my-tickets");
    await page.locator("#ticket-search").fill(summary);
    await expect(page.getByTestId("zg-state-no-results")).toBeVisible();
    await expect(page.getByText(summary)).toHaveCount(0);

    // BR-12/AC-03: the direct URL reads exactly as a ticket that never
    // existed — no wording, status or detail separates the two.
    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByTestId("zg-state-error")).toContainText("Ticket not found.");
    await page.goto("/tickets/99999999");
    await expect(page.getByTestId("zg-state-error")).toContainText("Ticket not found.");
  });

  test("E2E-05: a search that matches nothing shows the no-results state (AC-10)", async ({ page }) => {
    await chooseRequester(page, REQUESTER_A);

    // No-results and empty are different states (ui-spec.md §6.4): the first
    // means a filter matched none of a non-empty set. This test owns that
    // precondition rather than borrowing it from the demo data, so it still
    // means something on a database that has only been seeded.
    await createTicket(page, uniqueSummary("Meeting room speakers produce no sound"));

    await page.goto("/my-tickets");

    await page.locator("#ticket-search").fill("zzz-nothing-matches-this-zzz");

    await expect(page.getByTestId("zg-state-no-results")).toBeVisible();
    // A no-results state is not an empty state: the controls stay usable so
    // the search can be corrected (ui-spec.md §6.4).
    await expect(page.locator("#ticket-search")).toBeEnabled();
    await expect(page.getByTestId("zg-state-empty")).toHaveCount(0);
  });

  test("E2E-06: the API failing mid-submission keeps every value and says so safely (AC-06)", async ({
    page,
  }) => {
    const summary = uniqueSummary("VPN drops every few minutes");

    await chooseRequester(page, REQUESTER_A);
    await page.goto("/tickets/new");
    await expect(page.locator("#summary")).toBeVisible();

    await page.locator("#categoryId").selectOption({ index: 1 });
    await page.locator("#relatedSystemId").selectOption({ index: 1 });
    await page.locator("#requestedPriority").selectOption("HIGH");
    await page.locator("#summary").fill(summary);
    await page.locator("#description").fill("The tunnel drops roughly every five minutes. [e2e]");

    // The backend goes away exactly at submit time — reference data has
    // already loaded, so this is a failure mid-flow rather than a screen that
    // never came up.
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() === "POST") return route.abort("failed");
      return route.fallback();
    });

    await page.getByRole("button", { name: "Submit Ticket" }).click();

    // BR-24/AC-06: a safe message, the form still there, nothing retyped, and
    // Submit usable again.
    await expect(page.getByTestId("zg-submit-error")).toBeVisible();
    await expect(page.locator("#summary")).toHaveValue(summary);
    await expect(page.locator("#requestedPriority")).toHaveValue("HIGH");
    await expect(page.getByRole("button", { name: "Submit Ticket" })).toBeEnabled();
    await expect(page.getByTestId("zg-state-success")).toHaveCount(0);
  });

  test("E2E-07: the whole flow works at 375px with no horizontal scroll (AC-05)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const summary = uniqueSummary("Printer on floor two jams every job");

    await chooseRequester(page, REQUESTER_A);
    await expectNoHorizontalOverflow(page, "Requester Selection");

    const ticketNumber = await createTicket(page, summary);
    await expectNoHorizontalOverflow(page, "Create Ticket (success)");

    await page.goto("/my-tickets");
    await page.locator("#ticket-search").fill(summary);
    // ui-spec.md §8: below 768px My Tickets is cards, never the table.
    await expect(page.getByTestId("ticket-cards")).toBeVisible();
    await expect(page.getByTestId("ticket-table")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "My Tickets (mobile cards)");

    await page.getByRole("link", { name: ticketNumber }).click();
    await expect(page.getByTestId("detail-ticket-number")).toHaveText(ticketNumber);
    await expectNoHorizontalOverflow(page, "Ticket Detail");

    // The navigation collapses behind the hamburger at this width (§3).
    await page.getByRole("button", { name: /navigation/i }).click();
    await expectNoHorizontalOverflow(page, "Ticket Detail (menu open)");
  });
});
