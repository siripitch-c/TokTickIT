import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  ADMINISTRATOR,
  api,
  createTicketViaApi,
  currentUser,
  openSignedIn,
  resetE2eData,
  signIn,
  signOut,
  uniqueSummary,
} from "../support/helpers.js";

// docs/lab-04/tests.md E2E-01, E2E-03, E2E-04, E2E-05; specification.md FR-01
// to FR-07, BR-02, BR-05, AC-01, AC-05, AC-07.
//
// The work log in a real browser. The API suites prove the rules and the
// component suites prove the screen; these prove that a person can get from one
// to the other - that what is typed into the form is what comes back from the
// server, survives a reload, and is visible to the right people.

test.beforeEach(() => {
  resetE2eData();
});

const panel = (page: Page) => page.getByTestId("actions-taken");

/** Fills and submits the inline create form, through the screen. */
async function addActionThroughTheForm(
  page: Page,
  description: string,
  options: { result?: string; status?: "Planned" | "In Progress" | "Completed" } = {},
) {
  await panel(page).getByRole("button", { name: "Add Action" }).click();
  await page.getByLabel(/What was done/i).fill(description);
  if (options.result) await page.getByLabel(/^Result/i).fill(options.result);
  if (options.status) await page.getByLabel(/^Status/i).selectOption({ label: options.status });
  await page.getByRole("button", { name: "Save action" }).click();
  await expect(page.getByLabel(/What was done/i)).toHaveCount(0);
}

