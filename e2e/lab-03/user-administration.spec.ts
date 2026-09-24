import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS,
  ADMINISTRATOR,
  api,
  currentUser,
  fillTicketForm,
  openSignedIn,
  signIn,
  uniqueSuffix,
  uniqueSummary,
} from "../support/helpers.js";

// docs/lab-03/tests.md E2E-09..11 — Administrator user management in a real
// browser, and what it does to the people it manages.
//
// The Administrator is the seeded one, checked by the global setup: the
// last-Administrator refusal only exists for the last active Administrator
// acting on their own account (api-spec.md §9). Every account created here has
// an `e2e-` address, so the teardown removes it.

const userTable = (page: Page) => page.getByTestId("user-table");

/** The Email column of the list as it stands. */
const listedEmails = (page: Page) => userTable(page).locator("tbody tr td:nth-child(2)").allInnerTexts();

interface NewAccount {
  name: string;
  email: string;
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";
  active: boolean;
  password: string;
}

/** Fills the Create User dialog and submits it. Returns the dialog, open or not. */
async function submitCreateUser(page: Page, account: NewAccount) {
  await page.getByRole("button", { name: "+ Create User" }).click();
  const dialog = page.getByRole("dialog", { name: "Create User" });
  await dialog.getByLabel(/^Name/).fill(account.name);
  await dialog.getByLabel(/^Email/).fill(account.email);
  await dialog.getByLabel(/^Role/).selectOption(account.role);
  await dialog.getByLabel(account.active ? "Active" : "Inactive", { exact: true }).check();
  await dialog.getByLabel(/^Initial Password/).fill(account.password);
  await dialog.getByRole("button", { name: "Create User" }).click();
  return dialog;
}

async function openEdit(page: Page, name: string) {
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  return page.getByRole("dialog", { name: `Edit ${name}`, exact: true });
}

