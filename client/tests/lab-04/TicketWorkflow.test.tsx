import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurrentStatus } from "../../src/api.js";
import { allowedTransitions } from "../../src/lib/statusTransitions.js";
import { STAFF, lastPatch, makeTicket, mockServer, refused, renderDetail } from "../support/ticketServer.js";

// tests.md UI-FLOW-01..04; ui-spec.md §2.3 and §7; specification.md FR-08,
// FR-24, BR-16, BR-18, BR-26, BR-27, AC-09, AC-12, AC-13.
//
// The Operations panel from the Ticket's side. The server is the authority for
// every rule here — what these assert is that the screen offers what the rule
// permits, explains what it does not, and never pretends a refused write landed.

const loaded = () => screen.findByTestId("detail-ticket-number");
const statusSelect = () => screen.getByLabelText("Current Status");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("The status control", () => {
  it("UI-FLOW-01 / FR-08: each status offers exactly the moves the matrix permits from it, and nothing else", async () => {
    // Every status, not a sample: the option list is the only place the user
    // learns what is possible, and a wrong one costs them a refused attempt.
    for (const from of [
      "NEW",
      "OPEN",
      "IN_PROGRESS",
      "WAITING_FOR_REQUESTER",
      "RESOLVED",
      "CLOSED",
      "REOPENED",
      "CANCELLED",
    ] as CurrentStatus[]) {
      mockServer(STAFF, { ticket: makeTicket({ currentStatus: from }) });
      const view = renderDetail(STAFF);
      await loaded();

      const options = within(statusSelect())
        .getAllByRole("option")
        .map((option) => (option as HTMLOptionElement).value);

      // The first option is the Ticket's own status, marked "(current)", so
      // the select has something truthful to show; it is not a move.
      expect(options[0], from).toBe(from);
      expect(options.slice(1), from).toEqual(allowedTransitions(from));

      // Cancelled leads nowhere, so there is nothing to choose and the control
      // says so rather than sitting enabled and empty.
      if (from === "CANCELLED") expect(statusSelect()).toBeDisabled();

      view.unmount();
    }
  });

  it("UI-FLOW-02 / AC-09, BR-18: with open Actions, Resolve cannot be chosen and the reason is attached to the control", async () => {
    mockServer(STAFF, {
      ticket: makeTicket({ currentStatus: "IN_PROGRESS", openActionCount: 2 }),
    });
    renderDetail(STAFF);
    await loaded();

    const resolve = within(statusSelect()).getByRole("option", { name: "Resolved" });

    // Still listed: removing it would leave the reader wondering where it went.
    expect(resolve).toBeDisabled();

    const reason = "2 actions on this ticket are still open. Complete or cancel them before resolving it.";
    expect(screen.getByText(reason)).toBeInTheDocument();
    // A11Y-07: the reason is attached to the select, so a keyboard user meets
    // it before choosing rather than after being refused.
    const described = statusSelect().getAttribute("aria-describedby") ?? "";
    const text = described
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(text).toContain(reason);
  });

  it("UI-FLOW-02 / AC-09: a server refusal is rendered as the conflict block, with the way to the Actions it names", async () => {
    // The count the screen holds says the move is fine; the server disagrees,
    // because somebody added an Action in between. The server wins, and the
    // screen shows what it said rather than a message of its own invention.
    const server = mockServer(STAFF, {
      ticket: makeTicket({ currentStatus: "IN_PROGRESS", openActionCount: 0 }),
      patch: (operation) =>
        operation === "status"
          ? refused(
              409,
              "OPEN_ACTIONS_REMAIN",
              "1 action on this ticket is still open. Complete or cancel it before resolving it.",
            )
          : undefined,
    });
    renderDetail(STAFF);
    await loaded();

    await userEvent.selectOptions(statusSelect(), "RESOLVED");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "1 action on this ticket is still open. Complete or cancel it before resolving it.",
    );
    // ui-spec.md §7: the refusal points at the work, because that is where the
    // reader has to go to clear it.
    expect(within(alert).getByRole("link", { name: "Go to Actions Taken" })).toHaveAttribute(
      "href",
      "#actions-taken",
    );
    // AC-09: the select goes back to the status the Ticket actually holds.
    await waitFor(() => expect(statusSelect()).toHaveValue("IN_PROGRESS"));
    expect(server.ticket.currentStatus).toBe("IN_PROGRESS");
  });

  it("UI-FLOW-03 / BR-16: both terminal moves confirm first, and dismissing the question sends nothing", async () => {
    const server = mockServer(STAFF, { ticket: makeTicket({ currentStatus: "RESOLVED" }) });
    renderDetail(STAFF);
    await loaded();

    // Resolved offers Closed and Reopened; Closed is the terminal one here.
    await userEvent.selectOptions(statusSelect(), "CLOSED");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/closed/i);

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // BR-33: the question is the safeguard, so answering "no" must leave the
    // Ticket exactly as it was — and the select with it.
    expect(lastPatch(server)).toBeUndefined();
    expect(statusSelect()).toHaveValue("RESOLVED");
  });

  it("UI-FLOW-03 / BR-16: Cancelled confirms too, and confirming sends the move with the version on screen", async () => {
    const server = mockServer(STAFF, { ticket: makeTicket({ currentStatus: "OPEN", version: 4 }) });
    renderDetail(STAFF);
    await loaded();

    await userEvent.selectOptions(statusSelect(), "CANCELLED");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Move to Cancelled" }));

    await waitFor(() => expect(statusSelect()).toHaveValue("CANCELLED"));
    // BR-26: the version sent is the one the screen was showing, not one it
    // fetched behind the user's back — otherwise the precondition guards
    // nothing (lab-04/api-spec.md §6).
    expect(lastPatch(server)?.body).toEqual({ version: 4, currentStatus: "CANCELLED" });
  });
});

