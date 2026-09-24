import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  ADMINISTRATOR,
  createTicketViaApi,
  currentUser,
  expectNoClippedScroller,
  expectNoHorizontalOverflow,
  expectNoSpilledText,
  openAccountMenu,
  openSignedIn,
  resetE2eData,
  signIn,
  signOut,
} from "../support/helpers.js";

// docs/lab-03/tests.md VIS-01..03 — every Lab 3 screen and state at the three
// widths ui-spec.md §11 defines, written to the four directories the handout §12
// names (tests.md §5, ui-spec.md §13).
//
// As in Lab 2, the screenshots are evidence a person reads against the §5
// checklist, and the two things a machine can decide — no horizontal scroll on
// the page, no table cut off inside its scrolling wrapper — are asserted as each
// one is taken, so a layout regression fails the run.
//
// One state is produced rather than reached: the queue's empty state. The
// seeded database always holds tickets, so that one request is answered with an
// empty page. Everything else on these screens is the real application.

const SHOTS = "artifacts/lab-03/screenshots";

// Before each viewport, so each width photographs the same data.
test.beforeEach(() => {
  resetE2eData();
});

const VIEWPORTS = [
  { id: "VIS-01", name: "desktop", width: 1440, height: 900 },
  { id: "VIS-02", name: "tablet", width: 768, height: 1024 },
  { id: "VIS-03", name: "mobile", width: 375, height: 812 },
] as const;

const EMPTY_QUEUE = { data: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } };

