import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type { AuthUser, CurrentStatus, RequesterDashboard as Data } from "../../src/api.js";
import RequesterDashboardPage from "../../src/pages/RequesterDashboard.js";

// tests.md UI-DASHR-01..04; ui-spec.md §5; specification.md FR-17..FR-19,
// BR-22, AC-19, AC-21.
//
// The Requester's half of the dashboard. Everything it shows comes from one
// payload; what these assert is that it shows that payload, names the reason a
// Ticket needs attention, and sends each card to the list that produced it.

const REQUESTER: AuthUser = {
  id: 3,
  name: "Michael Brown",
  email: "michael.brown@example.edu",
  role: "REQUESTER",
  isActive: true,
  mustChangePassword: false,
  createdAt: "2026-05-12T09:14:00.000Z",
  updatedAt: "2026-09-12T08:02:00.000Z",
};

function makeRow(id: number, currentStatus: CurrentStatus = "OPEN") {
  return {
    id,
    ticketNumber: `TKT-2026-${String(id).padStart(6, "0")}`,
    summary: `Summary ${id}`,
    currentStatus,
    requestedPriority: "MEDIUM" as const,
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  };
}

function makePayload(overrides: Partial<Data> = {}): Data {
  return {
    metrics: { openTickets: 3, waitingForMe: 1, resolvedAwaitingConfirmation: 2 },
    attention: [makeRow(41, "WAITING_FOR_REQUESTER"), makeRow(42, "RESOLVED")],
    recentlyUpdated: [makeRow(41, "WAITING_FOR_REQUESTER"), makeRow(43)],
    recentlyResolved: [makeRow(42, "RESOLVED")],
    ...overrides,
  };
}

function mockDashboard(reply: Data | { status: number }) {
  globalThis.fetch = vi.fn(async () => {
    if ("status" in reply) {
      return {
        ok: false,
        status: reply.status,
        json: async () => ({ error: { code: "FORBIDDEN", message: "No." } }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => reply } as unknown as Response;
  }) as unknown as typeof fetch;
}

function renderDashboard(user: AuthUser = REQUESTER) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<Outlet context={user} />}>
          <Route path="/dashboard" element={<RequesterDashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const grid = () => screen.findByTestId("metric-grid");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("The dashboard a Requester reads", () => {
  it("UI-DASHR-01 / FR-17: three cards render from the payload with the labels BR-22 names", async () => {
    mockDashboard(makePayload());
    renderDashboard();

    const cards = within(await grid()).getAllByRole("link");
    expect(cards.map((card) => card.textContent)).toEqual([
      "My open tickets3Still being worked on.",
      "Waiting for me1IT Staff need something from you.",
      "Resolved, awaiting my confirmation2Check these and confirm they are fixed.",
    ]);

    // Three, not six: this is not the staff dashboard with things removed.
    expect(cards).toHaveLength(3);
    expect(screen.queryByTestId("by-status")).not.toBeInTheDocument();
  });

  it("UI-DASHR-02 / FR-18: the attention panel combines both kinds of row, each carrying why it is there", async () => {
    mockDashboard(makePayload());
    renderDashboard();
    await grid();

    const panel = screen.getByTestId("attention");
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(2);

    // §5.1: the reason is written where the row is, not left for the reader to
    // infer from a badge whose meaning they would have to know.
    expect(within(panel).getByText("Waiting for your reply")).toBeInTheDocument();
    expect(within(panel).getByText("Resolved — please confirm")).toBeInTheDocument();

    // And the whole row opens the Ticket, as on the staff dashboard.
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/tickets/41");
  });

  it("UI-DASHR-03 / AC-21: a Requester with nothing sees three zeros, the empty line, and one call to action", async () => {
    mockDashboard(
      makePayload({
        metrics: { openTickets: 0, waitingForMe: 0, resolvedAwaitingConfirmation: 0 },
        attention: [],
        recentlyUpdated: [],
        recentlyResolved: [],
      }),
    );
    renderDashboard();
    await grid();

    expect(screen.getByTestId("metric-openTickets")).toHaveTextContent("0");
    expect(screen.getByTestId("metric-openTickets")).toHaveTextContent("Nothing open at the moment.");
    expect(screen.getByTestId("attention")).toHaveTextContent("Nothing needs you right now.");

    // The one call to action on either dashboard: for somebody with nothing
    // open, raising a ticket is the only useful next step.
    const cta = within(screen.getByTestId("create-ticket-cta")).getByRole("link", { name: "Create Ticket" });
    expect(cta).toHaveAttribute("href", "/tickets/new");
  });

  it("UI-DASHR-03 / AC-21: a Requester who has tickets gets no call to action", async () => {
    mockDashboard(makePayload());
    renderDashboard();
    await grid();

    // It appears only when there is nothing else to look at; otherwise the
    // screen already has somewhere for the reader to go.
    expect(screen.queryByTestId("create-ticket-cta")).not.toBeInTheDocument();
  });

  it("UI-DASHR-04 / FR-19: each card links into My Tickets with the filter that produced its number", async () => {
    mockDashboard(makePayload());
    renderDashboard();
    await grid();

    // ui-spec.md §5.3, in full.
    const expected: [string, string][] = [
      ["metric-openTickets", "/my-tickets?status=open"],
      ["metric-waitingForMe", "/my-tickets?status=WAITING_FOR_REQUESTER"],
      ["metric-resolvedAwaitingConfirmation", "/my-tickets?status=RESOLVED"],
    ];
    for (const [testId, href] of expected) {
      expect(screen.getByTestId(testId), testId).toHaveAttribute("href", href);
    }

    // §11: label, then value, then destination — never a bare number.
    expect(screen.getByTestId("metric-waitingForMe")).toHaveAccessibleName(
      "Waiting for me, 1 ticket, open my tickets waiting for a reply",
    );
  });
});

describe("While it loads, and when it cannot", () => {
  it("UI-DASHR-05 / ui-spec §5.2, AC-23: the heading renders at once, and a failure offers Retry", async () => {
    mockDashboard({ status: 500 });
    renderDashboard();

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    const error = await screen.findByTestId("zg-state-error");
    expect(error).toHaveTextContent(/We couldn.t load the dashboard\./);
    expect(within(error).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByTestId("metric-grid")).not.toBeInTheDocument();
  });

  it("UI-DASHR-05 / AC-22: a staff member who reaches the Requester variant meets the forbidden state", async () => {
    mockDashboard({ status: 403 });
    renderDashboard({ ...REQUESTER, role: "IT_STAFF" });

    expect(await screen.findByTestId("zg-state-forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-grid")).not.toBeInTheDocument();
  });
});
