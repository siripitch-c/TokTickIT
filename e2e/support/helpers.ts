import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { CLIENT_URL, SERVER_URL } from "./environment.js";

// Shared steps for the end-to-end and visual specs of Lab 2 (Issue #17) and
// Lab 3 (Issue #34). Moved here from e2e/lab-02/helpers.ts when Lab 3 replaced
// the Development Requester selector with real sign-in, so both labs sign in the
// same way.
//
// Selectors are the ones the screens already expose to assistive technology
// (labels, roles, accessible names) wherever possible, so a change that breaks
// a test is usually a change that would break a screen reader too. Test ids are
// used only where the element carries no accessible name of its own.

// ---------------------------------------------------------------------------
// Accounts (tests.md §6)
// ---------------------------------------------------------------------------

export interface Account {
  email: string;
  password: string;
  name: string;
}

type FixtureKey = "requester" | "otherRequester" | "staff" | "firstLogin" | "inactive" | "deactivation";

interface FixtureFile {
  password: string;
  accounts: Record<FixtureKey, { email: string; name: string }>;
  administrator: { email: string; password: string };
}

// The same file server/prisma/e2e-setup.ts creates the accounts from.
const fixtures = JSON.parse(readFileSync(new URL("./accounts.json", import.meta.url), "utf8")) as FixtureFile;

/** Made fresh for every run by the global setup, and removed by the teardown. */
export const ACCOUNTS = Object.fromEntries(
  Object.entries(fixtures.accounts).map(([key, account]) => [
    key,
    { email: account.email, name: account.name, password: fixtures.password },
  ]),
) as Record<FixtureKey, Account>;

/**
 * The seeded Administrator, checked by the global setup. Their name is not
 * fixed — somebody trying User Management may have renamed them — so specs read
 * it from the header instead.
 */
export const ADMINISTRATOR = { email: fixtures.administrator.email, password: fixtures.administrator.password };

