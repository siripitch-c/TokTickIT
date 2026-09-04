import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import MyTickets from "../../src/pages/MyTickets.js";

// tests.md UI-LIST-01..07; ui-spec.md §6.4; specification.md BR-07, BR-13..BR-18,
// BR-37, AC-09/AC-10/AC-12/AC-15.
// Only the fetch layer is mocked — filtering state, sorting state, paging and
// the empty/no-results distinction are the component's real logic.

const REQUESTER = { id: 2, name: "Michael Brown" };
const OTHER_REQUESTER = { id: 1, name: "Jennifer Anderson" };
const CATEGORIES = [
  { id: 1, name: "Account and Access" },
  { id: 2, name: "Hardware" },
];

function makeTickets(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1 + offset;
    return {
      id: n,
      ticketNumber: `TKT-2026-${String(n).padStart(6, "0")}`,
      requesterId: REQUESTER.id,
      categoryId: n % 2 === 0 ? 2 : 1,
      relatedSystemId: 1,
      summary: `Ticket summary ${n}`,
      description: `Description ${n}`,
      requestedPriority: "MEDIUM" as const,
      itPriority: null,
      currentStatus: "NEW" as const,
      createdAt: "2026-05-12T09:14:00.000Z",
      updatedAt: "2026-05-12T09:14:00.000Z",
    };
  });
}

interface ListReply {
  tickets: ReturnType<typeof makeTickets>;
  totalItems?: number;
  status?: number;
}

/** Records every ticket-list URL so tests can assert what the screen asked for. */
function mockFetch(reply: (url: URL) => ListReply) {
  const calls: URL[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const raw = String(input);
    if (raw.includes("/api/categories")) {
      return { ok: true, status: 200, json: async () => ({ data: CATEGORIES }) } as unknown as Response;
    }
    const url = new URL(raw, "http://localhost");
    calls.push(url);
    const { tickets, totalItems, status = 200 } = reply(url);
    if (status !== 200) {
      return {
        ok: false,
        status,
        json: async () => ({ error: { code: "INTERNAL_ERROR", message: "boom" } }),
      } as unknown as Response;
    }
    const pageSize = Number(url.searchParams.get("pageSize") ?? 10);
    const total = totalItems ?? tickets.length;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: tickets,
        pagination: {
          page: Number(url.searchParams.get("page") ?? 1),
          pageSize,
          totalItems: total,
          totalPages: Math.ceil(total / pageSize),
        },
      }),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls };
}

