import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ADMIN,
  OTHER_ADMIN,
  STAFF,
  lastList,
  lastWrite,
  mockUsers,
  refused,
  renderUsers,
} from "../support/userServer.js";

// tests.md UI-USER-01..09; ui-spec.md §9, §2.4, §2.6, §10; specification.md
// FR-22..FR-26, BR-18, BR-35..BR-38, BR-41, AC-17..AC-23, AC-27.
//
// What these prove is what an Administrator sees and can do. That the API
// enforces each rule regardless is proven separately, at the API
// (users-admin.api.test.ts), and the route half of UI-USER-09 is in
// AppRoutes.test.tsx.

const table = () => screen.findByTestId("user-table");
const dialog = () => screen.getByRole("dialog");
const rowNames = () =>
  within(screen.getByTestId("user-table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);

function useMobileViewport() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width: 767px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  // @ts-expect-error deliberately removing the stub so setup.ts reinstates it
  delete window.matchMedia;
});

describe("The user list", () => {
  it("UI-USER-01 / FR-22, BR-41: five columns in order, rows by name, and no sorting or paging controls", async () => {
    mockUsers();
    renderUsers();

    const list = await table();
    expect(within(list).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Email",
      "Role",
      "Status",
      "Edit",
    ]);
    expect(rowNames()).toEqual([
      "Anong Kittisak",
      "Bella Admin",
      "Jennifer Anderson",
      "Retired Technician",
      "Somsak Wattana",
    ]);

    const retired = within(list).getAllByRole("row")[4];
    expect(within(retired).getByText("IT Staff")).toHaveClass("zg-badge--role");
    // §9.1: status is text, not a badge, so it never reads as a ticket status.
    const status = retired.querySelector(".zg-user-status");
    expect(status).toHaveClass("zg-user-status--inactive");
    expect(status).toHaveTextContent("Inactive");
    expect(status).not.toHaveClass("zg-badge");
    expect(within(retired).getByRole("button", { name: "Edit Retired Technician" })).toBeInTheDocument();

    // The handout excludes both; a control that does nothing would be worse
    // than none (§9.1).
    expect(within(list).queryAllByRole("button", { name: /sort/i })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^next$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/per page/i)).not.toBeInTheDocument();
  });

  it("UI-USER-01 / ui-spec §9.2: below 768px the table becomes cards, each with a full-width Edit", async () => {
    useMobileViewport();
    mockUsers();
    renderUsers();

    const cards = await screen.findByTestId("user-cards");
    expect(screen.queryByTestId("user-table")).not.toBeInTheDocument();

    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(within(items[0]).getByText("Anong Kittisak")).toBeInTheDocument();
    expect(within(items[0]).getByText("Administrator")).toHaveClass("zg-badge--role");
    expect(within(items[0]).getByText(ADMIN.email)).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: "Edit Anong Kittisak" })).toHaveClass("zg-btn--block");
  });

  it("UI-USER-02 / AC-27: search and the role filter issue the right query, and clearing them restores the list", async () => {
    const server = mockUsers();
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.type(screen.getByLabelText("Search users"), "som");
    await waitFor(() => expect(lastList(server).get("search")).toBe("som"));
    await waitFor(() => expect(rowNames()).toEqual(["Somsak Wattana"]));

    await user.selectOptions(screen.getByLabelText("Role"), "IT_STAFF");
    await waitFor(() => expect(lastList(server).get("role")).toBe("IT_STAFF"));
    // Both travel together.
    expect(lastList(server).get("search")).toBe("som");

    await user.clear(screen.getByLabelText("Search users"));
    await waitFor(() => expect(lastList(server).has("search")).toBe(false));
    await waitFor(() => expect(rowNames()).toEqual(["Retired Technician", "Somsak Wattana"]));

    await user.selectOptions(screen.getByLabelText("Role"), "");
    await waitFor(() => expect(lastList(server).has("role")).toBe(false));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
  });

  it("UI-USER-02 / ui-spec §10: a search that matches nothing is its own state, with a way back", async () => {
    mockUsers();
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.type(screen.getByLabelText("Search users"), "nobody by this name");

    const noResults = await screen.findByTestId("zg-state-no-results");
    expect(screen.queryByTestId("zg-state-empty")).not.toBeInTheDocument();

    await user.click(within(noResults).getByRole("button", { name: "Clear Search" }));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
    expect(screen.getByLabelText("Search users")).toHaveValue("");
  });
});

