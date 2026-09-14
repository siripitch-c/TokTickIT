import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurrentStatus } from "../../src/api.js";
import { formatDateTime } from "../../src/lib/attachmentRules.js";
import { allowedTransitions } from "../../src/lib/statusTransitions.js";
import {
  REQUESTER,
  STAFF,
  actor,
  lastPatch,
  makeTicket,
  mockServer,
  refused,
  renderDetail,
} from "../support/ticketServer.js";

// tests.md UI-DETAIL-01..10; ui-spec.md §2.6..§2.8, §6, §8; specification.md
// FR-12, FR-14, FR-15, FR-17..FR-21, BR-20, BR-23..BR-34, AC-04, AC-10..AC-16,
// AC-26.
//
// One screen, two roles. What these prove is what a person on each side sees
// and can do; that the API refuses the rest is proven separately, at the API.

const loaded = () => screen.findByTestId("detail-ticket-number");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Ticket Detail by role", () => {
  it("UI-DETAIL-01 / AC-04, BR-20: a Requester's screen has no trace of Internal Notes — no panel, heading, empty state or request", async () => {
    const server = mockServer(REQUESTER);
    renderDetail(REQUESTER);
    await loaded();

    // Public Comments are theirs to read and write (§6).
    const comments = await screen.findByTestId("public-comments");
    expect(await within(comments).findByText("No comments yet.")).toBeInTheDocument();

    expect(screen.queryByTestId("internal-notes")).not.toBeInTheDocument();
    expect(screen.queryByText(/internal note/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not visible to the requester/i)).not.toBeInTheDocument();
    // Not merely hidden: never asked for, so no response could carry it.
    expect(server.calls.some((call) => call.url.includes("/notes"))).toBe(false);

    // And no staff controls, nor the request that would fill them.
    expect(screen.queryByTestId("operations-panel")).not.toBeInTheDocument();
    expect(server.calls.some((call) => call.url.includes("/assignees"))).toBe(false);
  });

  it("UI-DETAIL-02 / FR-14, AC-26: staff get Operations and both threads, and attachments with Download but no Add or Remove", async () => {
    mockServer(STAFF, {
      ticket: makeTicket({
        attachments: [
          {
            id: 5,
            ticketId: 118,
            originalFilename: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 2048,
            uploadedAt: "2026-05-12T09:20:00.000Z",
            removedAt: null,
            removedReason: null,
          },
        ],
      }),
    });
    renderDetail(STAFF);
    await loaded();

    expect(screen.getByTestId("operations-panel")).toBeInTheDocument();

    const attachments = screen.getByTestId("attachment-section");
    expect(within(attachments).getByRole("button", { name: "Download screenshot.png" })).toBeInTheDocument();
    expect(within(attachments).queryByRole("button", { name: /add attachment/i })).not.toBeInTheDocument();
    expect(within(attachments).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();

    expect(screen.getByTestId("public-comments")).toBeInTheDocument();
    expect(screen.getByTestId("internal-notes")).toBeInTheDocument();

    // The Requester shown is the Ticket's, not the signed-in staff member, and
    // for staff it carries the role badge §8.1 asks for.
    const requesterField = screen.getByText("Jennifer Anderson").closest("output") as HTMLElement;
    expect(requesterField).toHaveAttribute("aria-readonly", "true");
    expect(within(requesterField).getByText("Requester")).toHaveClass("zg-badge--role");
    // The way back is the queue, not a Requester list staff cannot use.
    expect(screen.getAllByRole("link", { name: /ticket queue/i }).length).toBeGreaterThan(0);
    // §8.3: the resolution signal is the Requester's action, not staff's.
    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();
  });
});

