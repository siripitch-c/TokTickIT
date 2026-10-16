import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type { AuthUser, CurrentStatus, StaffDashboard as StaffDashboardData } from "../../src/api.js";
import StaffDashboardPage from "../../src/pages/StaffDashboard.js";

// tests.md UI-DASHS-01..05; ui-spec.md §4; specification.md FR-12..FR-16,
// BR-21, AC-15..AC-18, AC-22, AC-23.
//
// Everything the screen shows comes from one payload, and these assert that it
// shows that payload and nothing it worked out for itself. A card that counted
// its own rows would be a second answer to a question the server has already
// answered, and the two would disagree the moment somebody else wrote.

const STAFF: AuthUser = {
  id: 7,
  name: "Somsak Wattana",
  email: "somsak.wattana@example.edu",
  role: "IT_STAFF",
  isActive: true,
  mustChangePassword: false,
  createdAt: "2026-05-12T09:14:00.000Z",
  updatedAt: "2026-09-12T08:02:00.000Z",
};

const ADMIN: AuthUser = { ...STAFF, id: 9, name: "Anong Kittisak", role: "ADMINISTRATOR" };
const REQUESTER: AuthUser = { ...STAFF, id: 3, name: "Michael Brown", role: "REQUESTER" };

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

function makeRow(id: number, overrides: Partial<StaffDashboardData["recentlyUpdated"][number]> = {}) {
  return {
    id,
    ticketNumber: `TKT-2026-${String(id).padStart(6, "0")}`,
    summary: `Summary ${id}`,
    currentStatus: "IN_PROGRESS" as CurrentStatus,
    itPriority: "HIGH" as const,
    owner: { id: STAFF.id, name: STAFF.name, role: "IT_STAFF" as const },
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function makePayload(overrides: Partial<StaffDashboardData> = {}): StaffDashboardData {
  return {
    metrics: {
      unassigned: 4,
      assignedToMe: 7,
      myOpenActions: 3,
      waitingForRequester: 2,
      highItPriority: 5,
      resolvedLast7Days: 6,
      byStatus: BY_STATUS,
    },
    recentlyUpdated: [makeRow(101), makeRow(102)],
    needsAttention: [makeRow(201)],
    ...overrides,
  };
}

/** One reply, or a thrown status, for every fetch the screen makes. */
function mockDashboard(reply: StaffDashboardData | { status: number }) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if ("status" in reply) {
      return {
        ok: false,
        status: reply.status,
        json: async () => ({ error: { code: "FORBIDDEN", message: "No." } }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => reply } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

function renderDashboard(user: AuthUser) {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<Outlet context={user} />}>
          <Route path="/dashboard" element={<StaffDashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const grid = () => screen.findByTestId("metric-grid");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("The dashboard a staff member reads", () => {
  it("UI-DASHS-01 / FR-12, FR-14: six cards, the by-status strip and both lists render from the payload, and a row opens its Ticket", async () => {
    mockDashboard(makePayload());
    renderDashboard(STAFF);

    const cards = within(await grid()).getAllByRole("link");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Unassigned4Open and waiting for an owner.",
      "Assigned to me7Open tickets you own.",
      "My open actions3Still planned or in progress.",
      "Waiting for Requester2Waiting on somebody else.",
      "High IT priority5Open and marked high.",
      "Resolved in the last 7 days6Closed out this week.",
    ]);

    // §4.1 item 3: all eight statuses, in the order the matrix lists them.
    const strip = within(screen.getByTestId("by-status")).getAllByRole("listitem");
    expect(strip).toHaveLength(8);

    const recent = screen.getByTestId("recently-updated");
    expect(within(recent).getAllByRole("listitem")).toHaveLength(2);
    expect(within(screen.getByTestId("needs-attention")).getAllByRole("listitem")).toHaveLength(1);

    // The whole row is the link, so the row is the target rather than a small
    // piece of text inside it.
    const row = within(recent).getAllByRole("link")[0];
    expect(row).toHaveAttribute("href", "/tickets/101");
    expect(row).toHaveTextContent("TKT-2026-000101");
    expect(row).toHaveTextContent("Summary 101");
    expect(row).toHaveTextContent("Somsak Wattana");
    expect(row).toHaveTextContent("2 hours ago");
  });

  it("UI-DASHS-02 / BR-21: a metric of zero renders the number, keeps its sub-line, and is still a link", async () => {
    mockDashboard(
      makePayload({
        metrics: { ...makePayload().metrics, unassigned: 0, myOpenActions: 0 },
        recentlyUpdated: [],
        needsAttention: [],
      }),
    );
    renderDashboard(STAFF);

    const unassigned = await screen.findByTestId("metric-unassigned");
    expect(unassigned).toHaveTextContent("0");
    expect(unassigned).toHaveTextContent("The queue is clear.");
    expect(unassigned.tagName).toBe("A");
    expect(unassigned).toHaveAttribute("href", "/staff/tickets?owner=unassigned&status=open");

    expect(screen.getByTestId("metric-my-open-actions")).toHaveTextContent("No unfinished actions.");

    // §4.4: an empty list says so inside its own card. The cards above are fine,
    // so a page-level empty state would be a lie about the whole screen.
    expect(screen.getByTestId("recently-updated")).toHaveTextContent("No open tickets have been updated.");
    expect(screen.getByTestId("needs-attention")).toHaveTextContent(
      "Nothing is waiting longer than it should.",
    );
    expect(screen.queryByTestId("zg-state-empty")).not.toBeInTheDocument();

    // A zero in the strip is a row like any other (BR-21: never hidden).
    const cancelled = within(screen.getByTestId("by-status")).getByRole("link", { name: /^Cancelled, 0,/ });
    expect(cancelled).toHaveAttribute("href", "/staff/tickets?status=CANCELLED");
  });

  it("UI-DASHS-03 / AC-17, FR-15: every card carries the query that produced its number", async () => {
    mockDashboard(makePayload());
    renderDashboard(STAFF);
    await grid();

    // ui-spec.md §4.5, in full. These strings are the contract between the
    // card and the queue: if one of them drifts, the number a person opens
    // stops matching the number they pressed.
    const expected: [string, string][] = [
      ["metric-unassigned", "/staff/tickets?owner=unassigned&status=open"],
      ["metric-assigned-to-me", "/staff/tickets?owner=me&status=open"],
      ["metric-my-open-actions", "/staff/tickets?actionsAssignedTo=me&actionStatus=open"],
      ["metric-waiting-for-requester", "/staff/tickets?status=WAITING_FOR_REQUESTER"],
      ["metric-high-it-priority", "/staff/tickets?itPriority=HIGH&status=open"],
      ["metric-resolved-in-the-last-days", "/staff/tickets?status=RESOLVED"],
    ];
    for (const [testId, href] of expected) {
      expect(screen.getByTestId(testId), testId).toHaveAttribute("href", href);
    }

    // §11: the accessible name reads label, then value, then destination, so a
    // screen-reader user never meets a bare number.
    expect(screen.getByTestId("metric-unassigned")).toHaveAccessibleName(
      "Unassigned, 4 tickets, open the queue filtered to unassigned tickets",
    );
  });

  it("UI-DASHS-03 / ui-spec §11: one ticket is announced as one ticket, not as \"1 tickets\"", async () => {
    mockDashboard(makePayload({ metrics: { ...makePayload().metrics, unassigned: 1 } }));
    renderDashboard(STAFF);
    await grid();

    expect(screen.getByTestId("metric-unassigned")).toHaveAccessibleName(
      "Unassigned, 1 ticket, open the queue filtered to unassigned tickets",
    );
  });

  it("UI-DASHS-04 / AC-18: the Accounts block is rendered for an Administrator and absent for IT Staff", async () => {
    mockDashboard(makePayload({ administratorMetrics: { activeUsers: 12, inactiveUsers: 3 } }));
    const admin = renderDashboard(ADMIN);

    const accounts = await screen.findByTestId("administrator-metrics");
    expect(within(accounts).getByTestId("metric-active-users")).toHaveTextContent("12");
    expect(within(accounts).getByTestId("metric-inactive-users")).toHaveTextContent("3");
    expect(within(accounts).getByTestId("metric-active-users")).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    admin.unmount();

    // IT Staff do not receive the key, so there is nothing on screen to hide.
    mockDashboard(makePayload());
    renderDashboard(STAFF);
    await grid();
    expect(screen.queryByTestId("administrator-metrics")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Accounts" })).not.toBeInTheDocument();
  });
});

describe("While it loads, and when it cannot", () => {
  it("UI-DASHS-05 / ui-spec §4.4: the heading renders at once, the grid's shape stands in for it, and a failure offers Retry", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ) as unknown as typeof fetch;
    renderDashboard(STAFF);

    // The page header is there before any answer: the screen never looks like
    // it failed to exist.
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    const skeleton = screen.getByTestId("zg-state-loading");
    // §4.4: the cards' shape *and* the lists' shape. The lists are the taller
    // half of the page, so a skeleton that covered only the cards would still
    // let the screen double in height the moment the answer arrived.
    expect(skeleton.querySelectorAll(".zg-metric--skeleton")).toHaveLength(6);
    expect(skeleton.querySelectorAll(".zg-dashboard-list")).toHaveLength(2);
    expect(skeleton.querySelectorAll(".zg-skeleton-row").length).toBeGreaterThan(0);

    resolve!({ ok: true, status: 200, json: async () => makePayload() });
    await grid();
    expect(screen.queryByTestId("zg-state-loading")).not.toBeInTheDocument();
  });

  it("UI-DASHS-05 / AC-23: the dashboard fails as one unit, and Retry asks again", async () => {
    const user = userEvent.setup();
    mockDashboard({ status: 500 });
    renderDashboard(STAFF);

    const error = await screen.findByTestId("zg-state-error");
    expect(error).toHaveTextContent(/We couldn.t load the dashboard\./);
    // Six half-loaded cards would be worse than one honest failure, so no card
    // survives the failure.
    expect(screen.queryByTestId("metric-grid")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const calls = mockDashboard(makePayload());
    await user.click(within(error).getByRole("button", { name: "Retry" }));

    await grid();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId("zg-state-error")).not.toBeInTheDocument();
  });

  it("UI-DASHS-05 / AC-22: a Requester who types the address meets the forbidden state, not an error", async () => {
    mockDashboard({ status: 403 });
    renderDashboard(REQUESTER);

    expect(await screen.findByTestId("zg-state-forbidden")).toBeInTheDocument();
    // §2.4: the refusal says nothing about what is behind it, and offers the
    // way back to the caller's own landing screen.
    expect(screen.getByRole("link", { name: /Back to My Tickets/ })).toBeInTheDocument();
    expect(screen.queryByTestId("metric-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("zg-state-error")).not.toBeInTheDocument();
  });
});