for (const viewport of VIEWPORTS) {
  test(`${viewport.id}: capture every Lab 3 screen and state at ${viewport.width}px (${viewport.name})`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000); // four screens, some thirty states, two people
    const size = { width: viewport.width, height: viewport.height };
    await page.setViewportSize(size);
    const mobile = viewport.width < 768;

    /** Asserts the layout, then writes `{viewport}-{state}.png` — of the page, or of one panel. */
    const capture = async (on: Page, directory: string, state: string, panel?: Locator) => {
      const where = `${directory} (${state}) at ${viewport.width}px`;
      await expectNoHorizontalOverflow(on, where);
      await expectNoClippedScroller(on, where);
      await expectNoSpilledText(on, where);
      const path = `${SHOTS}/${directory}/${viewport.name}-${state}.png`;
      if (panel) {
        await panel.screenshot({ path });
      } else {
        await on.screenshot({ path, fullPage: true });
      }
    };

    // --- authentication/ ------------------------------------------------------
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await capture(page, "authentication", "login");

    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.locator("#email-error")).toBeVisible();
    await capture(page, "authentication", "login-validation");

    await page.locator("#email").fill(ACCOUNTS.requester.email);
    await page.locator("#password").fill("Not-The-Password-1");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByTestId("zg-login-error")).toBeVisible();
    await capture(page, "authentication", "login-failure");

    await signIn(page, ACCOUNTS.firstLogin);
    await expect(page.getByTestId("zg-initial-password-banner")).toBeVisible();
    await capture(page, "authentication", "change-password-mandatory");

    await page.getByRole("button", { name: "Save New Password" }).click();
    await expect(page.locator("#currentPassword-error")).toBeVisible();
    await capture(page, "authentication", "change-password-validation");

    // Log Out is the one action the mandatory screen leaves (BR-02).
    await openAccountMenu(page);
    const logOut = page.locator('button:has-text("Log Out"):visible');
    await expect(logOut).toBeVisible();
    await capture(page, "authentication", "logout");
    await logOut.click();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    await signIn(page, ACCOUNTS.requester);
    await page.goto("/change-password");
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await capture(page, "authentication", "change-password-voluntary");
    await signOut(page);

    // --- staff-queue/ -----------------------------------------------------------
    await signIn(page, ACCOUNTS.staff);
    const queue = page.getByTestId(mobile ? "queue-cards" : "queue-table");
    await expect(queue).toBeVisible();
    if (mobile) {
      // VIS-03: cards replace the table, never both.
      await expect(page.getByTestId("queue-table")).toHaveCount(0);
    } else if (viewport.width < 992) {
      // VIS-02: two columns are dropped at tablet, rather than let the table overflow (§7.2).
      await expect(queue.locator("th.zg-col-category")).toBeHidden();
      await expect(queue.locator("th.zg-col-requested-priority")).toBeHidden();
    }
    await capture(page, "staff-queue", "default");

    // Below 768px the filters live in a sheet, which is part of what is
    // photographed. Requested Priority is the filter chosen because nobody can
    // change it, so the seeded High tickets are always there to be shown.
    if (mobile) await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.locator("#queue-filter-requestedPriority").selectOption("HIGH");
    await expect(page).toHaveURL(/requestedPriority=HIGH/);
    await expect(page.getByTestId("zg-state-loading")).toHaveCount(0);
    await expect(queue).toBeVisible();
    await capture(page, "staff-queue", "filtered");
    if (mobile) await page.getByRole("button", { name: "Apply" }).click();

    await page.locator("#queue-search").fill("zzz-nothing-matches-this-zzz");
    await expect(page.getByTestId("zg-state-no-results")).toBeVisible();
    await capture(page, "staff-queue", "no-results");

    // The produced state: the real response, with its headers, carrying an empty page.
    await page.route("**/api/staff/tickets**", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: EMPTY_QUEUE });
    });
    await page.goto("/staff/tickets");
    await expect(page.getByTestId("zg-state-empty")).toBeVisible();
    await capture(page, "staff-queue", "empty");
    await page.unroute("**/api/staff/tickets**");

    // A role refused the Administrator's screen (§2.4).
    await page.goto("/admin/users");
    await expect(page.getByTestId("zg-state-forbidden")).toBeVisible();
    await capture(page, "user-management", "forbidden");

    // --- staff-ticket-detail/ ---------------------------------------------------
    const requester = await openSignedIn(browser, ACCOUNTS.requester, size);
    try {
      const ticket = await createTicketViaApi(
        requester.page,
        "Projector in room 305 shows no signal",
        "The projector turns on but shows no input from the lectern computer.",
        "HIGH",
      );

      await page.goto(`/tickets/${ticket.id}`);
      const operations = page.getByTestId("operations-panel");
      await operations.getByRole("button", { name: "Claim" }).click();
      await expect(operations.getByRole("button", { name: "Claim" })).toBeDisabled();
      await operations.getByLabel("IT Priority", { exact: true }).selectOption("HIGH");
      await expect(operations.getByLabel("IT Priority", { exact: true })).toHaveValue("HIGH");
      await operations.getByLabel("Current Status").selectOption("IN_PROGRESS");
      await expect(operations.getByLabel("Current Status")).toHaveValue("IN_PROGRESS");

      const comment = "We are checking the lectern connection this afternoon.";
      await page.getByLabel("Add a public comment").fill(comment);
      await page.getByRole("button", { name: "Post Comment" }).click();
      await expect(page.getByTestId("public-comments").getByText(comment)).toBeVisible();
      const note = "The HDMI switch in this room was replaced last month. Check it first.";
      await page.getByLabel("Add an internal note").fill(note);
      await page.getByRole("button", { name: "Add Internal Note" }).click();
      await expect(page.getByTestId("internal-notes").getByText(note)).toBeVisible();
      await capture(page, "staff-ticket-detail", "staff");

      // The internal panel on its own, with a note being written: the five
      // differences from the public one are what the checklist judges.
      const notes = page.getByTestId("internal-notes");
      await page.getByLabel("Add an internal note").fill("Ask facilities whether the room was rewired.");
      await notes.scrollIntoViewIfNeeded();
      await capture(page, "staff-ticket-detail", "internal-notes", notes);
      await page.getByLabel("Add an internal note").fill("");

      // BR-33: Cancelled asks first. Cancelling leaves the Ticket as it was.
      await operations.getByLabel("Current Status").selectOption("CANCELLED");
      const confirm = page.getByTestId("confirm-dialog");
      await expect(confirm).toBeVisible();
      await capture(page, "staff-ticket-detail", "confirm-dialog");
      await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(confirm).toBeHidden();

      await page.goto("/tickets/99999999");
      await expect(page.getByTestId("zg-state-not-found")).toBeVisible();
      await capture(page, "staff-ticket-detail", "not-found");

      // The same Ticket as its Requester sees it: the comment, no notes.
      await requester.page.goto(`/tickets/${ticket.id}`);
      await expect(requester.page.getByTestId("public-comments").getByText(comment)).toBeVisible();
      await capture(requester.page, "staff-ticket-detail", "requester");

      await requester.page.goto("/staff/tickets");
      await expect(requester.page.getByTestId("zg-state-forbidden")).toBeVisible();
      await capture(requester.page, "staff-queue", "forbidden");
    } finally {
      await requester.context.close();
    }

    // --- user-management/ -------------------------------------------------------
    await signOut(page);
    await signIn(page, ADMINISTRATOR);
    await expect(page.getByTestId(mobile ? "user-cards" : "user-table")).toBeVisible();
    // VIS-03: cards replace the user table too; tablet keeps all five columns (§9.2).
    if (mobile) await expect(page.getByTestId("user-table")).toHaveCount(0);
    await capture(page, "user-management", "list");

    await page.getByRole("button", { name: "+ Create User" }).click();
    const create = page.getByRole("dialog", { name: "Create User" });
    await expect(create).toBeVisible();
    await capture(page, "user-management", "create-dialog");

    await create.getByRole("button", { name: "Create User" }).click();
    await expect(create.getByText("Choose a role.")).toBeVisible();
    await capture(page, "user-management", "create-validation");

    // AC-17, refused by the server and shown on the field.
    await create.getByLabel(/^Name/).fill("Somebody Else");
    await create.getByLabel(/^Email/).fill(ACCOUNTS.staff.email);
    await create.getByLabel(/^Role/).selectOption("REQUESTER");
    await create.getByLabel("Active", { exact: true }).check();
    await create.getByLabel(/^Initial Password/).fill("Initial-2026!");
    await create.getByRole("button", { name: "Create User" }).click();
    await expect(create.getByText("An account with this email address already exists.")).toBeVisible();
    await capture(page, "user-management", "create-duplicate");
    await create.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(create).toBeHidden();

    const staffName = ACCOUNTS.staff.name;
    await page.getByRole("button", { name: `Edit ${staffName}`, exact: true }).click();
    const edit = page.getByRole("dialog", { name: `Edit ${staffName}`, exact: true });
    await expect(edit).toBeVisible();
    await capture(page, "user-management", "edit-dialog");

    // A guard rail from §9.4 as it really renders: the server's 409, on the
    // control that caused it, with that control back at its saved value.
    await edit.getByLabel(/^Email/).fill(ACCOUNTS.requester.email);
    await edit.getByRole("button", { name: "Save Changes" }).click();
    await expect(edit.getByText("An account with this email address already exists.")).toBeVisible();
    await expect(edit.getByLabel(/^Email/)).toHaveValue(ACCOUNTS.staff.email);
    await capture(page, "user-management", "edit-refusal");
    await edit.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(edit).toBeHidden();

    // The other two guard rails, explained before they could happen: on one's
    // own account Role and Status are disabled, with the reason beneath them.
    const me = await currentUser(page);
    await page.getByRole("button", { name: `Edit ${me.name}`, exact: true }).click();
    const own = page.getByRole("dialog", { name: `Edit ${me.name}`, exact: true });
    await expect(own.getByText("You cannot change your own role or status. Another administrator can.")).toBeVisible();
    await capture(page, "user-management", "edit-own");
    await own.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(own).toBeHidden();
  });
}
