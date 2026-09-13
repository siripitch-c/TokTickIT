import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import StaffTicketQueue from "../../src/pages/StaffTicketQueue.js";
import type { AuthUser, StaffTicket } from "../../src/api.js";

// tests.md UI-QUEUE-01..08; ui-spec.md §7, §2.1, §2.4; specification.md FR-13,
// FR-16, BR-40, AC-07, AC-09, AC-28.
//
// Only the fetch layer is mocked. Reading the address, falling back to
// defaults, debouncing, sorting, paging and choosing between the five states are
// all the component's own logic. A probe renders the current query string, so
// the tests can check what §7.4 requires: that the screen and the URL agree.

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

const CATEGORIES = [
  { id: 1, name: "Account and Access" },
  { id: 2, name: "Hardware" },
];

const ASSIGNEES = [
  { id: 7, name: "Somsak Wattana", role: "IT_STAFF" as const },
  { id: 9, name: "Anong Kittisak", role: "ADMINISTRATOR" as const },
];

/** Odd tickets are unassigned, even ones are Somsak's; ticket 1 is In Progress. */
function makeTickets(count: number): StaffTicket[] {
  return Array.from({ length: count }, (_, i): StaffTicket => {
    const n = i + 1;
    const owned = n % 2 === 0;
    return {
      id: n,
      ticketNumber: `TKT-2026-${String(n).padStart(6, "0")}`,
      requesterId: 100 + n,
      requester: { id: 100 + n, name: `Requester ${n}`, role: "REQUESTER" },
      categoryId: n % 2 === 0 ? 2 : 1,
      relatedSystemId: 1,
      summary: `Queue summary ${n}`,
      description: `Description ${n}`,
      requestedPriority: "LOW",
      itPriority: "HIGH",
      currentStatus: n === 1 ? "IN_PROGRESS" : "NEW",
      ownerId: owned ? ASSIGNEES[0].id : null,
      owner: owned ? ASSIGNEES[0] : null,
      requesterResolvedAt: null,
      createdAt: "2026-05-12T09:14:00.000Z",
      updatedAt: "2026-05-13T09:14:00.000Z",
    };
  });
}

const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

interface QueueReply {
  tickets: StaffTicket[];
  totalItems?: number;
  status?: number;
}