function Wrapper({ requester }: { requester: { id: number; name: string } }) {
  return (
    <MemoryRouter initialEntries={["/my-tickets"]}>
      <Routes>
        <Route element={<Outlet context={requester} />}>
          <Route path="/my-tickets" element={<MyTickets />} />
        </Route>
        <Route path="/tickets/new" element={<p>Create Ticket page</p>} />
        <Route path="/tickets/:id" element={<p>Ticket detail page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const lastQuery = (calls: URL[]) => calls[calls.length - 1].searchParams;

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

describe("My Tickets screen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Undo any viewport override so the next test starts on desktop.
    // @ts-expect-error deliberately removing the stub so setup.ts reinstates it
    delete window.matchMedia;
  });

  it("UI-LIST-01: shows the loading state, then the list; a failure is safe and retryable", async () => {
    let fail = true;
    mockFetch(() => (fail ? { tickets: [], status: 500 } : { tickets: makeTickets(3) }));

    render(<Wrapper requester={REQUESTER} />);
    expect(screen.getByTestId("zg-state-loading")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("zg-state-error")).toBeInTheDocument());
    expect(screen.queryByTestId("ticket-table")).not.toBeInTheDocument();

    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + 3
  });

  it("UI-LIST-02: a Requester with no tickets sees the empty state and no filter controls (BR-37)", async () => {
    mockFetch(() => ({ tickets: [] }));

    render(<Wrapper requester={REQUESTER} />);

    await waitFor(() => expect(screen.getByTestId("zg-state-empty")).toBeInTheDocument());
    expect(screen.getByText(/created any tickets yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^create ticket$/i })).toBeInTheDocument();

    // Nothing to filter, so §6.4 hides the controls entirely.
    expect(screen.queryByLabelText(/search tickets/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("zg-state-no-results")).not.toBeInTheDocument();
  });

  it("UI-LIST-03: a search that matches nothing is a no-results state, not the empty state (BR-37, AC-10)", async () => {
    const { calls } = mockFetch((url) =>
      url.searchParams.has("search") ? { tickets: [], totalItems: 0 } : { tickets: makeTickets(3) },
    );
    const user = userEvent.setup();

    render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());

    await user.type(screen.getByLabelText(/search tickets/i), "nothing matches this");

    await waitFor(() => expect(screen.getByTestId("zg-state-no-results")).toBeInTheDocument());
    // The two states are distinct: this one keeps the controls and offers a
    // way back, rather than telling the Requester they have never filed one.
    expect(screen.queryByTestId("zg-state-empty")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/search tickets/i)).toBeInTheDocument();
    expect(lastQuery(calls).get("search")).toBe("nothing matches this");
  });

  it("UI-LIST-04: search and each filter reach the API, and Clear Filters resets them (BR-13, BR-14)", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(3) }));
    const user = userEvent.setup();

    render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());

    await user.type(screen.getByLabelText(/search tickets/i), "printer");
    await waitFor(() => expect(lastQuery(calls).get("search")).toBe("printer"));

    await user.selectOptions(screen.getByLabelText(/^Category$/), "2");
    await waitFor(() => expect(lastQuery(calls).get("category")).toBe("2"));

    await user.selectOptions(screen.getByLabelText(/^Requested Priority$/), "HIGH");
    await waitFor(() => expect(lastQuery(calls).get("requestedPriority")).toBe("HIGH"));

    await user.selectOptions(screen.getByLabelText(/^IT Priority$/), "LOW");
    await waitFor(() => expect(lastQuery(calls).get("itPriority")).toBe("LOW"));

    await user.selectOptions(screen.getByLabelText(/^Current Status$/), "NEW");
    await waitFor(() => expect(lastQuery(calls).get("status")).toBe("NEW"));

    // All four plus the search term travel together (AND, per BR-14).
    const combined = lastQuery(calls);
    expect(combined.get("search")).toBe("printer");
    expect(combined.get("category")).toBe("2");

    await user.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => {
      const cleared = lastQuery(calls);
      expect(cleared.has("search")).toBe(false);
      expect(cleared.has("category")).toBe(false);
      expect(cleared.has("requestedPriority")).toBe(false);
      expect(cleared.has("itPriority")).toBe(false);
      expect(cleared.has("status")).toBe(false);
    });
    expect(screen.getByLabelText(/search tickets/i)).toHaveValue("");
  });

  it("UI-LIST-05: sorting, paging and page size drive the request without a reload (AC-15, BR-16)", async () => {
    const { calls } = mockFetch(() => ({ tickets: makeTickets(10), totalItems: 23 }));
    const user = userEvent.setup();

    render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());

    // The documented default (BR-15) before anything is clicked.
    expect(lastQuery(calls).get("sortBy")).toBe("createdAt");
    expect(lastQuery(calls).get("sortDir")).toBe("desc");

    await user.click(screen.getByRole("button", { name: /sort by ticket number/i }));
    await waitFor(() => expect(lastQuery(calls).get("sortBy")).toBe("ticketNumber"));

    // Clicking the same column again reverses it rather than re-selecting it.
    await user.click(screen.getByRole("button", { name: /sorted by ticket number/i }));
    await waitFor(() => expect(lastQuery(calls).get("sortDir")).toBe("asc"));

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await waitFor(() => expect(lastQuery(calls).get("page")).toBe("2"));

    await user.click(screen.getByRole("button", { name: /^previous$/i }));
    await waitFor(() => expect(lastQuery(calls).get("page")).toBe("1"));

    await user.selectOptions(screen.getByLabelText(/tickets per page/i), "25");
    await waitFor(() => expect(lastQuery(calls).get("pageSize")).toBe("25"));
    // A bigger page invalidates the old page number, so it returns to the first.
    expect(lastQuery(calls).get("page")).toBe("1");

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(/of 23 tickets/);
  });

  it("UI-LIST-05b: the sorted column reports its direction to assistive technology (BR-39)", async () => {
    mockFetch(() => ({ tickets: makeTickets(3) }));
    const user = userEvent.setup();

    render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());

    const header = (name: RegExp) => screen.getByRole("columnheader", { name });

    // The arrow is visual; aria-sort is what a screen reader reads, and only
    // the column actually being sorted may claim a direction.
    expect(header(/created date/i)).toHaveAttribute("aria-sort", "descending");
    expect(header(/ticket no/i)).toHaveAttribute("aria-sort", "none");
    expect(header(/last updated/i)).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: /sort by ticket number/i }));
    await waitFor(() => expect(header(/ticket no/i)).toHaveAttribute("aria-sort", "descending"));
    expect(header(/created date/i)).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: /sorted by ticket number/i }));
    await waitFor(() => expect(header(/ticket no/i)).toHaveAttribute("aria-sort", "ascending"));
  });

  it("UI-LIST-06: the desktop table is replaced by cards on a mobile viewport, not merely hidden", async () => {
    mockFetch(() => ({ tickets: makeTickets(3) }));

    render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());
    expect(screen.queryByTestId("ticket-cards")).not.toBeInTheDocument();
  });

  it("UI-LIST-06: a mobile viewport renders cards and moves the filters into a sheet (§6.3)", async () => {
    useMobileViewport();
    mockFetch(() => ({ tickets: makeTickets(3) }));
    const user = userEvent.setup();

    render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-cards")).toBeInTheDocument());

    // Only one representation exists in the DOM, so a screen reader is not
    // walking two copies of every ticket.
    expect(screen.queryByTestId("ticket-table")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("ticket-cards")).getAllByRole("listitem")).toHaveLength(3);

    // Filters are behind the sheet rather than laid out inline.
    expect(screen.queryByLabelText(/^Category$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^filters$/i }));
    expect(screen.getByLabelText(/^Category$/)).toBeInTheDocument();

    // Pagination drops the numbered buttons for thumb reach.
    expect(screen.getByText(/page 1 of 1/i)).toBeInTheDocument();
  });

  it("UI-LIST-07: switching Requester reloads the list and drops the previous filters (BR-07, AC-12)", async () => {
    const { calls } = mockFetch((url) => ({
      tickets: makeTickets(url.searchParams.get("search") ? 1 : 3),
    }));
    const user = userEvent.setup();

    const { rerender } = render(<Wrapper requester={REQUESTER} />);
    await waitFor(() => expect(screen.getByTestId("ticket-table")).toBeInTheDocument());

    await user.type(screen.getByLabelText(/search tickets/i), "printer");
    await waitFor(() => expect(lastQuery(calls).get("search")).toBe("printer"));

    rerender(<Wrapper requester={OTHER_REQUESTER} />);

    await waitFor(() => {
      const query = lastQuery(calls);
      // The new Requester's list is fetched for them, unfiltered.
      expect(query.has("search")).toBe(false);
      expect(query.has("category")).toBe(false);
    });
    expect(screen.getByLabelText(/search tickets/i)).toHaveValue("");
  });
});