/** Removes every e2e ticket and account, then makes the fixture accounts again. */
export function resetE2eData(): void {
  // One command string rather than a program plus an argument array: npm is a
  // .cmd shim on Windows, which Node refuses to spawn directly (see the
  // teardown).
  execSync("npm run e2e:cleanup --prefix server", { stdio: "inherit" });
  execSync("npm run e2e:setup --prefix server", { stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// Signing in and out
// ---------------------------------------------------------------------------

/** Signs in through the Login screen and waits for the shell to name the user. */
export async function signIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  // Present on the application and on the mandatory Change Password screen
  // alike. Attached rather than visible: below 768px it lives in the menu.
  await expect(page.getByTestId("current-user-name")).toBeAttached();
}

/** Opens the account actions: the Profile menu, or below 768px the navigation panel. */
export async function openAccountMenu(page: Page): Promise<void> {
  const hamburger = page.getByRole("button", { name: "Open navigation menu" });
  if (await hamburger.isVisible()) {
    await hamburger.click();
  } else {
    await page.getByRole("button", { name: /^Profile/ }).click();
  }
}

/** Logs out through the interface and waits for Login. */
export async function signOut(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.locator('button:has-text("Log Out"):visible').click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
}

/** A second person, in a browser context of their own. Close the context when done. */
export async function openSignedIn(
  browser: Browser,
  account: { email: string; password: string },
  viewport = { width: 1440, height: 900 },
): Promise<{ context: BrowserContext; page: Page }> {
  // A context made here does not inherit the config's `use` block.
  const context = await browser.newContext({ baseURL: CLIENT_URL, viewport });
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

/** The signed-in user as the server describes them, read with the page's own session. */
export async function currentUser(page: Page): Promise<{ id: number; name: string; role: string }> {
  const res = await api(page).get("/api/auth/me");
  expect(res.status(), "the page should be signed in").toBe(200);
  return (await res.json()).data;
}

// ---------------------------------------------------------------------------
// The API, with the browser's session
// ---------------------------------------------------------------------------

/**
 * Requests carrying the page's own session cookie: what this browser could
 * send, whatever the screen chooses to offer. Used to prove a refusal is the
 * server's, and to arrange data quickly where the screen is not what is under
 * test.
 */
export function api(page: Page) {
  return {
    get: (path: string) => page.request.get(`${SERVER_URL}${path}`),
    post: (path: string, data: unknown) => page.request.post(`${SERVER_URL}${path}`, { data }),
    patch: (path: string, data: unknown) => page.request.patch(`${SERVER_URL}${path}`, { data }),
  };
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * Every ticket created by an end-to-end run carries this in its description,
 * exactly as the demo data carries `[demo]`. `npm run e2e:cleanup --prefix
 * server` deletes them afterwards, so a run leaves the database as it found it.
 */
export const E2E_MARKER = "[e2e]";

/** A 1x1 PNG — small, real, and of an allowed type. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Distinct per run, so a search for it can only match what this run made. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function uniqueSummary(label: string): string {
  return `${label} ${uniqueSuffix()}`;
}

/** Fills Create Ticket without submitting it. The marker is appended here. */
export async function fillTicketForm(
  page: Page,
  summary: string,
  description = "Raised by the end-to-end suite to exercise the full flow.",
): Promise<void> {
  await page.goto("/tickets/new");
  await expect(page.locator("#summary")).toBeVisible();

  await page.locator("#categoryId").selectOption({ index: 1 });
  await page.locator("#relatedSystemId").selectOption({ index: 1 });
  await page.locator("#requestedPriority").selectOption("MEDIUM");
  await page.locator("#summary").fill(summary);
  await page.locator("#description").fill(`${description} ${E2E_MARKER}`);
}

/**
 * Fills Create Ticket, submits, and returns the generated Ticket Number. The
 * marker is appended rather than left to the caller, so every ticket an
 * end-to-end run creates is removable no matter which spec created it.
 */
export async function createTicket(page: Page, summary: string, description?: string): Promise<string> {
  await fillTicketForm(page, summary, description);
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
 * Creates a ticket through the API as the page's signed-in Requester, for specs
 * whose subject is what happens to a ticket rather than how it was raised.
 */
export async function createTicketViaApi(
  page: Page,
  summary: string,
  description = "Raised by the end-to-end suite as the starting point of a staff flow.",
  requestedPriority: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
): Promise<{ id: number; ticketNumber: string }> {
  const client = api(page);
  const categories = (await (await client.get("/api/categories")).json()).data as { id: number }[];
  const systems = (await (await client.get("/api/related-systems")).json()).data as { id: number }[];

  const res = await client.post("/api/tickets", {
    categoryId: categories[0].id,
    relatedSystemId: systems[0].id,
    requestedPriority,
    summary,
    description: `${description} ${E2E_MARKER}`,
  });
  expect(res.status(), `creating the ticket "${summary}"`).toBe(201);
  const { id, ticketNumber } = (await res.json()).data as { id: number; ticketNumber: string };
  return { id, ticketNumber };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * No clipped labels, and the tablet rule that hides columns exists "to avoid a
 * horizontal scroll". A table that overflows inside its own `overflow-x: auto`
 * wrapper satisfies neither: the header is cut off until the reader thinks to
 * drag it sideways. The document-level check below cannot see this, because the
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
 * "No clipped labels, overlap": a read-only value taller than its frame spills
 * over whatever follows it. The page does not scroll because of it, so the
 * horizontal check cannot see it either — Issue #34 found one only by reading a
 * screenshot, and this is what now finds the next.
 */
export async function expectNoSpilledText(page: Page, step: string): Promise<void> {
  const spilled = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".zg-field--readonly"))
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => `"${(el.textContent ?? "").trim().slice(0, 40)}"`),
  );
  expect(spilled, `${step}: text spills out of a read-only field`).toEqual([]);
}

/**
 * "No unintended horizontal scroll" at any width. Asserted from the document
 * itself rather than by eye, so a layout regression fails the run instead of
 * relying on someone noticing it in a screenshot.
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