describe("Create User", () => {
  it("UI-USER-03 / AC-22, BR-18: all five fields, exactly one role, the password rule stated — and the account is created", async () => {
    const server = mockUsers();
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "+ Create User" }));
    const d = dialog();
    expect(d).toHaveAccessibleName("Create User");

    const role = within(d).getByLabelText(/^Role/);
    expect(role).not.toHaveAttribute("multiple");
    expect(within(role).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Choose a role",
      "Requester",
      "IT Staff",
      "Administrator",
    ]);
    // Neither status is chosen for the Administrator: an inactive account is a
    // decision, not a default (api-spec.md §9).
    expect(within(d).getByRole("group", { name: /Status/ })).toBeInTheDocument();
    expect(within(d).getByLabelText("Active")).not.toBeChecked();
    expect(within(d).getByLabelText("Inactive")).not.toBeChecked();
    expect(within(d).getByText("8–72 characters. The user must change it at first sign-in.")).toBeInTheDocument();

    // Nothing filled in: every field says what it needs, and nothing is sent.
    await user.click(within(d).getByRole("button", { name: "Create User" }));
    expect(await within(d).findByText(/Name must be between/)).toBeInTheDocument();
    expect(within(d).getByText("Enter an email address.")).toBeInTheDocument();
    expect(within(d).getByText("Choose a role.")).toBeInTheDocument();
    expect(within(d).getByText("Choose whether the account is active.")).toBeInTheDocument();
    expect(within(d).getByText(/Password must be between/)).toBeInTheDocument();
    expect(lastWrite(server)).toBeUndefined();

    await user.type(within(d).getByLabelText(/^Name/), "Gina New");
    await user.type(within(d).getByLabelText(/^Email/), "gina.new@example.edu");
    await user.selectOptions(role, "IT_STAFF");
    await user.click(within(d).getByLabelText("Active"));
    await user.type(within(d).getByLabelText(/^Initial Password/), "Welcome2026!");
    await user.click(within(d).getByRole("button", { name: "Create User" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(lastWrite(server)).toMatchObject({
      method: "POST",
      body: {
        name: "Gina New",
        email: "gina.new@example.edu",
        role: "IT_STAFF",
        isActive: true,
        initialPassword: "Welcome2026!",
      },
    });
    // §9.3: a toast, and the list refreshed with the new account in it.
    expect(await screen.findByTestId("zg-toast")).toHaveTextContent("Account created for Gina New.");
    await waitFor(() => expect(rowNames()).toContain("Gina New"));
  });

  it("UI-USER-03 / ui-spec §9.3: a new account the current filter would hide is shown, because the filter is cleared", async () => {
    const server = mockUsers();
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.selectOptions(screen.getByLabelText("Role"), "REQUESTER");
    await waitFor(() => expect(rowNames()).toEqual(["Jennifer Anderson"]));

    await user.click(screen.getByRole("button", { name: "+ Create User" }));
    const d = dialog();
    await user.type(within(d).getByLabelText(/^Name/), "Gina New");
    await user.type(within(d).getByLabelText(/^Email/), "gina.new@example.edu");
    await user.selectOptions(within(d).getByLabelText(/^Role/), "IT_STAFF");
    await user.click(within(d).getByLabelText("Active"));
    await user.type(within(d).getByLabelText(/^Initial Password/), "Welcome2026!");
    await user.click(within(d).getByRole("button", { name: "Create User" }));

    await waitFor(() => expect(rowNames()).toContain("Gina New"));
    expect(screen.getByLabelText("Role")).toHaveValue("");
    expect(lastList(server).has("role")).toBe(false);
  });

  it("UI-USER-03 / ui-spec §9.3: while it is saving, the dialog cannot be dismissed", async () => {
    mockUsers({ hang: (method) => method === "POST" });
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "+ Create User" }));
    const d = dialog();
    await user.type(within(d).getByLabelText(/^Name/), "Gina New");
    await user.type(within(d).getByLabelText(/^Email/), "gina.new@example.edu");
    await user.selectOptions(within(d).getByLabelText(/^Role/), "REQUESTER");
    await user.click(within(d).getByLabelText("Active"));
    await user.type(within(d).getByLabelText(/^Initial Password/), "Welcome2026!");
    await user.click(within(d).getByRole("button", { name: "Create User" }));

    const saving = await within(d).findByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(within(d).getByRole("button", { name: "Cancel" })).toBeDisabled();

    // Sent to the dialog itself: every control in it is disabled while saving.
    fireEvent.keyDown(d, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("UI-USER-04 / AC-17: a duplicate address lands on the Email field, the dialog stays open, and every value is kept", async () => {
    mockUsers({
      write: (method, path) =>
        method === "POST" && path === "/api/users"
          ? refused(409, "EMAIL_ALREADY_EXISTS", "An account with this email address already exists.", "email")
          : undefined,
    });
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "+ Create User" }));
    const d = dialog();
    await user.type(within(d).getByLabelText(/^Name/), "Somebody Else");
    await user.type(within(d).getByLabelText(/^Email/), STAFF.email);
    await user.selectOptions(within(d).getByLabelText(/^Role/), "REQUESTER");
    await user.click(within(d).getByLabelText("Inactive"));
    await user.type(within(d).getByLabelText(/^Initial Password/), "Welcome2026!");
    await user.click(within(d).getByRole("button", { name: "Create User" }));

    const message = await within(d).findByText("An account with this email address already exists.");
    expect(message).toHaveAttribute("role", "alert");
    const email = within(d).getByLabelText(/^Email/);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toBe(message.id);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(d).getByLabelText(/^Name/)).toHaveValue("Somebody Else");
    expect(email).toHaveValue(STAFF.email);
    expect(within(d).getByLabelText(/^Role/)).toHaveValue("REQUESTER");
    expect(within(d).getByLabelText("Inactive")).toBeChecked();
    expect(within(d).getByLabelText(/^Initial Password/)).toHaveValue("Welcome2026!");
  });
});

