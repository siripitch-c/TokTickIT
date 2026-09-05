import { execSync } from "node:child_process";
import { test } from "@playwright/test";
import {
  PNG_BYTES,
  REQUESTER_A,
  chooseRequester,
  createTicket,
  expectNoClippedScroller,
  expectNoHorizontalOverflow,
  openCreatedTicket,
} from "./helpers.js";

// tests.md VIS-01..03 — the screenshots the responsive and visual checklist
// (tests.md §5) is filled in against, at the three widths ui-spec.md §8 defines.
//
// They are mostly evidence: committed under artifacts/lab-02/screenshots/ and
// read by a person against ui-spec.md, because "does this look right" is not a
// question a machine answers. The one part of AC-14 that a machine can answer
// — no unintended horizontal scrolling, at any width, on any screen — is
// asserted here as each shot is taken, so it fails the run rather than waiting
// for someone to notice it in a picture.

const SHOTS = "artifacts/lab-02/screenshots";

// The ids are written out rather than derived from the index: every other test
// in this repository can be found by grepping for its tests.md id, and one
// built from a template could not be.
// Before each viewport, not once before all three: each one creates a ticket of
// its own, so running this only once would leave the tablet and mobile My
// Tickets shots carrying whatever the desktop pass had just created.
test.beforeEach(() => {
  // The flow spec runs first and its tickets live until the global teardown.
  // These screenshots are submitted evidence, so the list they show should be
  // the demo data a reader can recognise, not another spec's fixtures.
  execSync("npm run e2e:cleanup --prefix server", { stdio: "inherit" });
});

const VIEWPORTS = [
  { id: "VIS-01", name: "desktop", width: 1440, height: 900 },
  { id: "VIS-02", name: "tablet", width: 768, height: 1024 },
  { id: "VIS-03", name: "mobile", width: 375, height: 812 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.id}: capture every screen and state at ${viewport.width}px (${viewport.name})`, async ({
    page,
  }) => {
    test.slow(); // four screens, several states, one real ticket created
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const capture = async (screen: string, state = "") => {
      const where = `${screen}${state ? ` (${state})` : ""} at ${viewport.width}px`;
      await expectNoHorizontalOverflow(page, where);
      await expectNoClippedScroller(page, where);
      await page.screenshot({
        path: `${SHOTS}/${screen}/${viewport.name}${state ? `-${state}` : ""}.png`,
        fullPage: true,
      });
    };

    // --- Requester Selection -------------------------------------------------
    await page.goto("/select-requester");
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole("heading", { name: "Select Development Requester" }).waitFor();
    await capture("select-requester");

    await chooseRequester(page, REQUESTER_A);

    // --- My Tickets ----------------------------------------------------------
    // Captured before this spec creates anything, so the list is the seeded
    // demo data (Michael Brown owns 20 tickets, i.e. two pages) rather than
    // fixtures with random suffixes in their summaries.
    await page.goto("/my-tickets");
    await page.getByRole("heading", { name: "My Tickets" }).waitFor();
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

    // Wording that reads like a real request rather than a fixture: this
    // ticket is what the Create Ticket success and Ticket Detail screenshots
    // show, and those are submitted as evidence. No unique suffix is needed —
    // unlike the flow spec, nothing here searches for it by name.
    // tests.md §8 asked for the busy state to be captured deliberately: a
    // localhost POST resolves in milliseconds, and the fill defect found on
    // 2026-09-03 was only visible by delaying the request by hand. Holding the
    // route open makes the state last long enough to photograph, so the button
    // appearance is evidence rather than something someone has to catch live.
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
    await capture("ticket-detail", "attachment-limit");
  });
}
