import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PriorityBadge, RoleBadge, StatusBadge } from "../../src/components/Badge.js";
import ForbiddenState from "../../src/components/ForbiddenState.js";
import ChangePassword from "../../src/pages/ChangePassword.js";
import Login from "../../src/pages/Login.js";
import { CURRENT_STATUSES } from "../../src/api.js";
import {
  REQUESTER,
  STAFF,
  actor,
  makeTicket,
  mockServer,
  refused,
  renderDetail,
} from "../support/ticketServer.js";
import { ADMIN, mockUsers, refused as refuseUser, renderUsers } from "../support/userServer.js";

// tests.md A11Y-01..09; ui-spec.md §12; Lab 2 ui-spec.md §9.
//
// These span screens, which is why they have a file of their own. Every row is
// written in full: the Administrator dialogs that three of them also name
// arrived with Issue #33.

beforeEach(() => {
  vi.restoreAllMocks();
});

const loaded = () => screen.findByTestId("detail-ticket-number");

describe("Labels and controls", () => {
  it("A11Y-01: every field on Login and Change Password is reachable by its visible label", () => {
    const { unmount } = render(<Login onSignedIn={vi.fn()} />);
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    unmount();

    render(<ChangePassword mandatory onChanged={vi.fn()} />);
    expect(screen.getByLabelText(/^Current Password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^New Password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Confirm New Password/)).toBeInTheDocument();
  });

  it("A11Y-01: every field in the Create and Edit User dialogs is reachable by its visible label", async () => {
    mockUsers();
    const user = userEvent.setup();
    renderUsers(ADMIN);
    await screen.findByTestId("user-table");

    await user.click(screen.getByRole("button", { name: "+ Create User" }));
    let dialog = screen.getByRole("dialog");
    for (const label of [/^Name/, /^Email/, /^Role/, /^Initial Password/]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    // The radio pair is a named group, and each choice is labelled on its own.
    expect(within(dialog).getByRole("group", { name: /Status/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Active")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Inactive")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
    dialog = screen.getByRole("dialog");
    for (const label of [/^Name/, /^Email/, /^Role/, /^New Initial Password/]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("A11Y-02: a password toggle carries a title and an aria-label that both change with its state", async () => {
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("title", "Show password");

    await user.click(toggle);

    // A label still saying "Show" while the password is on screen would tell a
    // screen-reader user the opposite of what is happening.
    expect(toggle).toHaveAccessibleName("Hide password");
    expect(toggle).toHaveAttribute("title", "Hide password");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("type", "text");
  });
});

describe("Announced refusals", () => {
  it("A11Y-03: the Login failure callout is announced", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }),
    })) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Email/), "someone@example.edu");
    await user.type(screen.getByLabelText(/^Password/), "not-it");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });

  it("A11Y-03: an inline 409 from an Operations control is announced", async () => {
    mockServer(STAFF, {
      patch: (operation) =>
        operation === "it-priority" ? refused(409, "CONFLICT", "That change conflicts with the ticket.") : undefined,
    });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    await user.selectOptions(screen.getByLabelText("IT Priority"), "HIGH");

    expect(await screen.findByRole("alert")).toHaveTextContent("That change conflicts with the ticket.");
  });

  it("A11Y-03: an inline 409 from Problem Appears Resolved is announced", async () => {
    mockServer(REQUESTER, {
      appearsResolved: () =>
        refused(409, "RESOLUTION_NOT_APPLICABLE", "This ticket has already been resolved, closed or cancelled."),
    });
    const user = userEvent.setup();
    renderDetail(REQUESTER);
    await loaded();

    await user.click(screen.getByRole("button", { name: "Problem Appears Resolved" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already been resolved/);
  });

  it("A11Y-03: an inline 409 in a user dialog is announced", async () => {
    mockUsers({
      write: (method) =>
        method === "PATCH"
          ? refuseUser(409, "EMAIL_ALREADY_EXISTS", "An account with this email address already exists.", "email")
          : undefined,
    });
    const user = userEvent.setup();
    renderUsers(ADMIN);
    await screen.findByTestId("user-table");

    await user.click(screen.getByRole("button", { name: "Edit Somsak Wattana" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "An account with this email address already exists.",
    );
  });
});

describe("Threads", () => {
  it("A11Y-04 / BR-20: the Internal Notes heading is a real heading, reached before its composer", async () => {
    mockServer(STAFF);
    renderDetail(STAFF);
    await loaded();

    const panel = screen.getByTestId("internal-notes");
    const heading = within(panel).getByRole("heading", { level: 2, name: /Internal Notes — not visible to the Requester/ });
    const composer = within(panel).getByRole("textbox");

    // In document order — which is reading order for a screen reader — the
    // warning comes before the place to type.
    expect(heading.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the region is named by it.
    expect(panel).toHaveAccessibleName(/Internal Notes — not visible to the Requester/);
  });

  it("A11Y-09: both threads are ordered lists, so the count and each position are announced", async () => {
    const entry = (id: number, body: string) => ({
      id,
      ticketId: 118,
      author: actor(STAFF),
      body,
      createdAt: "2026-05-12T09:14:00.000Z",
    });
    mockServer(STAFF, { comments: [entry(1, "Public one"), entry(2, "Public two")], notes: [entry(3, "Private one")] });
    renderDetail(STAFF);
    await loaded();

    for (const [testId, count] of [
      ["public-comments", 2],
      ["internal-notes", 1],
    ] as const) {
      const panel = screen.getByTestId(testId);
      const list = await within(panel).findByRole("list");
      expect(list.tagName, testId).toBe("OL");
      expect(within(list).getAllByRole("listitem"), testId).toHaveLength(count);
    }
  });
});

describe("Dialogs and changing controls", () => {
  it("A11Y-05: the status confirmation holds focus, and Escape closes it and returns focus to the select", async () => {
    const server = mockServer(STAFF, { ticket: makeTicket({ currentStatus: "OPEN" }) });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    await user.selectOptions(status, "CANCELLED");

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(/Move this ticket to Cancelled/);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(status).toHaveFocus();
    expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("A11Y-05: Create User and Edit User hold focus, and return it to the control that opened them", async () => {
    mockUsers();
    const user = userEvent.setup();
    renderUsers(ADMIN);
    await screen.findByTestId("user-table");

    const create = screen.getByRole("button", { name: "+ Create User" });
    await user.click(create);
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Focus starts on the first field.
    const name = within(dialog).getByLabelText(/^Name/);
    expect(name).toHaveFocus();

    // Tab from the last control and Shift+Tab from the first both stay inside.
    const submit = within(dialog).getByRole("button", { name: "Create User" });
    submit.focus();
    await user.tab();
    expect(name).toHaveFocus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(create).toHaveFocus();

    const edit = screen.getByRole("button", { name: "Edit Bella Admin" });
    await user.click(edit);
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(edit).toHaveFocus();
  });

  it("A11Y-07: the status select is described by a line naming the current status, which follows the status", async () => {
    mockServer(STAFF, { ticket: makeTicket({ currentStatus: "OPEN" }) });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    // The option list changes with the status, so the description has to say
    // which status it is offering moves from.
    expect(status).toHaveAccessibleDescription(/This ticket is Open\./);

    await user.selectOptions(status, "IN_PROGRESS");

    await waitFor(() => expect(status).toHaveAccessibleDescription(/This ticket is In Progress\./));
  });

  it("A11Y-06: every status, priority and role badge renders its label as text, never colour alone", () => {
    const { container } = render(
      <div>
        {CURRENT_STATUSES.map((status) => (
          <StatusBadge key={status} value={status} />
        ))}
        <PriorityBadge value="LOW" label="Priority" />
        <PriorityBadge value="MEDIUM" label="Priority" />
        <PriorityBadge value="HIGH" label="Priority" />
        <RoleBadge role="REQUESTER" />
        <RoleBadge role="IT_STAFF" />
        <RoleBadge role="ADMINISTRATOR" />
      </div>,
    );

    // Each badge's own text, in render order. The ✓ and ↻ glyphs are extra,
    // non-colour signals (§2.1) and are hidden from assistive technology, so
    // they are set aside; what must remain is the label.
    const labels = Array.from(container.querySelectorAll(".zg-badge")).map((badge) =>
      (badge.textContent ?? "").replace(/^[✓↻]\s*/, "").trim(),
    );
    expect(labels).toEqual([
      "New",
      "Open",
      "In Progress",
      "Waiting for Requester",
      "Resolved",
      "Closed",
      "Reopened",
      "Cancelled",
      "Low",
      "Medium",
      "High",
      "Requester",
      "IT Staff",
      "Administrator",
    ]);
  });

  it("A11Y-08: the forbidden state and the not-found state each move focus to their heading, and are told apart", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <ForbiddenState role="REQUESTER" />
      </MemoryRouter>,
    );
    const forbiddenHeading = screen.getByRole("heading", { name: /You do not have access to this page/ });
    await waitFor(() => expect(forbiddenHeading).toHaveFocus());
    unmount();

    mockServer(REQUESTER, {
      ticketReply: () => refused(404, "TICKET_NOT_FOUND", "Ticket not found."),
    });
    renderDetail(REQUESTER);

    const notFound = await screen.findByTestId("zg-state-not-found");
    const notFoundHeading = within(notFound).getByRole("heading", {
      name: "This ticket does not exist, or you do not have access to it.",
    });
    await waitFor(() => expect(notFoundHeading).toHaveFocus());
    // Three states, three looks (ui-spec.md §13).
    expect(screen.queryByTestId("zg-state-forbidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("zg-state-error")).not.toBeInTheDocument();
  });
});
