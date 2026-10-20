import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS, ADMINISTRATOR, api, signIn, signOut, uniqueSuffix } from "../support/helpers.js";

// docs/lab-03/tests.md E2E-01..04 — signing in, the mandatory password change,
// the one refusal message, and what each role can reach. They run against the
// real client, API and database.
//
// What a role *may* do is proven at the API (authorization.api.test.ts). What
// these prove is the seam the component tests and the API tests each mock away:
// that the application a person actually meets agrees with the server, and that
// where the screen withholds something the server refuses it too.

const mainNavigation = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("Lab 3 — authentication and role access", () => {
  test("E2E-01 / AC-01, AC-06, lab-04 FR-25: every role lands on the Dashboard and reaches its own screen from there, and after logout neither the address nor the API opens again", async ({
    page,
  }) => {
    // lab-04 FR-25: every role lands on `/dashboard` now. `own` is still the
    // role's own working screen, reached from the navigation and used for the
    // signed-out check below, so each role is still exercised on something
    // only it may see.
    const roles = [
      {
        who: "a Requester",
        account: ACCOUNTS.requester,
        own: "/my-tickets",
        use: async () => {
          await mainNavigation(page).getByRole("link", { name: "Create Ticket" }).click();
          await expect(page.getByRole("heading", { name: "Create Ticket", level: 1 })).toBeVisible();
        },
      },
      {
        who: "IT Staff",
        account: ACCOUNTS.staff,
        own: "/staff/tickets",
        use: async () => {
          await mainNavigation(page).getByRole("link", { name: "Ticket Queue" }).click();
          await expect(page.getByTestId("queue-table")).toBeVisible();
        },
      },
      {
        who: "an Administrator",
        account: ADMINISTRATOR,
        own: "/admin/users",
        use: async () => {
          await mainNavigation(page).getByRole("link", { name: "User Management" }).click();
          await expect(page.getByTestId("user-table")).toBeVisible();
        },
      },
    ];

    for (const role of roles) {
      await signIn(page, role.account);
      await expect(page, `${role.who} lands on the Dashboard`).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
      await role.use();
      expect((await api(page).get("/api/auth/me")).status(), `${role.who} is signed in`).toBe(200);

      await signOut(page);

      // AC-06: the address that worked a moment ago now leads to Login…
      await page.goto(role.own);
      await expect(page, `${role.who} after logout`).toHaveURL(/\/login$/);
      // …and the session behind it is gone at the server, not merely forgotten
      // by the client.
      expect((await api(page).get("/api/auth/me")).status(), `${role.who} after logout`).toBe(401);
    }
  });

  test("E2E-02 / AC-02: an initial password opens only Change Password, until a valid new password is saved", async ({
    page,
  }) => {
    const account = ACCOUNTS.firstLogin;
    await signIn(page, account);

    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByTestId("zg-initial-password-banner")).toBeVisible();
    await expect(mainNavigation(page).getByRole("link")).toHaveCount(0);

    // A typed address comes straight back here…
    await page.goto("/my-tickets");
    await expect(page).toHaveURL(/\/change-password$/);
    // …and the server refuses the application's endpoints regardless.
    const refused = await api(page).get("/api/tickets");
    expect(refused.status()).toBe(403);
    expect((await refused.json()).error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    // An invalid new password is refused on the screen, and the gate stays shut.
    await page.locator("#currentPassword").fill(account.password);
    await page.locator("#newPassword").fill("short");
    await page.locator("#confirmPassword").fill("short");
    await page.getByRole("button", { name: "Save New Password" }).click();
    await expect(page.locator("#newPassword-error")).toHaveText("Password must be between 8 and 72 characters.");
    await expect(page).toHaveURL(/\/change-password$/);

    const chosen = `Chosen-${uniqueSuffix()}`;
    await page.locator("#newPassword").fill(chosen);
    await page.locator("#confirmPassword").fill(chosen);
    await page.getByRole("button", { name: "Save New Password" }).click();

    // ui-spec.md §5: the confirmation, then the application — its landing
    // screen, with its navigation, and its endpoints open.
    await expect(page.getByTestId("zg-state-success")).toBeVisible();
    // lab-04 FR-25: the landing screen is the Dashboard for every role.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(mainNavigation(page).getByRole("link", { name: "My Tickets" })).toBeVisible();
    expect((await api(page).get("/api/tickets")).status()).toBe(200);
  });

  test("E2E-03 / AC-05: a wrong password, an unknown address and a deactivated account look exactly the same", async ({
    page,
  }) => {
    // Held for half a second, so the busy state can be seen in all three cases
    // rather than assumed from a response that arrived first.
    await page.route("**/api/auth/login", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    const attempts = [
      { what: "a wrong password", email: ACCOUNTS.requester.email, password: "Not-The-Password-1" },
      { what: "an unknown address", email: `e2e-nobody-${uniqueSuffix()}@example.edu`, password: ACCOUNTS.requester.password },
      { what: "a deactivated account", email: ACCOUNTS.inactive.email, password: ACCOUNTS.inactive.password },
    ];

    const messages: string[] = [];
    for (const attempt of attempts) {
      await page.goto("/login");
      await page.locator("#email").fill(attempt.email);
      await page.locator("#password").fill(attempt.password);
      await page.getByRole("button", { name: "Sign In" }).click();

      // The same busy feedback…
      const busy = page.getByRole("button", { name: "Signing in…" });
      await expect(busy, attempt.what).toBeDisabled();
      await expect(busy).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#email")).toBeDisabled();

      // …and the same failure feedback: one announced callout, both values
      // kept, and focus back on the password (ui-spec.md §4.2).
      const callout = page.getByTestId("zg-login-error");
      await expect(callout, attempt.what).toBeVisible();
      await expect(callout).toHaveAttribute("role", "alert");
      messages.push((await callout.innerText()).trim());
      await expect(page.locator("#email")).toHaveValue(attempt.email);
      await expect(page.locator("#password")).toHaveValue(attempt.password);
      await expect(page.locator("#password")).toBeFocused();
      await expect(page).toHaveURL(/\/login$/);
    }

    // BR-06: nothing on the screen tells the three apart.
    expect(messages).toEqual([
      "Email or password is incorrect.",
      "Email or password is incorrect.",
      "Email or password is incorrect.",
    ]);
  });

  test("E2E-04 / AC-07, AC-21: each role sees only its own destinations, and another role's address is refused on screen and at the API", async ({
    page,
  }) => {
    const roles = [
      {
        who: "a Requester",
        account: ACCOUNTS.requester,
        navigation: ["Dashboard", "My Tickets", "Create Ticket"],
        refusedRoutes: ["/staff/tickets", "/admin/users"],
        refusedEndpoints: ["/api/staff/tickets", "/api/users", "/api/dashboard/staff"],
      },
      {
        who: "IT Staff",
        account: ACCOUNTS.staff,
        navigation: ["Dashboard", "Ticket Queue"],
        refusedRoutes: ["/my-tickets", "/tickets/new", "/admin/users"],
        refusedEndpoints: ["/api/tickets", "/api/users", "/api/dashboard/requester"],
      },
      {
        who: "an Administrator",
        account: ADMINISTRATOR,
        navigation: ["Dashboard", "User Management", "Ticket Queue"],
        refusedRoutes: ["/my-tickets", "/tickets/new"],
        refusedEndpoints: ["/api/tickets", "/api/dashboard/requester"],
      },
    ];

    for (const role of roles) {
      await signIn(page, role.account);
      // lab-04 FR-25: one landing screen, the same sentence for everybody.
      await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

      // FR-09: no destination the role may not use is rendered at all.
      await expect(mainNavigation(page).getByRole("link"), role.who).toHaveText(role.navigation);

      for (const route of role.refusedRoutes) {
        await page.goto(route);
        const forbidden = page.getByTestId("zg-state-forbidden");
        await expect(forbidden, `${role.who} at ${route}`).toBeVisible();
        await expect(forbidden.getByRole("link", { name: "Back to Dashboard" })).toBeVisible();
      }

      // The refusal is the server's, whatever the screen shows (AC-21).
      for (const endpoint of role.refusedEndpoints) {
        const res = await api(page).get(endpoint);
        expect(res.status(), `${role.who} → ${endpoint}`).toBe(403);
        expect((await res.json()).error.code, `${role.who} → ${endpoint}`).toBe("FORBIDDEN");
      }

      await signOut(page);
    }
  });
});
