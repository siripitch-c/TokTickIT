import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppShell from "../../src/components/AppShell.js";
import type { AuthUser, Role } from "../../src/api.js";

// tests.md UI-SHELL-01..05 (UI-SHELL-02 in part — see below); ui-spec.md §3; specification.md FR-09, AC-06,
// AC-07.
//
// The navigation assertions here are about what a person *sees*. They are not
// the authorization evidence — that is API-AUTHZ-01..11, at the API, where the
// refusal actually lives. A hidden link is a convenience; the server is the
// control, and tests.md §1 keeps the two apart on purpose.

function userWith(role: Role, name = "Somsak Wattana"): AuthUser {
  return {
    id: 7,
    name,
    email: "somsak.wattana@example.edu",
    role,
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-05-12T09:14:00.000Z",
    updatedAt: "2026-09-12T08:02:00.000Z",
  };
}

function renderShell(user: AuthUser, onSignedOut = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={["/my-tickets"]}>
      <Routes>
        <Route element={<AppShell user={user} onSignedOut={onSignedOut} />}>
          <Route path="/my-tickets" element={<p>list</p>} />
          <Route path="/change-password" element={<p>change password screen</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response));
});

describe("Application shell", () => {
  it("UI-SHELL-01 / FR-09, AC-07: a Requester sees their own destinations and no others", () => {
    renderShell(userWith("REQUESTER", "Jennifer Anderson"));

    expect(screen.getByRole("link", { name: "My Tickets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Ticket" })).toBeInTheDocument();

    // ui-spec.md §3: a destination the role may not use is not rendered at
    // all — not disabled, not greyed. Absent is the only state that cannot be
    // clicked by accident or found by reading the DOM.
    expect(screen.queryByRole("link", { name: /ticket queue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /user management/i })).not.toBeInTheDocument();
  });

  it("UI-SHELL-02 / FR-09: IT Staff and an Administrator carry the Ticket Queue and nothing of the Requester's", () => {
    // The staff half of the row. The Administrator's User Management item —
    // listed first in their navigation — arrives with Issue #33.
    for (const role of ["IT_STAFF", "ADMINISTRATOR"] as const) {
      const { unmount } = renderShell(userWith(role));

      expect(screen.getByRole("link", { name: "Ticket Queue" })).toHaveAttribute("href", "/staff/tickets");
      expect(screen.queryByRole("link", { name: "My Tickets" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Create Ticket" })).not.toBeInTheDocument();

      unmount();
    }
  });

  it("UI-SHELL-03 / FR-09: the header names who is signed in and in what role", () => {
    renderShell(userWith("IT_STAFF"));

    expect(screen.getByTestId("current-user-name")).toHaveTextContent("Somsak Wattana");
    expect(screen.getByTestId("current-user-role")).toHaveTextContent("IT Staff");
  });

  it("UI-SHELL-03 / AC-25: the Lab 2 Change Requester control is gone", () => {
    renderShell(userWith("REQUESTER"));

    expect(screen.queryByRole("button", { name: /change requester/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/select.*requester/i)).not.toBeInTheDocument();
  });

  it("UI-SHELL-03: the account actions live behind the Profile disclosure", async () => {
    const user = userEvent.setup();
    renderShell(userWith("REQUESTER"));

    const profile = screen.getByRole("button", { name: /profile/i });
    expect(profile).toHaveAttribute("aria-expanded", "false");
    // Lab 2 §3 deferred this disclosure until it had more than two things in
    // it. It now holds exactly the two it was waiting for.
    expect(screen.queryByRole("menuitem", { name: /log out/i })).not.toBeInTheDocument();

    await user.click(profile);

    expect(profile).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
  });

  it("UI-SHELL-04 / AC-06: Log Out calls the endpoint and drops the local user", async () => {
    const onSignedOut = vi.fn();
    const user = userEvent.setup();
    renderShell(userWith("REQUESTER"), onSignedOut);

    await user.click(screen.getByRole("button", { name: /profile/i }));
    await user.click(screen.getByRole("menuitem", { name: /log out/i }));

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/logout");
    expect((init as RequestInit).method).toBe("POST");
    // Without this the browser never sends the cookie, and the server has no
    // session to destroy (api-spec.md §1).
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("UI-SHELL-04: Change Password navigates rather than acting in place", async () => {
    const user = userEvent.setup();
    renderShell(userWith("REQUESTER"));

    await user.click(screen.getByRole("button", { name: /profile/i }));
    await user.click(screen.getByRole("menuitem", { name: /change password/i }));

    expect(await screen.findByText("change password screen")).toBeInTheDocument();
  });

  it("UI-SHELL-05 / FR-09: the mobile panel carries the role's items, then the account", async () => {
    const user = userEvent.setup();
    renderShell(userWith("REQUESTER", "Jennifer Anderson"));

    const hamburger = screen.getByRole("button", { name: /open navigation menu/i });
    // BR-39's naming rule, carried over: the control says what it will do, in
    // both states.
    expect(hamburger).toHaveAttribute("aria-expanded", "false");

    await user.click(hamburger);

    const panel = document.getElementById("zg-mobile-nav");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Jennifer Anderson");
    expect(panel!.textContent).toContain("Requester");
    expect(panel!.textContent).toContain("Log Out");
    expect(screen.getByRole("button", { name: /close navigation menu/i })).toBeInTheDocument();
  });
});
