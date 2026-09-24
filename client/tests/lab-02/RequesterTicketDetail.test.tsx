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
  // Lab 3, Issue #32: the one Ticket object of lab-03/api-spec.md §5.
  requester: { id: REQUESTER.id, name: REQUESTER.name, role: "REQUESTER" as const },
  ownerId: null,
  owner: null,
  requesterResolvedAt: null,
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
    // Lab 3, Issue #32: the screen also loads its Public Comments.
    if (url.includes("/comments")) {
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as unknown as Response;
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
    //
    // Lab 3, Issue #32 — deliberately updated, per the Definition of Done's
    // allowance for Lab 2 tests that change with a recorded reason. Lab 3 gives
    // the Requester a Public Comments composer on this screen (lab-03
    // ui-spec.md §6), so "no textbox anywhere" and "no public comment" stopped
    // being true. What Lab 2 meant by them still holds and is still checked:
    // every ticket *field* is a read-only output, and the one text box on the
    // screen is the comment composer, not part of the ticket information.
    const fields = document.querySelectorAll("output");
    expect(fields.length).toBeGreaterThan(0);
    for (const field of Array.from(fields)) {
      expect(field).toHaveAttribute("aria-readonly", "true");
    }
    const textboxes = screen.queryAllByRole("textbox");
    expect(textboxes).toHaveLength(1);
    expect(textboxes[0]).toHaveAccessibleName(/public comment/i);

    // Still absent in Lab 3: Internal Notes for a Requester (lab-03 BR-20),
    // and Actions Taken, which the handout defers to Lab 4.
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

    // Lab 3, Issue #32 — deliberately updated, per the Definition of Done's
    // allowance for Lab 2 tests that change with a recorded reason: lab-03
    // ui-spec.md §2.5 splits "not found" out of the generic failure block, in
    // words that do not choose between "does not exist" and "is not yours".
    await waitFor(() => expect(screen.getByTestId("zg-state-not-found")).toBeInTheDocument());

    // …and nothing appears afterwards either. The card is replaced, not hidden.
    expect(screen.getByText("This ticket does not exist, or you do not have access to it.")).toBeInTheDocument();
    expect(screen.queryByTestId("detail-ticket-number")).not.toBeInTheDocument();
    expect(screen.queryByText(TICKET.summary)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to my tickets/i })).toBeInTheDocument();
  });

  it("UI-DETAIL-02: an id that could never name a ticket is refused without asking the server", async () => {
    mockFetch(() => ({ status: 200, body: { data: TICKET } }));

    renderDetail("/tickets/not-a-number");

    await waitFor(() => expect(screen.getByText("This ticket does not exist, or you do not have access to it.")).toBeInTheDocument());

    const ticketCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
      /\/api\/tickets\//.test(String(url)),
    );
    expect(ticketCalls).toHaveLength(0);
  });
});
