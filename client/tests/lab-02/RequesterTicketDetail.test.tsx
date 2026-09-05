import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import TicketDetail from "../../src/pages/TicketDetail.js";

// tests.md UI-DETAIL-01..02; ui-spec.md §7.1, §7.4; specification.md BR-12, BR-38, AC-03.
// Only the fetch layer is mocked — the read-only rendering and the not-found
// decision are the component's real logic.

const REQUESTER = { id: 3, name: "Sarah Johnson" };
const CATEGORIES = [{ id: 2, name: "Hardware" }];
const SYSTEMS = [{ id: 7, name: "Corporate Laptop" }];

const TICKET = {
  id: 118,
  ticketNumber: "TKT-2026-000118",
  requesterId: REQUESTER.id,
  categoryId: 2,
  relatedSystemId: 7,
  summary: "Laptop battery drains quickly",
  description: "The battery goes from full to empty in under an hour of light use.",
  requestedPriority: "MEDIUM" as const,
  itPriority: null,
  currentStatus: "NEW" as const,
  createdAt: "2026-05-12T09:14:00.000Z",
  updatedAt: "2026-05-13T10:00:00.000Z",
  attachments: [],
};

function mockFetch(ticketReply: () => { status: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/categories")) {
      return { ok: true, status: 200, json: async () => ({ data: CATEGORIES }) } as unknown as Response;
    }
    if (url.includes("/api/related-systems")) {
      return { ok: true, status: 200, json: async () => ({ data: SYSTEMS }) } as unknown as Response;
    }
    const { status, body } = ticketReply();
    return { ok: status < 300, status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

function renderDetail(path = "/tickets/118") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={REQUESTER} />}>
          <Route path="/tickets/:id" element={<TicketDetail />} />
        </Route>
        <Route path="/my-tickets" element={<p>My Tickets page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Requester Ticket Detail screen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("UI-DETAIL-01: an owned ticket renders its read-only fields, dates in local format", async () => {
    mockFetch(() => ({ status: 200, body: { data: TICKET } }));

    renderDetail();

    await waitFor(() => expect(screen.getByTestId("detail-ticket-number")).toBeInTheDocument());

    expect(screen.getAllByText("TKT-2026-000118").length).toBeGreaterThan(0);
    expect(screen.getByText(TICKET.summary)).toBeInTheDocument();
    expect(screen.getByText(TICKET.description)).toBeInTheDocument();
    // Reference ids are shown as the names the Requester chose, not raw numbers.
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("Corporate Laptop")).toBeInTheDocument();
    expect(screen.getByText(REQUESTER.name)).toBeInTheDocument();

    // Ticket Date is createdAt in the viewer's own locale (specification.md §7).
    expect(screen.getByText(new Date(TICKET.createdAt).toLocaleString())).toBeInTheDocument();

    // Badges carry text as well as colour (§2.3); IT Priority is unset in Lab 2.
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();

    // Every ticket field is read-only — nothing here is editable (§7.1).
    for (const field of screen.getAllByRole("status", { hidden: true })) {
      expect(field).toHaveAttribute("aria-readonly", "true");
    }
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    // §3 excludes these from Lab 2 entirely.
    expect(screen.queryByText(/public comment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/internal note/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/actions taken/i)).not.toBeInTheDocument();
  });

  it("UI-DETAIL-02: a ticket that is not yours reads as not found, with no data flash (BR-12, AC-03)", async () => {
    mockFetch(() => ({
      status: 404,
      body: { error: { code: "TICKET_NOT_FOUND", message: "Ticket not found." } },
    }));

    renderDetail();

    // Nothing of the ticket exists on screen while the answer is still pending…
    expect(screen.queryByTestId("detail-ticket-number")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("zg-state-error")).toBeInTheDocument());

    // …and nothing appears afterwards either. The card is replaced, not hidden.
    expect(screen.getByText("Ticket not found.")).toBeInTheDocument();
    expect(screen.queryByTestId("detail-ticket-number")).not.toBeInTheDocument();
    expect(screen.queryByText(TICKET.summary)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to my tickets/i })).toBeInTheDocument();
  });

  it("UI-DETAIL-02: an id that could never name a ticket is refused without asking the server", async () => {
    mockFetch(() => ({ status: 200, body: { data: TICKET } }));

    renderDetail("/tickets/not-a-number");

    await waitFor(() => expect(screen.getByText("Ticket not found.")).toBeInTheDocument());

    const ticketCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
      /\/api\/tickets\//.test(String(url)),
    );
    expect(ticketCalls).toHaveLength(0);
  });
});