test.describe("Lab 4 — the Actions Taken work log", () => {
  test("E2E-01 / AC-01, FR-01: a staff member records an Action and it comes back as theirs", async ({ page }) => {
    const summary = uniqueSummary("Lectern microphone cuts out mid-lecture");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, summary);
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);
    const me = await currentUser(page);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole("heading", { name: "Actions Taken (0)" })).toBeVisible();

    const description = "Swapped the lectern microphone for a known good one and retested.";
    await addActionThroughTheForm(page, description, {
      result: "The replacement held for a full lecture.",
      status: "Completed",
    });

    // FR-02: the performer is the session, not a field anybody chose.
    const row = page.getByRole("listitem").filter({ hasText: description });
    await expect(row).toBeVisible();
    await expect(row).toContainText(me.name);
    await expect(row).toContainText("Completed");

    // And it is a record, not a rendering: the same thing is there after a
    // reload, which is the half a component test cannot reach.
    await page.reload();
    await expect(panel(page).getByRole("heading", { name: "Actions Taken (1)" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: description })).toContainText(me.name);

    // What the write changed, and what it did not. BR-26 gives the Ticket and
    // the Action a version each, and this wrote the Action - so `openActionCount`
    // moves and the Ticket's own version does not. A staff member holding the
    // Ticket is still holding a valid version; what they would be refused is the
    // resolution, by the gate reading the live count rather than by a conflict.
    const after = (await (await api(page).get(`/api/tickets/${ticket.id}`)).json()).data as {
      version: number;
      openActionCount: number;
    };
    expect(after.version, "an Action is not a write to the Ticket").toBe(1);
    // Completed, so nothing is open - the count the resolution gate reads.
    expect(after.openActionCount).toBe(0);
  });

  test("E2E-03 / AC-05: one Action completed and another cancelled, both still right after a reload", async ({
    page,
  }) => {
    const summary = uniqueSummary("Projector shows no signal from the laptop");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, summary);
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(panel(page)).toBeVisible();

    const finished = "Reseated the HDMI cable at the lectern and retested the laptop.";
    const abandoned = "Considered replacing the projector lamp before testing the cable.";
    await addActionThroughTheForm(page, finished);
    await addActionThroughTheForm(page, abandoned);

    // Complete: BR-06 wants a result, and §6.4 opens the form on the field that
    // is missing rather than disabling the button and hiding the reason.
    const finishedRow = page.getByRole("listitem").filter({ hasText: finished });
    await finishedRow.getByRole("button", { name: "Complete" }).click();
    await page.getByLabel(/^Result/i).fill("The cable was loose; the picture returned immediately.");
    await page.getByRole("button", { name: "Save action" }).click();
    // Still Planned, and that is §6.4 working: the first press opened the form
    // "rather than sending a request", and saving a result is a save. Now that
    // a result exists, Complete does what it says.
    await expect(finishedRow).toContainText("Planned");
    await finishedRow.getByRole("button", { name: "Complete" }).click();
    await expect(finishedRow).toContainText("Completed");

    // Cancel: a confirmation first, because it cannot be undone (BR-05).
    const abandonedRow = page.getByRole("listitem").filter({ hasText: abandoned });
    await abandonedRow.getByRole("button", { name: "Cancel action" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel action" }).click();
    await expect(abandonedRow).toContainText("Cancelled");

    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: finished })).toContainText("Completed");
    await expect(page.getByRole("listitem").filter({ hasText: abandoned })).toContainText("Cancelled");

    // BR-05: both are final. Neither offers a way back, to anybody.
    for (const text of [finished, abandoned]) {
      const row = page.getByRole("listitem").filter({ hasText: text });
      await expect(row.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Complete" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Cancel action" })).toHaveCount(0);
    }
  });

  test("E2E-04 / AC-07: the Requester reads the log and is offered nothing to press", async ({ page }) => {
    const summary = uniqueSummary("Shared printer rejects every job from my laptop");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, summary);
    await signOut(page);

    const description = "Cleared the stuck queue on the print server and sent a test page.";
    await signIn(page, ACCOUNTS.staff);
    await page.goto(`/tickets/${ticket.id}`);
    await addActionThroughTheForm(page, description);
    await signOut(page);

    await signIn(page, ACCOUNTS.requester);
    await page.goto(`/tickets/${ticket.id}`);
    await expect(panel(page)).toBeVisible();

    // Visible: the Requester is told what was done for them (FR-07).
    await expect(page.getByRole("listitem").filter({ hasText: description })).toBeVisible();

    // And nothing to press anywhere in the panel. Asserted control by control
    // rather than by counting buttons, so the failure names which one appeared.
    for (const name of ["Add Action", "Edit", "Complete", "Cancel action", "Save action"]) {
      await expect(panel(page).getByRole("button", { name }), `the Requester sees "${name}"`).toHaveCount(0);
    }

    // The server agrees, which is where the rule actually lives (API-ACTION-14).
    const refused = await api(page).post(`/api/tickets/${ticket.id}/actions`, {
      description: "A Requester should not be able to write this.",
      followUpRequired: false,
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("FORBIDDEN");
  });

  test("E2E-05 / BR-02: two staff record on one Ticket, and the owner does not change", async ({ page, browser }) => {
    const summary = uniqueSummary("Course materials will not upload to LEB2");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, summary);
    await signOut(page);

    // The first staff member claims it, so there is an owner to leave alone.
    await signIn(page, ACCOUNTS.staff);
    const stella = await currentUser(page);
    await page.goto(`/tickets/${ticket.id}`);
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByLabel(/Ticket Owner/i)).toHaveValue(String(stella.id));

    const first = "Reproduced the upload failure with a 40 MB file and captured the request.";
    await addActionThroughTheForm(page, first);

    // The second works in a window of their own, as two people at two desks.
    const other = await openSignedIn(browser, ADMINISTRATOR);
    try {
      const anong = await currentUser(other.page);
      await other.page.goto(`/tickets/${ticket.id}`);
      await expect(panel(other.page)).toBeVisible();

      // BR-02: an Action is attributed to whoever recorded it, not to the owner.
      await expect(other.page.getByRole("listitem").filter({ hasText: first })).toContainText(stella.name);

      const second = "Raised the upload size limit on the LEB2 staging instance and asked for a retest.";
      await addActionThroughTheForm(other.page, second);
      await expect(other.page.getByRole("listitem").filter({ hasText: second })).toContainText(anong.name);

      // Two performers, one Ticket, and the owner is still the first one.
      const stored = (await (await api(other.page).get(`/api/tickets/${ticket.id}`)).json()).data as {
        ownerId: number;
      };
      expect(stored.ownerId, "recording an Action must not claim the Ticket").toBe(stella.id);
    } finally {
      await other.context.close();
    }

    // Both rows are on the first person's screen too, once it is reloaded.
    await page.reload();
    await expect(panel(page).getByRole("heading", { name: "Actions Taken (2)" })).toBeVisible();
  });
});