/** Answers the three endpoints the screen calls, recording every queue request. */
function mockFetch(answer: (url: URL) => QueueReply) {
  const calls: URL[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const raw = String(input);
    if (raw.includes("/api/categories")) return reply(200, { data: CATEGORIES });
    if (raw.includes("/api/staff/assignees")) return reply(200, { data: ASSIGNEES });

    const url = new URL(raw, "http://localhost");
    calls.push(url);
    const { tickets, totalItems, status = 200 } = answer(url);
    if (status !== 200) {
      const code = status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR";
      return reply(status, { error: { code, message: "Refused." } });
    }
    const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
    const total = totalItems ?? tickets.length;
    return reply(200, {
      data: tickets,
      pagination: {
        page: Number(url.searchParams.get("page") ?? 1),
        pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  }) as unknown as typeof fetch;
  return { calls };
}

const lastQuery = (calls: URL[]) => calls[calls.length - 1].searchParams;

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderQueue(entry = "/staff/tickets") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          element={
            <>
              <Outlet context={STAFF} />
              <LocationProbe />
            </>
          }
        >
          <Route path="/staff/tickets" element={<StaffTicketQueue />} />
          <Route path="/tickets/:id" element={<p>Ticket detail page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

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

describe("IT Staff Ticket Queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Undo any viewport override so the next test starts on desktop.
    // @ts-expect-error deliberately removing the stub so setup.ts reinstates it
    delete window.matchMedia;
  });

  it("UI-QUEUE-01 / AC-09: the desktop table has the nine columns of §7.1, in order, with badges", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(3) }));
    renderQueue();

    const table = await screen.findByTestId("queue-table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent?.replace(/[↕↑↓]/g, "").trim());
    expect(headers).toEqual([
      "Ticket No.",
      "Summary",
      "Requester",
      "Category",
      "Requested Priority",
      "IT Priority",
      "Current Status",
      "Owner",
      "Last Updated",
    ]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const first = within(rows[0]);
    expect(first.getByRole("link", { name: "TKT-2026-000001" })).toHaveAttribute("href", "/tickets/1");
    expect(first.getByText("Requester 1")).toBeInTheDocument();
    // §2.1: the status is a labelled badge, not colour alone.
    expect(first.getByText("In Progress")).toHaveClass("zg-badge", "zg-badge--status-in-progress");
    expect(first.getByText("Unassigned")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Somsak Wattana")).toBeInTheDocument();

    // §7.1: neither IT Staff nor Administrators raise tickets.
    expect(screen.queryByRole("link", { name: /create ticket/i })).not.toBeInTheDocument();

    // The defaults of BR-40 are what was asked for.
    const query = lastQuery(calls);
    expect(query.get("sortBy")).toBe("updatedAt");
    expect(query.get("sortDir")).toBe("desc");
    expect(query.get("pageSize")).toBe("25");
  });

  it("UI-QUEUE-02 / AC-09: search and each of the five filters reach the API and the address", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(3) }));
    const user = userEvent.setup();
    renderQueue();
    await screen.findByTestId("queue-table");

    await user.type(screen.getByLabelText(/search tickets/i), "printer");
    await waitFor(() => expect(lastQuery(calls).get("search")).toBe("printer"));

    const category = screen.getByLabelText(/^Category$/);
    await waitFor(() => expect(within(category).getByRole("option", { name: "Hardware" })).toBeInTheDocument());
    await user.selectOptions(category, "2");
    await waitFor(() => expect(lastQuery(calls).get("category")).toBe("2"));

    await user.selectOptions(screen.getByLabelText(/^Requested Priority$/), "HIGH");
    await waitFor(() => expect(lastQuery(calls).get("requestedPriority")).toBe("HIGH"));

    await user.selectOptions(screen.getByLabelText(/^IT Priority$/), "LOW");
    await waitFor(() => expect(lastQuery(calls).get("itPriority")).toBe("LOW"));

    await user.selectOptions(screen.getByLabelText(/^Current Status$/), "WAITING_FOR_REQUESTER");
    await waitFor(() => expect(lastQuery(calls).get("status")).toBe("WAITING_FOR_REQUESTER"));

    // FR-16: the Owner names come from the assignee list, after the two fixed
    // choices.
    const owner = screen.getByLabelText(/^Owner$/);
    await waitFor(() => expect(within(owner).getByRole("option", { name: "Somsak Wattana" })).toBeInTheDocument());
    expect(within(owner).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All owners",
      "Unassigned",
      "Somsak Wattana",
      "Anong Kittisak",
    ]);
    await user.selectOptions(owner, "unassigned");
    await waitFor(() => expect(lastQuery(calls).get("owner")).toBe("unassigned"));

    // §7.4: the address carries every one of them, so the view can be shared.
    const address = new URLSearchParams(screen.getByTestId("location").textContent ?? "");
    expect(Object.fromEntries(address)).toEqual({
      search: "printer",
      category: "2",
      requestedPriority: "HIGH",
      itPriority: "LOW",
      status: "WAITING_FOR_REQUESTER",
      owner: "unassigned",
    });

    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => {
      const cleared = lastQuery(calls);
      for (const name of ["search", "category", "requestedPriority", "itPriority", "status", "owner"]) {
        expect(cleared.has(name), name).toBe(false);
      }
    });
    expect(screen.getByLabelText(/search tickets/i)).toHaveValue("");
    expect(screen.getByTestId("location")).toHaveTextContent(/^$/);
  });

  it("UI-QUEUE-02 / AC-28, BR-40: a hand-edited address falls back to its defaults, and the address is corrected to match", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(2) }));
    renderQueue("/staff/tickets?status=ESCALATED&pageSize=11&sortBy=summary&owner=me&category=2");
    await screen.findByTestId("queue-table");

    // The invalid values are shown as the defaults they fell back to...
    expect(screen.getByLabelText(/^Current Status$/)).toHaveValue("");
    expect(screen.getByLabelText(/^Owner$/)).toHaveValue("");
    expect(screen.getByLabelText(/tickets per page/i)).toHaveValue("25");
    // ...the valid one survives...
    await waitFor(() => expect(screen.getByLabelText(/^Category$/)).toHaveValue("2"));
    // ...and the address now says exactly what the screen shows.
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\?category=2$/));

    const query = lastQuery(calls);
    expect(query.has("status")).toBe(false);
    expect(query.has("owner")).toBe(false);
    expect(query.get("sortBy")).toBe("updatedAt");
    expect(query.get("pageSize")).toBe("25");
    expect(query.get("category")).toBe("2");
    // Correcting the address is not a second request: both addresses describe
    // the same queue.
    expect(calls).toHaveLength(1);
  });

  it("UI-QUEUE-03 / AC-09: a sortable header starts descending, reverses on a second click, and returns to page 1", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(25), totalItems: 60 }));
    const user = userEvent.setup();
    renderQueue("/staff/tickets?page=2");
    await screen.findByTestId("queue-table");
    expect(lastQuery(calls).get("page")).toBe("2");

    const header = (name: RegExp) => screen.getByRole("columnheader", { name });
    expect(header(/last updated/i)).toHaveAttribute("aria-sort", "descending");
    expect(header(/it priority/i)).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: /sort by it priority/i }));
    await waitFor(() => expect(lastQuery(calls).get("sortBy")).toBe("itPriority"));
    expect(lastQuery(calls).get("sortDir")).toBe("desc");
    // A different order makes the old page number meaningless.
    expect(lastQuery(calls).get("page")).toBe("1");
    await waitFor(() => expect(header(/it priority/i)).toHaveAttribute("aria-sort", "descending"));
    expect(header(/last updated/i)).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: /sorted by it priority/i }));
    await waitFor(() => expect(lastQuery(calls).get("sortDir")).toBe("asc"));
    await waitFor(() => expect(header(/it priority/i)).toHaveAttribute("aria-sort", "ascending"));
  });

  it("UI-QUEUE-04 / AC-09: 25 per page by default; Next, page numbers and page size all drive the request", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(25), totalItems: 60 }));
    const user = userEvent.setup();
    renderQueue();
    await screen.findByTestId("queue-table");

    expect(lastQuery(calls).get("pageSize")).toBe("25");
    expect(screen.getByLabelText(/tickets per page/i)).toHaveValue("25");
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent("Showing 1 to 25 of 60 tickets");

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => expect(lastQuery(calls).get("page")).toBe("2"));

    await user.click(await screen.findByRole("button", { name: "3" }));
    await waitFor(() => expect(lastQuery(calls).get("page")).toBe("3"));

    await user.selectOptions(await screen.findByLabelText(/tickets per page/i), "50");
    await waitFor(() => expect(lastQuery(calls).get("pageSize")).toBe("50"));
    expect(lastQuery(calls).get("page")).toBe("1");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\?pageSize=50$/);
  });

  it("UI-QUEUE-05 / AC-09: an empty queue and a filter that matched nothing are two different states", async () => {
    const { calls } = mockFetch(() => ({ tickets: [], totalItems: 0 }));
    const user = userEvent.setup();
    renderQueue();

    const empty = await screen.findByTestId("zg-state-empty");
    expect(empty).toHaveTextContent("No tickets have been created yet.");
    // §7.4: no call to action, because staff cannot create a ticket.
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();
    expect(within(empty).queryByRole("link")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Current Status$/), "CLOSED");

    const noResults = await screen.findByTestId("zg-state-no-results");
    expect(noResults).toHaveTextContent("No tickets match your filters.");
    expect(screen.queryByTestId("zg-state-empty")).not.toBeInTheDocument();

    await user.click(within(noResults).getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(lastQuery(calls).has("status")).toBe(false));
  });

  it("UI-QUEUE-06 / AC-07: a 403 renders the forbidden state, not the generic failure block", async () => {
    mockFetch(() => ({ tickets: [], status: 403 }));
    renderQueue();

    const forbidden = await screen.findByTestId("zg-state-forbidden");
    expect(screen.queryByTestId("zg-state-error")).not.toBeInTheDocument();

    // §12: the refusal takes focus, so a keyboard user hears it.
    const heading = within(forbidden).getByRole("heading", { name: /you do not have access to this page/i });
    await waitFor(() => expect(heading).toHaveFocus());
    // §2.4: one way out — back to the person's own landing screen.
    expect(within(forbidden).getByRole("link", { name: /back to ticket queue/i })).toHaveAttribute(
      "href",
      "/staff/tickets",
    );
    // And nothing about what was behind the refusal.
    expect(forbidden.textContent).not.toMatch(/TKT-|Requester/);
  });

  it("UI-QUEUE-07 / BR-43: a failure is the safe block with Retry, and Retry loads the queue", async () => {
    let fail = true;
    mockFetch(() => (fail ? { tickets: [], status: 500 } : { tickets: makeTickets(2) }));
    const user = userEvent.setup();
    renderQueue();

    const error = await screen.findByTestId("zg-state-error");
    expect(error).toHaveTextContent(/couldn.t load the ticket queue/i);
    expect(screen.queryByTestId("zg-state-forbidden")).not.toBeInTheDocument();

    fail = false;
    await user.click(within(error).getByRole("button", { name: /retry/i }));

    const table = await screen.findByTestId("queue-table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("UI-QUEUE-08 / AC-09: at 375px the table is replaced by cards, and an unclaimed ticket is flagged", async () => {
    useMobileViewport();
    mockFetch(() => ({ tickets: makeTickets(2) }));
    const user = userEvent.setup();
    renderQueue();

    const cards = await screen.findByTestId("queue-cards");
    // Replaced, not hidden: one representation in the DOM.
    expect(screen.queryByTestId("queue-table")).not.toBeInTheDocument();

    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // §7.3: the whole card is the link.
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/tickets/1");
    expect(within(items[0]).getByText("Unassigned")).toHaveClass("zg-owner-unassigned");
    expect(within(items[1]).queryByText("Unassigned")).not.toBeInTheDocument();
    expect(within(items[1]).getByText(/Somsak Wattana/)).toBeInTheDocument();

    // The filters live in the sheet, and pagination names the position in words.
    expect(screen.queryByLabelText(/^Owner$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^filters$/i }));
    expect(screen.getByLabelText(/^Owner$/)).toBeInTheDocument();
    expect(screen.getByText(/page 1 of 1/i)).toBeInTheDocument();
  });
});