test.describe("Lab 3 — Administrator user management", () => {
  test("E2E-09 / AC-22, AC-18: an account the Administrator creates signs in and is forced through Change Password first", async ({
    page,
    browser,
  }) => {
    const suffix = uniqueSuffix();
    const account: NewAccount = {
      name: `Nadia Newcomer ${suffix}`,
      email: `e2e-created-${suffix}@example.edu`,
      role: "REQUESTER",
      active: true,
      password: `Initial-${suffix}`,
    };

    await signIn(page, ADMINISTRATOR);
    await expect(userTable(page)).toBeVisible();

    const dialog = await submitCreateUser(page, account);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("zg-toast")).toHaveText(`Account created for ${account.name}.`);

    // AC-22: in the list, with that role.
    await page.getByLabel("Search users").fill(suffix);
    await expect.poll(() => listedEmails(page)).toEqual([account.email]);
    const row = userTable(page).getByRole("row", { name: new RegExp(account.name) });
    await expect(row).toContainText("Requester");
    await expect(row).toContainText("Active");

    // AC-18: the new person, at their own desk.
    const newcomer = await openSignedIn(browser, account);
    try {
      await expect(newcomer.page).toHaveURL(/\/change-password$/);
      await expect(newcomer.page.getByTestId("zg-initial-password-banner")).toBeVisible();
      await newcomer.page.goto("/tickets/new");
      await expect(newcomer.page).toHaveURL(/\/change-password$/);

      const chosen = `Chosen-${suffix}`;
      await newcomer.page.locator("#currentPassword").fill(account.password);
      await newcomer.page.locator("#newPassword").fill(chosen);
      await newcomer.page.locator("#confirmPassword").fill(chosen);
      await newcomer.page.getByRole("button", { name: "Save New Password" }).click();

      await expect(newcomer.page).toHaveURL(/\/my-tickets$/);
      await expect(newcomer.page.getByRole("heading", { name: "My Tickets", level: 1 })).toBeVisible();
    } finally {
      await newcomer.context.close();
    }
  });

  test("E2E-10 / AC-17, AC-19, AC-20, AC-23, AC-27: search, role filter, edit, and every refusal the screen and the server make", async ({
    page,
  }) => {
    await signIn(page, ADMINISTRATOR);
    await expect(userTable(page)).toBeVisible();
    const me = await currentUser(page);

    // AC-27: part of an address…
    const fixtureEmails = Object.values(ACCOUNTS).map((account) => account.email);
    const search = page.getByLabel("Search users");
    await search.fill("e2e-");
    await expect
      .poll(async () => {
        const emails = await listedEmails(page);
        return fixtureEmails.every((email) => emails.includes(email)) && emails.every((email) => email.includes("e2e-"));
      })
      .toBe(true);

    // …narrowed by one role…
    const roleFilter = page.getByLabel("Role", { exact: true });
    await roleFilter.selectOption("IT_STAFF");
    await expect.poll(() => listedEmails(page)).toEqual([ACCOUNTS.staff.email]);

    // …and clearing both restores the full list, seeded accounts included.
    await search.fill("");
    await roleFilter.selectOption("");
    await expect
      .poll(async () => {
        const emails = await listedEmails(page);
        return emails.includes(ADMINISTRATOR.email) && emails.length > fixtureEmails.length;
      })
      .toBe(true);

    // AC-23: another account's name and role, saved and reflected in the list.
    const other = ACCOUNTS.otherRequester;
    const edit = await openEdit(page, other.name);
    await expect(edit.getByLabel(/^Email/)).toHaveValue(other.email);
    const renamed = `${other.name} Updated`;
    await edit.getByLabel(/^Name/).fill(renamed);
    await edit.getByLabel(/^Role/).selectOption("IT_STAFF");
    await edit.getByRole("button", { name: "Save Changes" }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByTestId("zg-toast")).toHaveText(`Changes to ${renamed} saved.`);
    await expect(userTable(page).getByRole("row", { name: new RegExp(renamed) })).toContainText("IT Staff");

    // AC-17: an address already in use, refused on the Email field with the dialog kept open.
    const duplicate = await submitCreateUser(page, {
      name: "Somebody Else",
      email: ACCOUNTS.staff.email,
      role: "REQUESTER",
      active: true,
      password: "Initial-2026!",
    });
    await expect(duplicate.getByText("An account with this email address already exists.")).toBeVisible();
    await expect(duplicate.getByLabel(/^Email/)).toHaveValue(ACCOUNTS.staff.email);
    await duplicate.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(duplicate).toBeHidden();

    // AC-20 needs another active Administrator, so that the refusal is about
    // whose account this is rather than about being the last one.
    const suffix = uniqueSuffix();
    const second: NewAccount = {
      name: `Second Administrator ${suffix}`,
      email: `e2e-second-admin-${suffix}@example.edu`,
      role: "ADMINISTRATOR",
      active: true,
      password: `Initial-${suffix}`,
    };
    await expect(await submitCreateUser(page, second)).toBeHidden();

    // On one's own account the screen does not offer it, and says why (§9.4)…
    const own = await openEdit(page, me.name);
    await expect(own.getByLabel(/^Role/)).toBeDisabled();
    await expect(own.getByLabel("Inactive", { exact: true })).toBeDisabled();
    await expect(own.getByText("You cannot change your own role or status. Another administrator can.")).toBeVisible();
    await own.getByRole("button", { name: "Cancel", exact: true }).click();

    // …and the server refuses the request the screen withholds, sent with this
    // browser's own session.
    const selfDeactivation = await api(page).patch(`/api/users/${me.id}`, { isActive: false });
    expect(selfDeactivation.status()).toBe(409);
    expect((await selfDeactivation.json()).error).toMatchObject({ code: "SELF_DEACTIVATION", field: "isActive" });

    // AC-19: deactivating the second Administrator through the screen leaves
    // this account as the last active one…
    const secondEdit = await openEdit(page, second.name);
    await secondEdit.getByLabel("Inactive", { exact: true }).check();
    await secondEdit.getByRole("button", { name: "Save Changes" }).click();
    await expect(secondEdit).toBeHidden();
    await expect(userTable(page).getByRole("row", { name: new RegExp(second.name) })).toContainText("Inactive");

    // …which can then be neither deactivated nor given another role.
    for (const [change, field] of [
      [{ isActive: false }, "isActive"],
      [{ role: "IT_STAFF" }, "role"],
    ] as const) {
      const refused = await api(page).patch(`/api/users/${me.id}`, change);
      expect(refused.status(), JSON.stringify(change)).toBe(409);
      expect((await refused.json()).error).toMatchObject({ code: "LAST_ACTIVE_ADMINISTRATOR", field });
    }
    // Still signed in, so still an active Administrator.
    expect((await currentUser(page)).role).toBe("ADMINISTRATOR");
  });

  test("E2E-11 / AC-24: a person deactivated while signed in is returned to Login at their next action, and cannot sign in again", async ({
    page,
    browser,
  }) => {
    const person = ACCOUNTS.deactivation;
    const victim = await openSignedIn(browser, person);
    try {
      await expect(victim.page.getByRole("heading", { name: "My Tickets", level: 1 })).toBeVisible();
      // They are halfway through raising a ticket…
      await fillTicketForm(victim.page, uniqueSummary("Cannot open the shared timetable"));

      // …when an Administrator deactivates the account.
      await signIn(page, ADMINISTRATOR);
      await page.getByLabel("Search users").fill(person.email);
      const edit = await openEdit(page, person.name);
      await edit.getByLabel("Inactive", { exact: true }).check();
      await edit.getByRole("button", { name: "Save Changes" }).click();
      await expect(edit).toBeHidden();

      // Their next action ends on Login, not on a failure they could retry.
      await victim.page.getByRole("button", { name: "Submit Ticket" }).click();
      await expect(victim.page).toHaveURL(/\/login$/);
      await expect(victim.page.getByRole("button", { name: "Sign In" })).toBeVisible();

      // And the account no longer signs in — refused in the same words as any
      // other failed sign-in (AC-05).
      await victim.page.locator("#email").fill(person.email);
      await victim.page.locator("#password").fill(person.password);
      await victim.page.getByRole("button", { name: "Sign In" }).click();
      await expect(victim.page.getByTestId("zg-login-error")).toHaveText("Email or password is incorrect.");
    } finally {
      await victim.context.close();
    }
  });
});
