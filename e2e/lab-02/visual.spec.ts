import { expect, test } from "@playwright/test";
import {
  ACCOUNTS,
  PNG_BYTES,
  createTicket,
  createTicketViaApi,
  expectNoClippedScroller,
  expectNoHorizontalOverflow,
  expectNoSpilledText,
  openCreatedTicket,
  resetE2eData,
  signIn,
} from "../support/helpers.js";

// docs/lab-02/tests.md VIS-01..03 — the screenshots the responsive and visual
// checklist (tests.md §5) is filled in against, at the three widths ui-spec.md
// §8 defines.
//
// They are mostly evidence: committed under artifacts/lab-02/screenshots/ and
// read by a person against ui-spec.md, because "does this look right" is not a
// question a machine answers. The one part of AC-14 that a machine can answer
// — no unintended horizontal scrolling, at any width, on any screen — is
// asserted here as each shot is taken, so it fails the run rather than waiting
// for someone to notice it in a picture.
//
// Updated in Lab 3, Issue #34 (lab-03/specification.md §10). The Requester now
// signs in as an `e2e-` fixture account instead of being chosen, so the
// Requester Selection screenshots are gone with the screen itself (AC-25), and
// My Tickets is photographed over tickets this spec raises rather than over the
// demo data, whose owner's password is no longer known to the suite. The Lab 3
// screens have their own spec, e2e/lab-03/visual.spec.ts.

const SHOTS = "artifacts/lab-02/screenshots";

// Before each viewport: every e2e ticket and account is removed and the
// accounts are made again, so each width photographs the same list rather than
// whatever the previous width had just created.
test.beforeEach(() => {
  resetE2eData();
});

// Wording that reads like real requests: these are what the My Tickets
// screenshots show, and those are submitted as evidence.
const LIST: { summary: string; description: string; priority: "LOW" | "MEDIUM" | "HIGH" }[] = [
  { summary: "Laptop battery drains within an hour", description: "The battery falls from full to empty in about an hour of light use.", priority: "HIGH" },
  { summary: "Cannot print to the second-floor printer", description: "Print jobs sit in the queue and never reach the printer.", priority: "MEDIUM" },
  { summary: "Email attachments over 10 MB bounce", description: "Messages with large attachments come back as undeliverable.", priority: "MEDIUM" },
  { summary: "VPN asks for a password twice", description: "The VPN client prompts for the password again right after signing in.", priority: "LOW" },
  { summary: "LEB2 course page loads without images", description: "Every course page shows broken image icons in place of pictures.", priority: "MEDIUM" },
  { summary: "Campus Wi-Fi disconnects in lecture hall B", description: "The connection drops several times during each lecture.", priority: "HIGH" },
  { summary: "Grade submission page times out", description: "Saving grades for a large class shows a timeout message.", priority: "HIGH" },
  { summary: "Request access to the research drive", description: "I need read access to the department research drive for my project.", priority: "LOW" },
  { summary: "Monitor shows a yellow tint", description: "The office monitor has a yellow tint that calibration does not fix.", priority: "LOW" },
  { summary: "Software licence expired for the statistics package", description: "The statistics package reports an expired licence on start-up.", priority: "MEDIUM" },
  { summary: "Keyboard keys stick after a spill", description: "Several keys stick after a small coffee spill yesterday.", priority: "MEDIUM" },
  { summary: "Calendar invites arrive an hour late", description: "Meeting invitations show up an hour after they were sent.", priority: "LOW" },
];

