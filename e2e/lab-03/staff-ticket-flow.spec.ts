import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  PNG_BYTES,
  api,
  createTicket,
  createTicketViaApi,
  expectNoHorizontalOverflow,
  openSignedIn,
  signIn,
  uniqueSuffix,
  uniqueSummary,
} from "../support/helpers.js";

// docs/lab-03/tests.md E2E-05..08 and E2E-12 — the Requester's flow under real
// sign-in, the Ticket Queue, and a Ticket worked from both sides. Where two
// people are involved each has a browser context of their own, signed in as
// themselves, exactly as two people at two desks would be.

/** The text of one queue column, by its 1-based position (§7.1 order). */
const queueColumn = (page: Page, position: number) =>
  page.getByTestId("queue-table").locator(`tbody tr td:nth-child(${position})`).allInnerTexts();

const TICKET_NO = 1;
const CURRENT_STATUS = 7;
const OWNER = 8;

test.describe("Lab 3 — Requester regression and IT Staff ticket work", () => {
  test("E2E-05 / AC-08, BR-44: a Requester creates a ticket, finds it, opens it and adds and downloads an attachment — with no selector anywhere", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.requester);

    // AC-25: the Lab 2 selector is gone — no control, and its address leads
    // nowhere but the Requester's own screen.
    await expect(page.getByRole("button", { name: /change requester/i })).toHaveCount(0);
    await page.goto("/select-requester");
    await expect(page).toHaveURL(/\/my-tickets$/);

    const summary = uniqueSummary("Docking station stops charging the laptop");
    const ticketNumber = await createTicket(page, summary);
    expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);

    await page.goto("/my-tickets");
    await page.locator("#ticket-search").fill(summary);
    await page.getByRole("link", { name: ticketNumber }).click();
    await expect(page.getByTestId("detail-ticket-number")).toHaveText(ticketNumber);
    // The Requester's view of Ticket Detail: Public Comments, and no trace of
    // Internal Notes (BR-20).
    await expect(page.getByTestId("public-comments")).toBeVisible();
    await expect(page.getByTestId("internal-notes")).toHaveCount(0);

    const filename = "e2e-dock-photo.png";
    await page.getByRole("button", { name: /add attachment/i }).click();
    await page.locator("#add-attachment").setInputFiles({ name: filename, mimeType: "image/png", buffer: PNG_BYTES });
    await expect(page.getByRole("heading", { name: /attachments \(1 active\)/i })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: `Download ${filename}` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(filename);
  });

  test("E2E-06 / AC-09: the queue searches, filters, sorts and pages in the browser, then opens Ticket Detail", async ({
    page,
    browser,
  }) => {
    const summary = uniqueSummary("Lecture capture misses the first minutes");
    const requester = await openSignedIn(browser, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(requester.page, summary);
    await requester.context.close();

    await signIn(page, ACCOUNTS.staff);
    const table = page.getByTestId("queue-table");
    await expect(table).toBeVisible();

    // Search, kept in the address (§7.4).
    await page.locator("#queue-search").fill(summary);
    await expect(page).toHaveURL(/search=/);
    await expect.poll(() => queueColumn(page, TICKET_NO)).toEqual([ticket.ticketNumber]);
    await page.getByRole("button", { name: "Clear Filters" }).first().click();
    await expect(page).not.toHaveURL(/search=/);

    // Filters: every row that remains carries the value chosen.
    await page.locator("#queue-filter-status").selectOption("NEW");
    await page.locator("#queue-filter-owner").selectOption("unassigned");
    await expect(page).toHaveURL(/status=NEW/);
    await expect(page).toHaveURL(/owner=unassigned/);
    await expect
      .poll(async () => {
        const statuses = await queueColumn(page, CURRENT_STATUS);
        const owners = await queueColumn(page, OWNER);
        return statuses.length > 0 && statuses.every((s) => s === "New") && owners.every((o) => o === "Unassigned");
      })
      .toBe(true);
    expect(await queueColumn(page, TICKET_NO)).toContain(ticket.ticketNumber);
    await page.getByRole("button", { name: "Clear Filters" }).first().click();

    // Sort by Ticket Number, both ways.
    await page.getByRole("button", { name: "Sort by ticket no." }).click();
    await expect(page).toHaveURL(/sortBy=ticketNumber/);
    await expect(page.getByRole("columnheader", { name: /ticket no\./i })).toHaveAttribute("aria-sort", "descending");
    await expect
      .poll(async () => {
        const numbers = await queueColumn(page, TICKET_NO);
        return numbers.length > 1 && numbers.join() === [...numbers].sort().reverse().join();
      })
      .toBe(true);
    await page.getByRole("button", { name: /Sorted by ticket no\./ }).click();
    await expect(page.getByRole("columnheader", { name: /ticket no\./i })).toHaveAttribute("aria-sort", "ascending");
    await expect
      .poll(async () => {
        const numbers = await queueColumn(page, TICKET_NO);
        return numbers.length > 1 && numbers.join() === [...numbers].sort().join();
      })
      .toBe(true);

    // Paging, at ten a page so the seeded queue is certain to have a second.
    await page.locator("#page-size").selectOption("10");
    const summaryLine = page.getByTestId("pagination-summary");
    await expect(summaryLine).toHaveText(/^Showing 1 to 10 of \d+ tickets$/);
    const total = Number((await summaryLine.innerText()).match(/of (\d+)/)![1]);
    expect(total, "the seeded queue holds more than one page of ten").toBeGreaterThan(10);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(summaryLine).toHaveText(/^Showing 11 to \d+ of \d+ tickets$/);

    // …and a row opens its Ticket Detail.
    const first = table.locator("tbody tr").first().getByRole("link");
    const number = (await first.innerText()).trim();
    await first.click();
    await expect(page.getByTestId("detail-ticket-number")).toHaveText(number);
    await expect(page.getByTestId("operations-panel")).toBeVisible();
  });

  test("E2E-07 / AC-10, AC-12, AC-13, AC-14, AC-15: staff claim, prioritise, move, comment and note — and the Requester sees the comment and no trace of the note", async ({
    page,
    browser,
  }) => {
    const summary = uniqueSummary("Shared calendar shows the wrong time zone");
    const requester = await openSignedIn(browser, ACCOUNTS.requester);
    try {
      const ticket = await createTicketViaApi(requester.page, summary);

      await signIn(page, ACCOUNTS.staff);
      await page.goto(`/tickets/${ticket.id}`);
      const operations = page.getByTestId("operations-panel");

      // AC-10: one click, and the signed-in person owns it.
      await operations.getByRole("button", { name: "Claim" }).click();
      await expect(operations.getByLabel("Ticket Owner").locator("option:checked")).toHaveText(ACCOUNTS.staff.name);
      await expect(operations.getByRole("button", { name: "Claim" })).toBeDisabled();

      // AC-12
      const itPriority = operations.getByLabel("IT Priority", { exact: true });
      await itPriority.selectOption("HIGH");
      await expect(itPriority).toHaveValue("HIGH");

      // AC-13: only the moves BR-31 permits from New are offered.
      const status = operations.getByLabel("Current Status");
      await expect(status.locator("option")).toHaveText(["New (current)", "Open", "In Progress", "Cancelled"]);
      await status.selectOption("IN_PROGRESS");
      await expect(status).toHaveValue("IN_PROGRESS");

      // AC-14
      const comment = `We are checking the calendar service now. ${uniqueSuffix()}`;
      await page.getByLabel("Add a public comment").fill(comment);
      await page.getByRole("button", { name: "Post Comment" }).click();
      await expect(page.getByTestId("public-comments").getByText(comment)).toBeVisible();

      // AC-15
      const note = `Probably the time zone mapping on the mail server again. ${uniqueSuffix()}`;
      await page.getByLabel("Add an internal note").fill(note);
      await page.getByRole("button", { name: "Add Internal Note" }).click();
      await expect(page.getByTestId("internal-notes").getByText(note)).toBeVisible();

      // The Requester, at their own desk.
      await requester.page.goto(`/tickets/${ticket.id}`);
      await expect(requester.page.getByTestId("detail-ticket-number")).toHaveText(ticket.ticketNumber);
      await expect(requester.page.getByTestId("public-comments").getByText(comment)).toBeVisible();
      await expect(requester.page.getByTitle("Status: In Progress")).toBeVisible();
      await expect(requester.page.getByTestId("internal-notes")).toHaveCount(0);
      await expect(requester.page.getByText(note)).toHaveCount(0);
      // Not hidden — absent at the server too, answered as a Ticket that does not exist (AC-04).
      expect((await api(requester.page).get(`/api/tickets/${ticket.id}/notes`)).status()).toBe(404);
    } finally {
      await requester.context.close();
    }
  });

  test("E2E-08 / AC-16: the Requester's resolution signal reaches staff and leaves the status to them", async ({
    page,
    browser,
  }) => {
    const requester = await openSignedIn(browser, ACCOUNTS.requester);
    try {
      const ticket = await createTicketViaApi(requester.page, uniqueSummary("Wi-Fi drops in the library reading room"));

      await requester.page.goto(`/tickets/${ticket.id}`);
      await requester.page.getByRole("button", { name: "Problem Appears Resolved" }).click();
      await expect(requester.page.getByTestId("resolution-signalled")).toBeVisible();
      await expect(requester.page.getByTitle("Status: New")).toBeVisible();

      // Staff see the signal as a fact in the header; the status is unchanged.
      await signIn(page, ACCOUNTS.staff);
      await page.goto(`/tickets/${ticket.id}`);
      await expect(page.getByTestId("requester-resolved")).toContainText("Requester reported this resolved on");
      const status = page.getByTestId("operations-panel").getByLabel("Current Status");
      await expect(status).toHaveValue("NEW");

      // Staff resolve it, through the moves BR-31 allows.
      await status.selectOption("IN_PROGRESS");
      await expect(status).toHaveValue("IN_PROGRESS");
      await status.selectOption("RESOLVED");
      await expect(status).toHaveValue("RESOLVED");

      await requester.page.reload();
      await expect(requester.page.getByTitle("Status: Resolved")).toBeVisible();
      await expect(requester.page.getByTestId("resolution-signalled")).toBeVisible();
      await expect(requester.page.getByRole("button", { name: "Problem Appears Resolved" })).toHaveCount(0);
    } finally {
      await requester.context.close();
    }
  });

  test("E2E-12 / AC-09: at 375px staff sign in, work from queue cards and read both threads, with no horizontal scrolling", async ({
    page,
    browser,
  }) => {
    const summary = uniqueSummary("Classroom speaker crackles at high volume");
    const requester = await openSignedIn(browser, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(requester.page, summary);
    await api(requester.page).post(`/api/tickets/${ticket.id}/comments`, { body: "It gets worse after the first hour of class." });
    await requester.context.close();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");
    await expectNoHorizontalOverflow(page, "Login");
    await signIn(page, ACCOUNTS.staff);

    // §7.3: below 768px the queue is cards, never the table.
    await expect(page.getByTestId("queue-cards")).toBeVisible();
    await expect(page.getByTestId("queue-table")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "Ticket Queue (cards)");

    // Exact: "Clear Filters" would match as well.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("group", { name: "Filters" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "Ticket Queue (filter sheet)");
    await page.getByRole("button", { name: "Apply" }).click();

    await page.locator("#queue-search").fill(summary);
    await page.getByTestId("queue-cards").getByRole("link", { name: summary }).click();
    await expect(page.getByTestId("detail-ticket-number")).toHaveText(ticket.ticketNumber);
    await expectNoHorizontalOverflow(page, "Ticket Detail");

    // Both threads, the internal one after the public one (§8.1).
    const comments = page.getByTestId("public-comments");
    const notes = page.getByTestId("internal-notes");
    await comments.scrollIntoViewIfNeeded();
    await expect(comments.getByText("It gets worse after the first hour of class.")).toBeVisible();
    await notes.scrollIntoViewIfNeeded();
    await expect(notes).toBeVisible();
    const commentsTop = (await comments.boundingBox())!.y;
    const notesTop = (await notes.boundingBox())!.y;
    expect(notesTop).toBeGreaterThan(commentsTop);
    await expectNoHorizontalOverflow(page, "Ticket Detail (threads)");

    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expectNoHorizontalOverflow(page, "Ticket Detail (menu open)");
  });
});
