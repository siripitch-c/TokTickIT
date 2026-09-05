import { expect, Page } from "@playwright/test";

// Shared steps for the Issue #17 end-to-end and visual specs.
// Selectors are the ones the screens already expose to assistive technology
// (labels, roles, accessible names) wherever possible, so a change that breaks
// a test is usually a change that would break a screen reader too. Test ids are
// used only where the element carries no accessible name of its own.

/** Seeded Requesters (server/prisma/seed.ts). A owns the tickets these specs create. */
export const REQUESTER_A = "Michael Brown";
export const REQUESTER_B = "Jennifer Anderson";

/**
 * Every ticket created by an end-to-end run carries this in its description,
 * exactly as the demo data carries `[demo]`. `npm run e2e:cleanup --prefix
 * server` deletes them afterwards, so a run leaves the database as it found it.
 */
export const E2E_MARKER = "[e2e]";

/** A 1x1 PNG — small, real, and of an allowed type (BR-26). */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Distinct per run, so a search for it can only match this run's ticket. */
export function uniqueSummary(label: string): string {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The Change Requester control exists twice (desktop header + mobile menu). */
export function changeRequesterButton(page: Page) {
  return page.locator('button:has-text("Change Requester"):visible');
}

/** Selects a Development Requester and waits for the shell to show its name. */
export async function chooseRequester(page: Page, name: string): Promise<void> {
  await page.goto("/select-requester");
  await expect(page.getByRole("heading", { name: "Select Development Requester" })).toBeVisible();
  await page.locator("#requester-select").selectOption({ label: name });
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByTestId("current-requester-name")).toHaveText(name);
}

/**
 * Fills Create Ticket, submits, and returns the generated Ticket Number. The
 * marker is appended here rather than by the caller, so every ticket an
 * end-to-end run creates is removable no matter which spec created it.
 */
export async function createTicket(
  page: Page,
  summary: string,
  description = "Raised by the Issue #17 end-to-end suite to exercise the full flow.",
): Promise<string> {
  await page.goto("/tickets/new");
  await expect(page.locator("#summary")).toBeVisible();

  await page.locator("#categoryId").selectOption({ index: 1 });
  await page.locator("#relatedSystemId").selectOption({ index: 1 });
  await page.locator("#requestedPriority").selectOption("MEDIUM");
  await page.locator("#summary").fill(summary);
  await page.locator("#description").fill(`${description} ${E2E_MARKER}`);

  await page.getByRole("button", { name: "Submit Ticket" }).click();

  const number = page.getByTestId("created-ticket-number");
  await expect(number).toBeVisible();
  return (await number.innerText()).trim();
}

/** Follows "View Ticket" from the success panel and returns the ticket's id. */
export async function openCreatedTicket(page: Page): Promise<string> {
  await page.getByRole("link", { name: /view ticket/i }).click();
  await expect(page.getByTestId("detail-ticket-number")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  expect(id, "the detail URL should end in the ticket id").toMatch(/^\d+$/);
  return id as string;
}

/**
 * §8.7 forbids clipped labels, and the tablet rule that hides the Category
 * column exists, in the stylesheet's own words, "to avoid a horizontal
 * scroll". A table that overflows inside its own `overflow-x: auto` wrapper
 * satisfies neither: the header is cut off until the reader thinks to drag it
 * sideways. The document-level check below cannot see this, because the
 * wrapper absorbs the overflow before it reaches the page.
 */
export async function expectNoClippedScroller(page: Page, step: string): Promise<void> {
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".zg-table-wrap"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.scrollWidth}px of table in a ${el.clientWidth}px wrapper`),
  );
  expect(clipped, `${step}: a column is cut off inside a scrolling container`).toEqual([]);
}

/**
 * ui-spec.md §8: "no unintended horizontal scroll" at any width. Asserted from
 * the document itself rather than by eye, so E2E-07 fails on a regression
 * instead of relying on someone noticing it in a screenshot.
 */
export async function expectNoHorizontalOverflow(page: Page, step: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${step}: the page scrolls horizontally (${overflow.scrollWidth}px of content in ${overflow.clientWidth}px)`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}