const VIEWPORTS = [
  { id: "VIS-01", name: "desktop", width: 1440, height: 900 },
  { id: "VIS-02", name: "tablet", width: 768, height: 1024 },
  { id: "VIS-03", name: "mobile", width: 375, height: 812 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.id}: capture every screen and state at ${viewport.width}px (${viewport.name})`, async ({
    page,
  }) => {
    test.slow(); // three screens, several states, thirteen real tickets created
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const capture = async (screen: string, state = "") => {
      const where = `${screen}${state ? ` (${state})` : ""} at ${viewport.width}px`;
      await expectNoHorizontalOverflow(page, where);
      await expectNoClippedScroller(page, where);
      await expectNoSpilledText(page, where);
      await page.screenshot({
        path: `${SHOTS}/${screen}/${viewport.name}${state ? `-${state}` : ""}.png`,
        fullPage: true,
      });
    };

    await signIn(page, ACCOUNTS.requester);
    for (const ticket of LIST) {
      await createTicketViaApi(page, ticket.summary, ticket.description, ticket.priority);
    }

    // --- My Tickets ----------------------------------------------------------
    // Twelve tickets, i.e. two pages at the default size of ten.
    await page.goto("/my-tickets");
    await page.getByRole("heading", { name: "My Tickets" }).waitFor();
    await page.getByTestId("pagination-summary").waitFor();
    await capture("my-tickets");

    await page.locator("#ticket-search").fill("zzz-nothing-matches-this-zzz");
    await page.getByTestId("zg-state-no-results").waitFor();
    await capture("my-tickets", "no-results");

    // --- Create Ticket: initial, validation failure, busy, success ------------
    await page.goto("/tickets/new");
    await page.locator("#summary").waitFor();
    await capture("create-ticket");

    // Submitting an empty form shows every field message at once (AC-04), which
    // is what the checklist item about validation placement is judged on.
    await page.getByRole("button", { name: "Submit Ticket" }).click();
    await page.getByText("Please choose a category.").first().waitFor();
    await capture("create-ticket", "validation");

    // BR-26/BR-27: a disallowed type and an oversized file are states of this
    // screen per ui-spec §5.4, and §5 asks for every state. Both are refused
    // before any upload is attempted, so one shot carries both reasons.
    await page.locator("#attachments").setInputFiles([
      { name: "meeting-notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an allowed type") },
      { name: "screen-recording.png", mimeType: "image/png", buffer: Buffer.alloc(6 * 1024 * 1024) },
    ]);
    await page.locator(".zg-attachment-row--invalid").nth(1).waitFor();
    await capture("create-ticket", "attachment-rejected");

    // tests.md §8 asked for the busy state to be captured deliberately: a
    // localhost POST resolves in milliseconds. Holding the route open makes the
    // state last long enough to photograph.
    await page.route("**/api/tickets", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return route.continue();
    });

    const submitted = createTicket(
      page,
      "Laptop will not connect to the meeting room display",
      "The external display stays black when the laptop is plugged into the dock in the meeting room.",
    );
    await page.getByRole("button", { name: /submitting/i }).waitFor();
    await capture("create-ticket", "busy");

    await submitted;
    await page.unroute("**/api/tickets");
    await page.getByTestId("created-ticket-number").waitFor();
    await capture("create-ticket", "success");

    // --- Ticket Detail, with an attachment panel that has something in it -----
    await openCreatedTicket(page);
    await page.getByRole("button", { name: /add attachment/i }).click();
    await page.locator("#add-attachment").setInputFiles({
      name: "evidence.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await page.getByRole("heading", { name: /attachments \(1 active\)/i }).waitFor();
    await capture("ticket-detail");

    // The confirm modal is a state of this screen, and the one place a
    // destructive action and a disabled primary button appear together.
    await page.getByRole("button", { name: "Remove evidence.png" }).click();
    await page.getByTestId("remove-modal").waitFor();
    await capture("ticket-detail", "remove-modal");
    await page.getByRole("button", { name: "Cancel" }).click();

    // BR-28 at the limit: §7.1 requires the unavailable control to explain
    // itself, and whether it does is something only a picture can show.
    await page.getByRole("button", { name: /add attachment/i }).click();
    await page.locator("#add-attachment").setInputFiles(
      [2, 3, 4, 5].map((n) => ({
        name: `evidence-${n}.png`,
        mimeType: "image/png",
        buffer: PNG_BYTES,
      })),
    );
    await page.getByRole("heading", { name: /attachments \(5 active\)/i }).waitFor();
    await page.getByTestId("zg-attachment-limit").waitFor();
    // The count includes uploads still in flight, so it reaches five before the
    // last row has landed. Found in the Issue #34 screenshots: without this the
    // limit state was photographed with one row still "Uploading…".
    await expect(page.getByText("Uploading…")).toHaveCount(0);
    await capture("ticket-detail", "attachment-limit");
  });
}