describe("Edit User", () => {
  it("UI-USER-05 / AC-23, FR-26: pre-filled, with Set New Initial Password as a separate section and its own button", async () => {
    const server = mockUsers();
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
    const d = dialog();
    expect(d).toHaveAccessibleName("Edit Somsak Wattana");
    expect(within(d).getByLabelText(/^Name/)).toHaveValue("Somsak Wattana");
    expect(within(d).getByLabelText(/^Email/)).toHaveValue(STAFF.email);
    expect(within(d).getByLabelText(/^Role/)).toHaveValue("IT_STAFF");
    expect(within(d).getByLabelText("Active")).toBeChecked();

    // A password is never changed as a side effect of editing someone (§9.4).
    expect(within(d).queryByLabelText(/^Initial Password/)).not.toBeInTheDocument();
    const section = within(d).getByRole("region", { name: "Set New Initial Password" });
    expect(within(section).getByLabelText(/^New Initial Password/)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Set Password" })).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();

    const name = within(d).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Somsak Wattana-Lee");
    await user.click(within(d).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(lastWrite(server)).toMatchObject({
      method: "PATCH",
      url: expect.stringContaining(`/api/users/${STAFF.id}`),
      body: { name: "Somsak Wattana-Lee", email: STAFF.email, role: "IT_STAFF", isActive: true },
    });
    expect(await screen.findByTestId("zg-toast")).toHaveTextContent("Changes to Somsak Wattana-Lee saved.");
    await waitFor(() => expect(rowNames()).toContain("Somsak Wattana-Lee"));
  });

  it("UI-USER-05 / ui-spec §2.6, §9.4: in the Edit dialog a duplicate address lands on Email, and only that field returns to its saved value", async () => {
    mockUsers({
      write: (method) =>
        method === "PATCH"
          ? refused(409, "EMAIL_ALREADY_EXISTS", "An account with this email address already exists.", "email")
          : undefined,
    });
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
    const d = dialog();
    const name = within(d).getByLabelText(/^Name/);
    const email = within(d).getByLabelText(/^Email/);
    await user.clear(name);
    await user.type(name, "Somsak W.");
    await user.clear(email);
    await user.type(email, OTHER_ADMIN.email);
    await user.click(within(d).getByRole("button", { name: "Save Changes" }));

    expect(await within(d).findByText("An account with this email address already exists.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(email).toHaveValue(STAFF.email);
    // Creating keeps what was typed (§9.3); editing reverts only the refused
    // control, and everything else stays as the Administrator left it.
    expect(name).toHaveValue("Somsak W.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("UI-USER-05 / ui-spec §9.3: saving the same account twice gives the second toast its full time on screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockUsers();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderUsers();
      await table();

      const save = async () => {
        await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
        await user.click(within(dialog()).getByRole("button", { name: "Save Changes" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      };

      await save();
      expect(await screen.findByTestId("zg-toast")).toHaveTextContent("Changes to Somsak Wattana saved.");
      act(() => vi.advanceTimersByTime(3000));

      // The same words again: the toast is a new one, not the first one's remainder.
      await save();
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.getByTestId("zg-toast")).toHaveTextContent("Changes to Somsak Wattana saved.");

      act(() => vi.advanceTimersByTime(3000));
      expect(screen.queryByTestId("zg-toast")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("UI-USER-06 / AC-20, BR-37: on one's own account, Role and Status are disabled and say why", async () => {
    mockUsers();
    const user = userEvent.setup();
    renderUsers(ADMIN);
    await table();

    await user.click(screen.getByRole("button", { name: `Edit ${ADMIN.name}` }));
    let d = dialog();

    const role = within(d).getByLabelText(/^Role/);
    expect(role).toBeDisabled();
    expect(role).toHaveClass("zg-field--disabled");
    expect(within(d).getByLabelText("Active")).toBeDisabled();
    expect(within(d).getByLabelText("Inactive")).toBeDisabled();

    // The reason is on the page and attached to both controls, before any
    // refusal could happen.
    const reason = within(d).getByText("You cannot change your own role or status. Another administrator can.");
    expect(role.getAttribute("aria-describedby")).toContain(reason.id);
    expect(within(d).getByRole("group", { name: /Status/ }).getAttribute("aria-describedby")).toContain(reason.id);
    // The rest of one's own account stays editable.
    expect(within(d).getByLabelText(/^Name/)).toBeEnabled();
    expect(within(d).getByLabelText(/^Email/)).toBeEnabled();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: `Edit ${OTHER_ADMIN.name}` }));
    d = dialog();
    expect(within(d).getByLabelText(/^Role/)).toBeEnabled();
    expect(within(d).getByLabelText("Inactive")).toBeEnabled();
    expect(within(d).queryByText(/cannot change your own/)).not.toBeInTheDocument();
  });

  it("UI-USER-06 / ui-spec §3: saving one's own account hands it to the session, so the header shows the change at once", async () => {
    mockUsers();
    const onOwnAccountChanged = vi.fn();
    const user = userEvent.setup();
    renderUsers(ADMIN, onOwnAccountChanged);
    await table();

    await user.click(screen.getByRole("button", { name: `Edit ${ADMIN.name}` }));
    const name = within(dialog()).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Anong K.");
    await user.click(within(dialog()).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(onOwnAccountChanged).toHaveBeenCalledWith(expect.objectContaining({ id: ADMIN.id, name: "Anong K." })),
    );

    // Somebody else's account is not the session's business.
    onOwnAccountChanged.mockClear();
    await user.click(screen.getByRole("button", { name: `Edit ${OTHER_ADMIN.name}` }));
    await user.click(within(dialog()).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onOwnAccountChanged).not.toHaveBeenCalled();
  });

  it("UI-USER-07 / AC-19, BR-38: a last-Administrator refusal lands on the control that caused it, which reverts", async () => {
    mockUsers({
      write: (method, path, body) =>
        method === "PATCH" && path === `/api/users/${OTHER_ADMIN.id}`
          ? refused(
              409,
              "LAST_ACTIVE_ADMINISTRATOR",
              "At least one administrator must stay active.",
              body.isActive === false ? "isActive" : "role",
            )
          : undefined,
    });
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: `Edit ${OTHER_ADMIN.name}` }));
    const d = dialog();

    await user.click(within(d).getByLabelText("Inactive"));
    await user.click(within(d).getByRole("button", { name: "Save Changes" }));

    const first = await within(d).findByText("At least one administrator must stay active.");
    expect(first).toHaveAttribute("role", "alert");
    // §2.6: the control goes back to the value it had, and the dialog stays.
    expect(within(d).getByLabelText("Active")).toBeChecked();
    expect(within(d).getByLabelText("Inactive")).not.toBeChecked();
    expect(within(d).getByLabelText(/^Name/)).toHaveValue(OTHER_ADMIN.name);

    await user.selectOptions(within(d).getByLabelText(/^Role/), "IT_STAFF");
    await user.click(within(d).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(within(d).getByLabelText(/^Role/)).toHaveValue("ADMINISTRATOR"));
    expect(within(d).getByText("At least one administrator must stay active.")).toHaveAttribute("role", "alert");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("UI-USER-08 / AC-18, BR-07: setting a new initial password confirms the consequence and never shows the password again", async () => {
    const server = mockUsers();
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
    const section = within(dialog()).getByRole("region", { name: "Set New Initial Password" });
    const field = within(section).getByLabelText(/^New Initial Password/);

    await user.type(field, "short");
    await user.click(within(section).getByRole("button", { name: "Set Password" }));
    expect(await within(section).findByText(/Password must be between/)).toBeInTheDocument();
    expect(lastWrite(server)).toBeUndefined();

    await user.clear(field);
    await user.type(field, "Welcome2026!");
    await user.click(within(section).getByRole("button", { name: "Set Password" }));

    expect(
      await within(section).findByText("This account must choose a new password at its next sign-in."),
    ).toBeInTheDocument();
    expect(lastWrite(server)).toMatchObject({
      method: "POST",
      url: expect.stringContaining(`/api/users/${STAFF.id}/initial-password`),
      body: { initialPassword: "Welcome2026!" },
    });
    expect(field).toHaveValue("");
    // The details were not saved as a side effect, and the dialog is still open.
    expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("UI-USER-08 / ui-spec §9.3: while a new initial password is being set, the dialog can be neither closed nor saved", async () => {
    const server = mockUsers({ hang: (method, path) => method === "POST" && path.endsWith("/initial-password") });
    const user = userEvent.setup();
    renderUsers();
    await table();

    await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
    const d = dialog();
    const section = within(d).getByRole("region", { name: "Set New Initial Password" });
    await user.type(within(section).getByLabelText(/^New Initial Password/), "Welcome2026!");
    await user.click(within(section).getByRole("button", { name: "Set Password" }));

    expect(await within(section).findByRole("button", { name: "Setting…" })).toBeDisabled();
    // Closing now would take the confirmation away before it could be shown.
    expect(within(d).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(d).getByRole("button", { name: "Save Changes" })).toBeDisabled();

    fireEvent.keyDown(d, { key: "Escape" });
    fireEvent.submit(within(d).getByLabelText(/^Name/).closest("form")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);
  });
});

describe("One's own initial password", () => {
  it("UI-USER-08 / AC-18: setting one's own initial password hands the account up, so Change Password follows at once", async () => {
    mockUsers();
    const onOwnAccountChanged = vi.fn();
    const user = userEvent.setup();
    renderUsers(ADMIN, onOwnAccountChanged);
    await table();

    await user.click(screen.getByRole("button", { name: `Edit ${ADMIN.name}` }));
    const section = within(dialog()).getByRole("region", { name: "Set New Initial Password" });
    await user.type(within(section).getByLabelText(/^New Initial Password/), "Welcome2026!");
    await user.click(within(section).getByRole("button", { name: "Set Password" }));

    // api-spec.md §9 keeps this session; the account it hands up now requires a
    // new password, which is what moves the application to Change Password.
    await waitFor(() =>
      expect(onOwnAccountChanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: ADMIN.id, mustChangePassword: true }),
      ),
    );
  });
});

describe("Refusal", () => {
  it("UI-USER-09 / AC-21: a 403 from the server renders the forbidden state, not the list or a failure", async () => {
    mockUsers({ listReply: () => refused(403, "FORBIDDEN", "You do not have access to this operation.") });
    renderUsers(STAFF);

    const forbidden = await screen.findByTestId("zg-state-forbidden");
    expect(within(forbidden).getByRole("link", { name: /back to ticket queue/i })).toHaveAttribute(
      "href",
      "/staff/tickets",
    );
    expect(screen.queryByTestId("user-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("zg-state-error")).not.toBeInTheDocument();
  });
});
