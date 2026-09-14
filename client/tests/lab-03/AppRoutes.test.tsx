import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Role } from "../../src/api.js";

// tests.md UI-ROUTE-01..07 and the route half of UI-USER-09; ui-spec.md §3; specification.md FR-09, BR-02,
// BR-13, AC-02, AC-07.
//
// The screen tests prove each screen behaves; this one proves the application
// puts the right screen in front of the right person. That decision is not any
// one screen's — Login does not navigate, it hands the user up — so asserting
// it inside Login.test.tsx would be asserting something Login does not do.
//
// It exercises the real `useAuthSession` against a mocked `fetchCurrentUser`,
// so the three states and the routing that reads them are tested together.
// None of this is the security control: every route below is also refused by
// the API (API-AUTHZ-01..11). What it protects is the person, not the data.

const fetchCurrentUser = vi.fn();
const fetchTickets = vi.fn();
const fetchCategories = vi.fn();
const fetchStaffTickets = vi.fn();
const fetchAssignees = vi.fn();
const fetchTicket = vi.fn();
const fetchRelatedSystems = vi.fn();
const fetchUsers = vi.fn();

vi.mock("../../src/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api.js")>()),
  fetchCurrentUser: (...args: unknown[]) => fetchCurrentUser(...args),
  fetchTickets: (...args: unknown[]) => fetchTickets(...args),
  fetchCategories: (...args: unknown[]) => fetchCategories(...args),
  fetchStaffTickets: (...args: unknown[]) => fetchStaffTickets(...args),
  fetchAssignees: (...args: unknown[]) => fetchAssignees(...args),
  fetchTicket: (...args: unknown[]) => fetchTicket(...args),
  fetchRelatedSystems: (...args: unknown[]) => fetchRelatedSystems(...args),
  fetchUsers: (...args: unknown[]) => fetchUsers(...args),
}));

const { AppRoutes } = await import("../../src/App.js");

function userWith(role: Role, mustChangePassword = false): AuthUser {
  return {
    id: 11,
    name: "Jennifer Anderson",
    email: "jennifer.anderson@example.edu",
    role,
    isActive: true,
    mustChangePassword,
    createdAt: "2026-05-12T09:14:00.000Z",
    updatedAt: "2026-09-12T08:02:00.000Z",
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchTickets.mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
  });
  fetchCategories.mockResolvedValue([]);
  fetchStaffTickets.mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
  });
  fetchAssignees.mockResolvedValue([]);
  // Left pending: these cases are about which screen renders, not its content.
  fetchTicket.mockReturnValue(new Promise(() => {}));
  fetchRelatedSystems.mockResolvedValue([]);
  fetchUsers.mockResolvedValue([]);
});

