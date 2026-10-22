import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  api,
  createTicketViaApi,
  currentUser,
  resetE2eData,
  signIn,
  signOut,
  uniqueSummary,
} from "../support/helpers.js";

// docs/lab-04/tests.md E2E-06, E2E-07, E2E-08; specification.md FR-12 to FR-20,
// AC-15, AC-17, AC-19, AC-21, AC-22.
//
// Both dashboards in a browser. The numbers themselves are proven against the
// database at the API (API-DASHS-*, API-DASHR-*); what these add is the part
// only a browser can reach - that pressing a card arrives at a list holding
// exactly what the card counted, which is the disagreement AC-17 forbids and
// the defect a card press found in Issue #50.

test.beforeEach(() => {
  resetE2eData();
});

/** The total the list under a table reports, from "Showing 1 to 10 of 23 tickets". */
async function listedTotal(page: Page): Promise<number> {
  const summary = page.getByTestId("pagination-summary");
  await expect(summary).toBeVisible();
  const text = (await summary.innerText()).replace(/,/g, "");
  const match = text.match(/of\s+(\d+)/i);
  expect(match, `could not read a total from "${text}"`).not.toBeNull();
  return Number(match![1]);
}

test.describe("Lab 4 — the dashboards", () => {
  test("E2E-06 / AC-15, AC-17: every staff card opens a queue holding exactly what it counted", async ({ page }) => {
    // Tickets of its own, so the cards are not all zero on a reset database.
    await signIn(page, ACCOUNTS.requester);
    const unassigned = await createTicketViaApi(page, uniqueSummary("Wi-Fi drops in the west building"));
    await createTicketViaApi(page, uniqueSummary("Email signature images arrive as attachments"));
    await signOut(page);

    await signIn(page, ACCOUNTS.staff);
    const me = await currentUser(page);

    // One claimed and marked High, so Assigned to me and High IT priority are
    // not zero either - a card reading 0 would make the comparison vacuous.
    const read = await api(page).get(`/api/tickets/${unassigned.id}`);
    const { version } = (await read.json()).data as { version: number };
    const claimed = await api(page).patch(`/api/tickets/${unassigned.id}/owner`, { version, ownerId: me.id });
    expect(claimed.status(), "claiming the Ticket").toBe(200);
    const afterClaim = (await (await api(page).get(`/api/tickets/${unassigned.id}`)).json()).data as {
      version: number;
    };
    const prioritised = await api(page).patch(`/api/tickets/${unassigned.id}/it-priority`, {
      version: afterClaim.version,
      itPriority: "HIGH",
    });
    expect(prioritised.status(), "raising the IT Priority").toBe(200);

    await page.goto("/dashboard");
    await expect(page.getByTestId("metric-grid")).toBeVisible();

    // Each card, in turn: read the number, press it, and compare the number to
    // the total of the list that opens. The queue's own filters do the work;
    // the card only has to agree with them.
    const cards = ["unassigned", "assigned-to-me", "waiting-for-requester", "high-it-priority"];
    for (const card of cards) {
      await page.goto("/dashboard");
      const tile = page.getByTestId(`metric-${card}`);
      await expect(tile, `the ${card} card`).toBeVisible();
      const shown = Number((await tile.getByText(/^\d+$/).innerText()).trim());

      await tile.click();
      await expect(page, `${card} should open the queue`).toHaveURL(/\/staff\/tickets\?/);
      const total = await listedTotal(page);
      expect(total, `the ${card} card says ${shown} and its queue holds ${total}`).toBe(shown);
    }

    // The by-status strip answers the same way: a pair's number is the number
    // of rows the queue shows for that status.
    await page.goto("/dashboard");
    const pair = page.getByTestId("by-status").getByRole("link").first();
    const pairText = await pair.innerText();
    const pairCount = Number((pairText.match(/(\d+)\s*$/) ?? ["", "0"])[1]);
    await pair.click();
    await expect(page).toHaveURL(/status=/);
    expect(await listedTotal(page)).toBe(pairCount);
  });

  test("E2E-07 / AC-19, AC-21: a Requester sees only their own, and an empty desk invites a Ticket", async ({
    page,
    browser,
  }) => {
    const mine = uniqueSummary("Laptop will not wake from sleep");
    await signIn(page, ACCOUNTS.requester);
    const ticket = await createTicketViaApi(page, mine);

    // Somebody else's Ticket, which must appear in no count and no list.
    const theirs = uniqueSummary("Monitor flickers when docked");
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    try {
      await signIn(otherPage, ACCOUNTS.otherRequester);
      await createTicketViaApi(otherPage, theirs);
    } finally {
      await other.close();
    }

    await page.goto("/dashboard");
    await expect(page.getByTestId("metric-grid")).toBeVisible();

    // AC-19: theirs is nowhere on the screen, counted or listed.
    await expect(page.getByText(theirs)).toHaveCount(0);
    await expect(page.getByTestId("recently-updated")).toContainText(ticket.ticketNumber);

    // AC-17 again, from the Requester's side: the card and the list agree.
    const open = page.getByTestId("metric-openTickets");
    const shown = Number((await open.getByText(/^\d+$/).innerText()).trim());
    await open.click();
    await expect(page).toHaveURL(/\/my-tickets\?status=open/);
    expect(await listedTotal(page)).toBe(shown);

    // AC-21: an account with nothing at all. A Requester who has not raised
    // anything is the honest way to reach it - no stubbed payload. The
    // `deactivation` fixture is the one used, because it is the only other
    // active Requester the suite does not give a Ticket to: `otherRequester`
    // has one above, `firstLogin` cannot pass the password gate, and
    // `inactive` cannot sign in at all.
    const empty = await browser.newContext();
    const emptyPage = await empty.newPage();
    try {
      await signIn(emptyPage, ACCOUNTS.deactivation);
      await emptyPage.goto("/dashboard");
      await expect(emptyPage.getByTestId("metric-grid")).toBeVisible();
      for (const card of ["openTickets", "waitingForMe", "resolvedAwaitingConfirmation"]) {
        await expect(emptyPage.getByTestId(`metric-${card}`)).toContainText("0");
      }
      await expect(emptyPage.getByTestId("attention")).toContainText("Nothing needs you right now.");
      await expect(emptyPage.getByTestId("create-ticket-cta")).toBeVisible();
    } finally {
      await empty.close();
    }
  });

  test("E2E-08 / AC-22: neither role can reach the other's dashboard data", async ({ page }) => {
    await signIn(page, ACCOUNTS.requester);

    // One route renders the screen the role may see (ui-spec §3), so a
    // Requester at /dashboard gets their own - that is the design, not a leak.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByTestId("metric-openTickets")).toBeVisible();
    await expect(page.getByTestId("by-status"), "the staff strip is not a Requester's").toHaveCount(0);

    // The refusal that matters is the server's.
    const staffData = await api(page).get("/api/dashboard/staff");
    expect(staffData.status()).toBe(403);
    expect((await staffData.json()).error.code).toBe("FORBIDDEN");

    // FR-20: asking about somebody else is answered with your own data rather
    // than refused, because a 403 would confirm that the person exists.
    const own = await (await api(page).get("/api/dashboard/requester")).json();
    const nosy = await api(page).get("/api/dashboard/requester?requesterId=1");
    expect(nosy.status(), "naming somebody else must not be refused").toBe(200);
    expect(await nosy.json()).toEqual(own);

    await signOut(page);
    await signIn(page, ACCOUNTS.staff);
    await page.goto("/dashboard");
    await expect(page.getByTestId("by-status")).toBeVisible();
    await expect(page.getByTestId("metric-openTickets"), "the Requester cards are not staff's").toHaveCount(0);

    const requesterData = await api(page).get("/api/dashboard/requester");
    expect(requesterData.status()).toBe(403);
    expect((await requesterData.json()).error.code).toBe("FORBIDDEN");

    // And nothing at all without a session (BR-14).
    await signOut(page);
    for (const url of ["/api/dashboard/staff", "/api/dashboard/requester"]) {
      const res = await api(page).get(url);
      expect(res.status(), url).toBe(401);
      expect((await res.json()).error.code, url).toBe("UNAUTHENTICATED");
    }
  });
});
