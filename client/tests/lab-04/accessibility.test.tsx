import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type { AuthUser, CurrentStatus, StaffDashboard as StaffDashboardData } from "../../src/api.js";
import StaffDashboardPage from "../../src/pages/StaffDashboard.js";
import { STAFF, makeAction, makeTicket, mockServer, refused, renderDetail } from "../support/ticketServer.js";

// tests.md A11Y-01..A11Y-08; ui-spec.md §11, §12; Lab 2 ui-spec.md §9 and
// Lab 3 §12 still apply in full and are covered by `lab-03/accessibility.test.tsx`.
//
// Lab 3's file uses the same A11Y-01..09 numbering for different claims: the
// ids are per sprint, as they are for UNIT and E2E. This file is Lab 4's eight,
// and each one is a sentence from §11 turned into an assertion.
//
// What these cannot do: none of them proves a screen reader says anything. They
// prove the markup a screen reader reads - a heading is a heading, a list is a
// list, a name contains the three things §11 asks for. The §5 checklist is
// where a person confirms the rest at each viewport.

/** The four, in the order `ActionStatus` declares them. */
const ACTION_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

const BY_STATUS: Record<CurrentStatus, number> = {
  NEW: 3,
  OPEN: 4,
  IN_PROGRESS: 6,
  WAITING_FOR_REQUESTER: 2,
  RESOLVED: 5,
  CLOSED: 11,
  REOPENED: 1,
  CANCELLED: 0,
};

const DASHBOARD: StaffDashboardData = {
  metrics: {
    unassigned: 4,
    assignedToMe: 1,
    myOpenActions: 3,
    waitingForRequester: 2,
    highItPriority: 5,
    resolvedLast7Days: 6,
    byStatus: BY_STATUS,
  },
  recentlyUpdated: [],
  needsAttention: [],
};

