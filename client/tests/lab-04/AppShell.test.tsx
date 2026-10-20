import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthUser, Role } from "../../src/api.js";
import AppShell from "../../src/components/AppShell.js";
import { LANDING } from "../../src/lib/landing.js";

// tests.md UI-FLOW-05; ui-spec.md §3; specification.md FR-25.
//
// One rule, read two ways: the Dashboard is the first thing in every role's
// navigation, and the place every role arrives at. The second half is what
// makes a shared `/dashboard` link always open somewhere the recipient is
// allowed to be — which is the reason there is one route rather than three.

function userWith(role: Role): AuthUser {
  return {
    id: 11,
    name: "Jennifer Anderson",
    email: "jennifer.anderson@example.edu",
    role,
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-05-12T09:14:00.000Z",
    updatedAt: "2026-09-12T08:02:00.000Z",
  };
}

function renderShell(user: AuthUser) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<AppShell user={user} onSignedOut={() => {}} />}>
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const ROLES: Role[] = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"];

describe("UI-FLOW-05 / FR-25: the Dashboard leads every role's navigation and is where every role lands", () => {
  it("is the first navigation item for all three roles, in the order ui-spec §3 sets", () => {
    const expected: Record<Role, [string, string][]> = {
      REQUESTER: [
        ["Dashboard", "/dashboard"],
        ["My Tickets", "/my-tickets"],
        ["Create Ticket", "/tickets/new"],
      ],
      IT_STAFF: [
        ["Dashboard", "/dashboard"],
        ["Ticket Queue", "/staff/tickets"],
      ],
      // §3: only Dashboard is inserted in front; the Administrator keeps User
      // Management ahead of the Queue, as Lab 3 arranged it.
      ADMINISTRATOR: [
        ["Dashboard", "/dashboard"],
        ["User Management", "/admin/users"],
        ["Ticket Queue", "/staff/tickets"],
      ],
    };

    for (const role of ROLES) {
      const view = renderShell(userWith(role));
      const nav = screen.getByRole("navigation", { name: "Main" });
      expect(
        within(nav).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]),
        role,
      ).toEqual(expected[role]);
      view.unmount();
    }
  });

  it("is the landing destination for all three roles, by the one route they share", () => {
    // The routing itself is asserted in `lab-03/AppRoutes.test.tsx`, which
    // follows each role from `/` to the screen it reaches. This is the table
    // those cases read from, and the reason they all now agree.
    for (const role of ROLES) {
      expect(LANDING[role].path, role).toBe("/dashboard");
      expect(LANDING[role].label, role).toBe("Dashboard");
    }
  });

  it("marks the Dashboard as the active page when it is the one being shown", () => {
    renderShell(userWith("IT_STAFF"));
    const nav = screen.getByRole("navigation", { name: "Main" });

    // §3 keeps Lab 3's active-page marking unchanged; what changed is which
    // item is active when somebody signs in.
    const dashboard = within(nav).getByRole("link", { name: "Dashboard" });
    expect(dashboard.className).toMatch(/zg-nav-item--active/);
    expect(within(nav).getByRole("link", { name: "Ticket Queue" }).className).not.toMatch(
      /zg-nav-item--active/,
    );
  });
});