describe("Stale writes", () => {
  it("UI-FLOW-04 / BR-27, FR-24: a stale status write offers Reload, re-reads the Ticket, and leaves the select on the real status", async () => {
    let refuse = true;
    const server = mockServer(STAFF, {
      ticket: makeTicket({ currentStatus: "OPEN", version: 1 }),
      patch: (operation) =>
        operation === "status" && refuse
          ? refused(409, "STALE_UPDATE", "This ticket changed after you opened it. Reload to see the current version.")
          : undefined,
    });
    renderDetail(STAFF);
    await loaded();

    await userEvent.selectOptions(statusSelect(), "IN_PROGRESS");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket changed after you opened it. Reload to see the current version.");
    // §2.3: a stale write is not a validation message. It offers the one thing
    // that helps, and the record is never silently resubmitted.
    const reload = within(alert).getByRole("button", { name: "Reload" });
    // ui-spec.md §11: focus lands on Reload, because the change is about to be
    // lost if the message is scrolled past.
    await waitFor(() => expect(reload).toHaveFocus());
    await waitFor(() => expect(statusSelect()).toHaveValue("OPEN"));
    expect(server.ticket.currentStatus).toBe("OPEN");

    // Meanwhile the other person's change is what the server now holds.
    refuse = false;
    server.ticket = { ...server.ticket, currentStatus: "WAITING_FOR_REQUESTER", version: 2 };
    await userEvent.click(reload);

    // Reload re-reads rather than resubmitting: the screen shows what the other
    // person did, and the user decides again from there.
    await waitFor(() => expect(statusSelect()).toHaveValue("WAITING_FOR_REQUESTER"));
    const patches = server.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
  });

  it("UI-FLOW-04 / BR-26: after a stale owner write, the next attempt carries the version the reload brought back", async () => {
    let refuse = true;
    const server = mockServer(STAFF, {
      ticket: makeTicket({ version: 1 }),
      patch: (operation) =>
        operation === "owner" && refuse
          ? refused(409, "STALE_UPDATE", "This ticket changed after you opened it. Reload to see the current version.")
          : undefined,
    });
    renderDetail(STAFF);
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    const reload = within(await screen.findByRole("alert")).getByRole("button", { name: "Reload" });
    refuse = false;
    server.ticket = { ...server.ticket, version: 7 };
    await userEvent.click(reload);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    // The point of the reload: the retry is made against what is current now,
    // so the second attempt is not refused for the same reason as the first.
    await waitFor(() => expect(lastPatch(server)?.body).toEqual({ version: 7, ownerId: STAFF.id }));
  });
});