function renderStaffDashboard() {
  globalThis.fetch = vi.fn(
    async () => ({ ok: true, status: 200, json: async () => DASHBOARD }) as unknown as Response,
  ) as unknown as typeof fetch;

  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<Outlet context={STAFF as AuthUser} />}>
          <Route path="/dashboard" element={<StaffDashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const panel = () => screen.findByTestId("actions-taken");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("The dashboards", () => {
  it("A11Y-01 / ui-spec §11: a metric card is one control whose name reads label, then value, then destination", async () => {
    renderStaffDashboard();
    await screen.findByTestId("metric-grid");

    // §11's own example: "Unassigned, 4 tickets, open the queue filtered to
    // unassigned" - so a screen-reader user never hears a bare number.
    const card = screen.getByTestId("metric-unassigned");
    expect(card.tagName, "a metric card should be one link").toBe("A");
    const name = card.getAttribute("aria-label") ?? "";
    expect(name).toMatch(/^Unassigned,/);
    expect(name).toContain("4");
    expect(name).toMatch(/queue/i);

    // The order matters, not just the presence: label before value before
    // destination is what makes it a sentence rather than three facts.
    expect(name.indexOf("Unassigned")).toBeLessThan(name.indexOf("4"));
    expect(name.indexOf("4")).toBeLessThan(name.search(/queue/i));

    // Singular where the number is one, because "1 tickets" is the kind of
    // thing a sighted reader never sees and a listener always hears.
    expect(screen.getByTestId("metric-assigned-to-me").getAttribute("aria-label")).toContain("1 ticket,");
  });

  it("A11Y-02 / ui-spec §11: the by-status strip is a list of links, so its length is announced", async () => {
    renderStaffDashboard();
    const strip = await screen.findByTestId("by-status");

    // A list, not a row of divs: a screen reader says "list, 8 items" only if
    // the markup says so, and the strip's whole job is to be countable.
    const list = within(strip).getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(Object.keys(BY_STATUS).length);

    for (const item of items) {
      expect(within(item).getByRole("link")).toBeInTheDocument();
    }
  });
});

describe("The Actions panel", () => {
  it("A11Y-03 / ui-spec §11: Actions Taken is a heading, and the Actions are an ordered list", async () => {
    mockServer(STAFF, { actions: [makeAction({ id: 1 }), makeAction({ id: 2 })] });
    renderDetail(STAFF);

    const section = await panel();
    // In the document outline, so the panel can be jumped to - the Lab 3
    // threads already are, and an inconsistent one is worse than neither.
    expect(within(section).getByRole("heading", { name: /^Actions Taken/ })).toBeInTheDocument();

    const list = within(section).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("A11Y-04 / ui-spec §11: the follow-up note is announced as required the moment Yes is chosen", async () => {
    const user = userEvent.setup();
    mockServer(STAFF, { actions: [] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));

    // With No chosen there is no note to require, and nothing claims otherwise.
    expect(screen.queryByLabelText(/follow-up note/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Yes" }));

    const note = await screen.findByLabelText(/follow-up note/i);
    expect(note).toHaveAttribute("aria-required", "true");

    // And the group it belongs to describes it, so the relationship between the
    // choice and the field is in the markup rather than only in the layout.
    const group = screen.getByRole("group", { name: /follow-up/i });
    expect(group).toHaveAttribute("aria-describedby");
  });

  it("A11Y-07 / ui-spec §11: every action status carries its label as text, never colour alone", async () => {
    mockServer(STAFF, {
      actions: ACTION_STATUSES.map((status, index) => makeAction({ id: index + 1, status })),
    });
    renderDetail(STAFF);

    const section = await panel();
    // All four, side by side, each readable with the stylesheet switched off.
    for (const status of ACTION_STATUSES) {
      const label = status
        .toLowerCase()
        .replace("_", " ")
        .replace(/^./, (c) => c.toUpperCase());
      expect(within(section).getAllByText(new RegExp(label, "i")).length, status).toBeGreaterThan(0);
    }
  });

  it("A11Y-06 / ui-spec §11: the stale-write alert is announced and takes focus", async () => {
    const user = userEvent.setup();
    mockServer(STAFF, {
      actions: [makeAction({ id: 1, status: "PLANNED" })],
      actionWrite: () => refused(409, "STALE_UPDATE", "This action changed while you were editing it."),
    });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Cancel action" }));
    // The dialog's confirm carries the same name as the row control that opened
    // it, so this is scoped rather than matched by name alone.
    const confirm = await screen.findByRole("dialog");
    await user.click(within(confirm).getByRole("button", { name: "Cancel action" }));

    // role="alert" so it is read without being reached, and focus on Reload
    // because the next thing the person does should not be losing their work.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/changed while you were editing/i);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).toHaveFocus());
  });

  it("A11Y-08 / ui-spec §11: the cancel dialog traps focus and returns it to the control that opened it", async () => {
    const user = userEvent.setup();
    mockServer(STAFF, { actions: [makeAction({ id: 1, status: "PLANNED" })] });
    renderDetail(STAFF);

    const section = await panel();
    const trigger = within(section).getByRole("button", { name: "Cancel action" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    // Focus starts inside, on the way out rather than on the destructive
    // button: pressing Enter on a dialog nobody has read yet should do nothing.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Tabbing cannot leave while it is open.
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement), `tab ${i + 1} left the dialog`).toBe(true);
    }

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("The resolution gate", () => {
  it("A11Y-05 / ui-spec §11: a blocked Resolve points at the sentence that explains it", async () => {
    mockServer(STAFF, {
      ticket: makeTicket({ currentStatus: "IN_PROGRESS", openActionCount: 2, ownerId: STAFF.id }),
      actions: [makeAction({ id: 1, status: "PLANNED" }), makeAction({ id: 2, status: "IN_PROGRESS" })],
    });
    renderDetail(STAFF);
    await screen.findByTestId("detail-ticket-number");

    // AC-09 keeps Resolve listed rather than removing it, so the reason has to
    // be reachable without choosing it and finding out.
    const status = screen.getByLabelText(/^Current Status$/);
    const describedBy = (status.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    expect(describedBy.length, "the status control describes nothing").toBeGreaterThan(1);

    const text = describedBy
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(text).toMatch(/2/);
    expect(text).toMatch(/action/i);
  });
});