describe("Application routing", () => {
  it("UI-ROUTE-01 / BR-13: while the session is unknown, neither Login nor the application is shown", () => {
    // A pending answer is not "signed out". Flashing Login and then replacing
    // it is how a signed-in user is told they were logged out when they were
    // not.
    fetchCurrentUser.mockReturnValue(new Promise(() => {}));
    renderAt("/my-tickets");

    expect(screen.getByTestId("zg-state-loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("UI-ROUTE-02 / FR-01: signed out, a deep URL lands on Login rather than a broken screen", async () => {
    fetchCurrentUser.mockResolvedValue(null);
    renderAt("/tickets/42");

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(fetchTickets).not.toHaveBeenCalled();
  });

  it("UI-ROUTE-03 / BR-13: an unreachable server is a retryable failure, not a sign-out", async () => {
    fetchCurrentUser.mockRejectedValue(new TypeError("Failed to fetch"));
    renderAt("/my-tickets");

    expect(await screen.findByTestId("zg-state-error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // Telling someone to sign in again when the problem is the network sends
    // them to re-enter a password that was never the issue.
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("UI-ROUTE-04 / AC-02, BR-02: on an initial password, every typed route returns to Change Password", async () => {
    const user = userEvent.setup();
    fetchCurrentUser.mockResolvedValue(userWith("REQUESTER", true));
    renderAt("/my-tickets");

    expect(await screen.findByTestId("zg-initial-password-banner")).toBeInTheDocument();
    // ui-spec.md §5: the shell renders, without navigation items. Not a
    // full-page screen — this user is signed in, and the one action BR-02
    // leaves them has to stay reachable.
    expect(screen.getByTestId("current-user-name")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My Tickets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /profile/i }));
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
    // api-spec.md §4 keeps logout available during a mandatory change, so
    // somebody who cannot remember the initial password they were sent is not
    // trapped on this screen with no way off it.
    expect(screen.queryByRole("menuitem", { name: /change password/i })).not.toBeInTheDocument();
  });

  it("UI-ROUTE-05 / AC-01: a signed-in Requester at the root lands on their own screen", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("REQUESTER"));
    renderAt("/");

    expect(await screen.findByRole("link", { name: "My Tickets" })).toBeInTheDocument();
    await waitFor(() => expect(fetchTickets).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("UI-ROUTE-05 / AC-01: Login has nothing left to offer someone already signed in", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("REQUESTER"));
    renderAt("/login");

    expect(await screen.findByRole("link", { name: "My Tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("UI-ROUTE-05 / AC-01: IT Staff at the root land on the Ticket Queue", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("IT_STAFF"));
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();
    await waitFor(() => expect(fetchStaffTickets).toHaveBeenCalled());
    expect(fetchTickets).not.toHaveBeenCalled();
  });

  it("UI-ROUTE-05 / AC-01: an Administrator at the root lands on User Management", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("ADMINISTRATOR"));
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "User Management" })).toBeInTheDocument();
    await waitFor(() => expect(fetchUsers).toHaveBeenCalled());
  });

  it("UI-USER-09 / AC-21: IT Staff typing the User Management address are refused, and no account is requested", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("IT_STAFF"));
    renderAt("/admin/users");

    const forbidden = await screen.findByTestId("zg-state-forbidden");
    expect(within(forbidden).getByRole("link", { name: /back to ticket queue/i })).toHaveAttribute(
      "href",
      "/staff/tickets",
    );
    expect(screen.queryByRole("heading", { name: "User Management" })).not.toBeInTheDocument();
    // The client half of AC-21. The server half is API-AUTHZ-04 and API-AUTHZ-05.
    expect(fetchUsers).not.toHaveBeenCalled();
  });

  it("UI-ROUTE-06 / FR-09, AC-07: another role's URL renders the forbidden state, with the way back", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("IT_STAFF"));
    renderAt("/my-tickets");

    // ui-spec.md §2.4 and tests.md E2E-04: a refusal the person can read, not a
    // silent redirect. Changed in Issue #31 — Issue #30 redirected instead.
    const forbidden = await screen.findByTestId("zg-state-forbidden");
    expect(within(forbidden).getByRole("link", { name: /back to ticket queue/i })).toHaveAttribute(
      "href",
      "/staff/tickets",
    );
    // Signed in, so the shell is there; the guarded screen is not, and nothing
    // is requested on the other role's behalf.
    expect(screen.getByTestId("current-user-role")).toHaveTextContent("IT Staff");
    expect(fetchTickets).not.toHaveBeenCalled();
  });

  it("UI-ROUTE-06 / AC-07: a Requester typing the queue's address is refused the same way", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("REQUESTER"));
    renderAt("/staff/tickets");

    const forbidden = await screen.findByTestId("zg-state-forbidden");
    expect(within(forbidden).getByRole("link", { name: /back to my tickets/i })).toHaveAttribute(
      "href",
      "/my-tickets",
    );
    expect(screen.queryByRole("heading", { name: "Ticket Queue" })).not.toBeInTheDocument();
    // The client half of AC-07. The server half is API-AUTHZ-02.
    expect(fetchStaffTickets).not.toHaveBeenCalled();
  });

  it("UI-ROUTE-07 / FR-14: IT Staff opening a ticket get the Ticket Detail screen, not a refusal", async () => {
    fetchCurrentUser.mockResolvedValue(userWith("IT_STAFF"));
    renderAt("/tickets/42");

    // ui-spec.md §8: one route for every role. The screen asks for the Ticket
    // itself, and what this role may read is the server's decision. Changed in
    // Issue #32, which built the staff view this route used to hold a place for.
    await waitFor(() => expect(fetchTicket).toHaveBeenCalledWith(42));
    expect(screen.getByTestId("zg-state-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("zg-state-forbidden")).not.toBeInTheDocument();
  });
});