describe("Operations panel", () => {
  it("UI-DETAIL-03 / AC-10, AC-11: the owner select lists only active staff and Administrators, and Claim makes the signed-in user the owner", async () => {
    const server = mockServer(STAFF);
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const owner = screen.getByLabelText("Ticket Owner");
    await waitFor(() => expect(within(owner).getByRole("option", { name: "Anong Kittisak" })).toBeInTheDocument());
    // Unassigned, then exactly what the assignee endpoint returned — the list
    // of people a Ticket may go to (FR-16), never the full user list.
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Unassigned",
      "Somsak Wattana",
      "Anong Kittisak",
    ]);
    expect(owner).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(owner).toHaveValue(String(STAFF.id)));
    expect(lastPatch(server)?.url).toMatch(/\/api\/tickets\/118\/owner$/);
    expect(lastPatch(server)?.body).toEqual({ ownerId: STAFF.id });
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    // Already the owner: there is nothing left to claim.
    expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();

    await user.selectOptions(owner, "9");
    await waitFor(() => expect(owner).toHaveValue("9"));
    expect(lastPatch(server)?.body).toEqual({ ownerId: 9 });
  });

  it("UI-DETAIL-03 / BR-26: an owner deactivated since assignment is shown truthfully, as a disabled \"(inactive)\" option", async () => {
    mockServer(STAFF, {
      ticket: makeTicket({ ownerId: 42, owner: { id: 42, name: "Retired Technician", role: "IT_STAFF" } }),
    });
    renderDetail(STAFF);
    await loaded();

    const owner = screen.getByLabelText("Ticket Owner");
    const inactive = await within(owner).findByRole("option", { name: "Retired Technician (inactive)" });
    expect(inactive).toBeDisabled();
    expect(owner).toHaveValue("42");
  });

  it("UI-DETAIL-04 / AC-12: IT Priority saves on change, with Requested Priority read-only directly above it", async () => {
    const server = mockServer(STAFF, { ticket: makeTicket({ requestedPriority: "LOW", itPriority: "LOW" }) });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const panel = screen.getByTestId("operations-panel");
    const priority = within(panel).getByLabelText("IT Priority");
    const requestedLabel = within(panel).getByText("Requested Priority");
    const requestedValue = requestedLabel.nextElementSibling as HTMLElement;

    // Above, and read-only: compared with, never confused with (§8.2, BR-29).
    expect(requestedLabel.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(requestedValue).toHaveAttribute("aria-readonly", "true");
    expect(requestedValue).toHaveTextContent("Low");

    await user.selectOptions(priority, "HIGH");

    await waitFor(() => expect(priority).toHaveValue("HIGH"));
    expect(lastPatch(server)?.url).toMatch(/\/it-priority$/);
    expect(lastPatch(server)?.body).toEqual({ itPriority: "HIGH" });
    expect(requestedValue).toHaveTextContent("Low");
  });

  it("UI-DETAIL-05 / AC-13, BR-31: the status select offers only the moves permitted from the current status", async () => {
    mockServer(STAFF, { ticket: makeTicket({ currentStatus: "OPEN" }) });
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Open (current)",
      "In Progress",
      "Waiting for Requester",
      "Resolved",
      "Cancelled",
    ]);
  });

  it("UI-DETAIL-05 / BR-31: a Cancelled ticket offers no move at all", async () => {
    mockServer(STAFF, { ticket: makeTicket({ currentStatus: "CANCELLED" }) });
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    expect(within(status).getAllByRole("option")).toHaveLength(1);
    expect(status).toBeDisabled();
  });

  it("UI-DETAIL-05 / BR-31: the client's copy of the transition matrix is the specification's, cell for cell", () => {
    // Transcribed from specification.md BR-31 again, as the server's UNIT-03
    // does, so client and server are each pinned to the document rather than
    // to each other.
    const BR_31: Record<CurrentStatus, CurrentStatus[]> = {
      NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
      OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
      IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
      WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
      RESOLVED: ["CLOSED", "REOPENED"],
      CLOSED: ["REOPENED"],
      REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
      CANCELLED: [],
    };
    for (const from of Object.keys(BR_31) as CurrentStatus[]) {
      expect(allowedTransitions(from), from).toEqual(BR_31[from]);
    }
  });

  it("UI-DETAIL-06 / BR-33: Closed asks first; focus is held inside, and Cancel changes nothing and returns focus to the select", async () => {
    const server = mockServer(STAFF, { ticket: makeTicket({ currentStatus: "RESOLVED" }) });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    await user.selectOptions(status, "CLOSED");

    const dialog = await screen.findByRole("dialog");
    // §8.2: the consequence, not "Are you sure?".
    expect(dialog).toHaveTextContent("A closed ticket can only be reopened.");
    expect(lastPatch(server)).toBeUndefined();

    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Move to Closed" });
    expect(cancel).toHaveFocus();

    // Focus cannot leave the dialog in either direction.
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    await user.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(status).toHaveValue("RESOLVED");
    expect(status).toHaveFocus();
    expect(lastPatch(server)).toBeUndefined();
  });

  it("UI-DETAIL-06 / BR-33: confirming Cancelled saves it and closes the dialog", async () => {
    const server = mockServer(STAFF, { ticket: makeTicket({ currentStatus: "OPEN" }) });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    await user.selectOptions(status, "CANCELLED");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Cancelled tickets cannot be reopened.");

    await user.click(within(dialog).getByRole("button", { name: "Move to Cancelled" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(lastPatch(server)?.body).toEqual({ currentStatus: "CANCELLED" });
    await waitFor(() => expect(status).toHaveValue("CANCELLED"));
    // Terminal: nowhere left to move to.
    expect(status).toBeDisabled();
  });

  it("UI-DETAIL-07 / AC-13, ui-spec §2.6: a 409 lands under its own control, which reverts, and the other two carry on", async () => {
    mockServer(STAFF, {
      ticket: makeTicket({ currentStatus: "OPEN", itPriority: "LOW" }),
      // As if another staff member had just moved the Ticket on.
      patch: (operation) =>
        operation === "status"
          ? refused(409, "INVALID_STATUS_TRANSITION", "A ticket cannot move from Resolved to In Progress.")
          : undefined,
    });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const status = screen.getByLabelText("Current Status");
    await user.selectOptions(status, "IN_PROGRESS");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A ticket cannot move from Resolved to In Progress.");
    // Inline, under the control that caused it — not a screen-level failure.
    expect(status.closest(".zg-field")).toContainElement(alert);
    expect(screen.queryByTestId("zg-state-error")).not.toBeInTheDocument();
    expect(status).toHaveValue("OPEN");
    expect(status).toBeEnabled();

    // The other controls neither inherited the error nor stopped working.
    const priority = screen.getByLabelText("IT Priority");
    expect(priority.closest(".zg-field")).not.toContainElement(alert);
    await user.selectOptions(priority, "HIGH");
    await waitFor(() => expect(priority).toHaveValue("HIGH"));
    expect(screen.getByLabelText("Ticket Owner")).toBeEnabled();
  });
});

describe("Threads", () => {
  it("UI-DETAIL-08 / BR-23: the composer counts trimmed characters and submits only a body of 1 to 2000", async () => {
    mockServer(STAFF);
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const panel = screen.getByTestId("public-comments");
    const box = within(panel).getByLabelText("Add a public comment");
    const post = within(panel).getByRole("button", { name: "Post Comment" });
    const counter = within(panel).getByTestId("comments-counter");

    expect(counter).toHaveTextContent("0 / 2000");
    expect(post).toBeDisabled();

    await user.type(box, "   ");
    expect(counter).toHaveTextContent("0 / 2000");
    expect(post).toBeDisabled();

    await user.clear(box);
    await user.type(box, "Hello");
    expect(counter).toHaveTextContent("5 / 2000");
    expect(post).toBeEnabled();

    fireEvent.change(box, { target: { value: "x".repeat(2001) } });
    expect(counter).toHaveTextContent("2001 / 2000");
    expect(counter).toHaveClass("zg-char-counter--over");
    expect(post).toBeDisabled();

    fireEvent.change(box, { target: { value: "x".repeat(2000) } });
    expect(counter).not.toHaveClass("zg-char-counter--over");
    expect(post).toBeEnabled();
  });

  it("UI-DETAIL-08 / BR-24: a body containing markup is shown as literal text, and a new entry lands at the bottom", async () => {
    const markup = '<img src="x" onerror="window.__pwned = true"><b>bold</b>';
    mockServer(STAFF, {
      comments: [{ id: 1, ticketId: 118, author: actor(REQUESTER), body: markup, createdAt: "2026-05-12T09:14:00.000Z" }],
    });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const panel = screen.getByTestId("public-comments");
    expect(await within(panel).findByText(markup)).toBeInTheDocument();
    expect(panel.querySelector("img")).toBeNull();
    expect(panel.querySelector("b")).toBeNull();

    await user.type(within(panel).getByLabelText("Add a public comment"), "Second entry");
    await user.click(within(panel).getByRole("button", { name: "Post Comment" }));

    // §2.7: at the bottom of the thread, and the textarea clears.
    await waitFor(() => expect(within(panel).getAllByRole("listitem")).toHaveLength(2));
    expect(within(panel).getAllByRole("listitem")[1]).toHaveTextContent("Second entry");
    expect(within(panel).getByLabelText("Add a public comment")).toHaveValue("");
  });

  it("UI-DETAIL-08 / api-spec §8: after a comment is posted, staff see the Last Updated the server now holds", async () => {
    const before = "2026-05-13T10:00:00.000Z";
    const server = mockServer(STAFF, { ticket: makeTicket({ updatedAt: before }) });
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const lastUpdated = () => screen.getByText("Last Updated").nextElementSibling as HTMLElement;
    expect(lastUpdated()).toHaveTextContent(formatDateTime(before));

    const panel = screen.getByTestId("public-comments");
    await user.type(within(panel).getByLabelText("Add a public comment"), "A reply");
    await user.click(within(panel).getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(server.ticket.updatedAt).not.toBe(before));
    await waitFor(() => expect(lastUpdated()).toHaveTextContent(formatDateTime(server.ticket.updatedAt)));
  });

  it("UI-DETAIL-09 / AC-15: the internal thread differs in border, fill, heading, placeholder and button, and sits below the public one", async () => {
    const server = mockServer(STAFF);
    const user = userEvent.setup();
    renderDetail(STAFF);
    await loaded();

    const publicPanel = screen.getByTestId("public-comments");
    const internalPanel = screen.getByTestId("internal-notes");

    // Border and fill are carried by this class (§2.8); the other three
    // signals are text, checked directly.
    expect(internalPanel).toHaveClass("zg-thread--internal");
    expect(publicPanel).not.toHaveClass("zg-thread--internal");
    expect(within(internalPanel).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Internal Notes — not visible to the Requester",
    );
    expect(within(internalPanel).getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Internal note — the Requester cannot see this.",
    );
    expect(within(internalPanel).getByRole("button", { name: "Add Internal Note" })).toBeInTheDocument();
    expect(await within(internalPanel).findByText("No internal notes yet.")).toBeInTheDocument();

    expect(within(publicPanel).getByRole("textbox").getAttribute("placeholder")).not.toMatch(/internal/i);
    expect(within(publicPanel).queryByRole("button", { name: "Add Internal Note" })).not.toBeInTheDocument();

    // Below, never beside: one column, public first (§2.8).
    expect(publicPanel.compareDocumentPosition(internalPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(publicPanel.contains(internalPanel)).toBe(false);

    // And each composer posts to its own thread.
    await user.type(within(internalPanel).getByRole("textbox"), "Only for staff");
    await user.click(within(internalPanel).getByRole("button", { name: "Add Internal Note" }));
    await waitFor(() => expect(server.notes).toHaveLength(1));
    expect(server.comments).toHaveLength(0);
    expect(server.calls.find((call) => call.method === "POST")?.url).toMatch(/\/notes$/);
  });
});

describe("Problem Appears Resolved", () => {
  it("UI-DETAIL-10 / AC-16, BR-05: the owning Requester signals once, and the button becomes a dated line", async () => {
    const server = mockServer(REQUESTER, { ticket: makeTicket({ currentStatus: "IN_PROGRESS" }) });
    const user = userEvent.setup();
    renderDetail(REQUESTER);
    await loaded();

    const row = screen.getByTestId("resolution-row");
    expect(row).toHaveTextContent("Tell IT Staff the problem looks fixed. They decide when the ticket is resolved.");

    await user.click(within(row).getByRole("button", { name: "Problem Appears Resolved" }));

    const line = await screen.findByTestId("resolution-signalled");
    expect(line).toHaveTextContent(/You reported this looked resolved on/);
    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();
    expect(server.calls.some((call) => call.method === "POST" && call.url.endsWith("/appears-resolved"))).toBe(true);
    // BR-05: the status shown is unchanged.
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("UI-DETAIL-10 / BR-34: absent once the Ticket is Resolved, Closed or Cancelled", async () => {
    for (const status of ["RESOLVED", "CLOSED", "CANCELLED"] as const) {
      mockServer(REQUESTER, { ticket: makeTicket({ currentStatus: status }) });
      const { unmount } = renderDetail(REQUESTER);
      await loaded();

      expect(screen.queryByTestId("resolution-row"), status).not.toBeInTheDocument();
      expect(screen.queryByTestId("resolution-signalled"), status).not.toBeInTheDocument();
      unmount();
    }
  });

  it("UI-DETAIL-10 / §8.3: staff see no button, and the Requester's signal in the header instead", async () => {
    mockServer(STAFF, { ticket: makeTicket({ requesterResolvedAt: "2026-09-10T08:04:00.000Z" }) });
    renderDetail(STAFF);
    await loaded();

    expect(screen.getByTestId("requester-resolved")).toHaveTextContent(/Requester reported this resolved on/);
    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();
  });
});
