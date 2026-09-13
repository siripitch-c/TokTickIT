import { render } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import TicketDetail from "../../src/pages/TicketDetail.js";
import type { ActorSummary, AuthUser, Role, ThreadEntry, Ticket } from "../../src/api.js";

// Shared by StaffTicketDetail.test.tsx and accessibility.test.tsx.
//
// A small in-memory stand-in for the endpoints Ticket Detail calls, which
// applies a change the way the API would and records every request the screen
// made. Only the network is faked: what to render for which role, what to send,
// and what to show when a control is refused are all the screen's own logic.

export function userWith(role: Role, id: number, name: string): AuthUser {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.edu`,
    role,
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-05-12T09:14:00.000Z",
    updatedAt: "2026-09-12T08:02:00.000Z",
  };
}

export const STAFF = userWith("IT_STAFF", 7, "Somsak Wattana");
export const REQUESTER = userWith("REQUESTER", 3, "Jennifer Anderson");

export const actor = (user: AuthUser): ActorSummary => ({ id: user.id, name: user.name, role: user.role });

export const ASSIGNEES: ActorSummary[] = [actor(STAFF), { id: 9, name: "Anong Kittisak", role: "ADMINISTRATOR" }];

export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 118,
    ticketNumber: "TKT-2026-000118",
    requesterId: REQUESTER.id,
    requester: actor(REQUESTER),
    categoryId: 2,
    relatedSystemId: 7,
    summary: "Laptop battery drains quickly",
    description: "The battery goes from full to empty in under an hour of light use.",
    requestedPriority: "MEDIUM",
    itPriority: "MEDIUM",
    currentStatus: "OPEN",
    ownerId: null,
    owner: null,
    requesterResolvedAt: null,
    createdAt: "2026-05-12T09:14:00.000Z",
    updatedAt: "2026-05-13T10:00:00.000Z",
    attachments: [],
    ...overrides,
  };
}

export interface Reply {
  status: number;
  body: unknown;
}

export const ok = (data: unknown, status = 200): Reply => ({ status, body: { data } });

export const refused = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message } },
});

export interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

export interface FakeServer {
  ticket: Ticket;
  comments: ThreadEntry[];
  notes: ThreadEntry[];
  calls: Call[];
  /** Answers a PATCH instead of applying it; return undefined to apply it. */
  patch?: (operation: string, body: Record<string, unknown>) => Reply | undefined;
  appearsResolved?: () => Reply;
  /** Answers the Ticket read instead of returning `ticket`. */
  ticketReply?: () => Reply;
}

export function mockServer(caller: AuthUser, setup: Partial<Omit<FakeServer, "calls">> = {}): FakeServer {
  const server: FakeServer = { ticket: makeTicket(), comments: [], notes: [], calls: [], ...setup };

  const answer = (method: string, url: string, body: Record<string, unknown> | undefined): Reply => {
    if (url.includes("/api/categories") || url.includes("/api/related-systems")) return ok([]);
    if (url.includes("/api/staff/assignees")) return ok(ASSIGNEES);

    const thread = url.match(/\/api\/tickets\/\d+\/(comments|notes)$/);
    if (thread) {
      const list = thread[1] === "comments" ? server.comments : server.notes;
      // A copy: the screen keeps what it is given, and must not see later
      // posts appear in it by mutation rather than through its own update.
      if (method === "GET") return ok([...list]);
      const entry: ThreadEntry = {
        id: 1000 + list.length,
        ticketId: server.ticket.id,
        author: actor(caller),
        body: String(body?.body ?? "").trim(),
        createdAt: new Date().toISOString(),
      };
      list.push(entry);
      // As the API does (api-spec.md §8): a comment moves the Ticket's
      // updatedAt, and a note does not.
      if (thread[1] === "comments") server.ticket = { ...server.ticket, updatedAt: entry.createdAt };
      return ok(entry, 201);
    }

    const operation = url.match(/\/api\/tickets\/\d+\/(owner|it-priority|status)$/);
    if (operation && method === "PATCH" && body) {
      const override = server.patch?.(operation[1], body);
      if (override) return override;
      if (operation[1] === "owner") {
        const ownerId = body.ownerId as number | null;
        const owner = ownerId === null ? null : (ASSIGNEES.find((a) => a.id === ownerId) ?? null);
        server.ticket = { ...server.ticket, ownerId, owner };
      } else if (operation[1] === "it-priority") {
        server.ticket = { ...server.ticket, itPriority: body.itPriority as Ticket["itPriority"] };
      } else {
        server.ticket = { ...server.ticket, currentStatus: body.currentStatus as Ticket["currentStatus"] };
      }
      return ok(server.ticket);
    }

    if (method === "POST" && url.endsWith("/appears-resolved")) {
      if (server.appearsResolved) return server.appearsResolved();
      server.ticket = { ...server.ticket, requesterResolvedAt: "2026-09-10T08:04:00.000Z" };
      return ok(server.ticket);
    }

    if (method === "GET" && /\/api\/tickets\/\d+$/.test(url)) {
      return server.ticketReply ? server.ticketReply() : ok(server.ticket);
    }

    return refused(404, "NOT_FOUND", "Resource not found.");
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    server.calls.push({ method, url, body });
    const reply = answer(method, url, body);
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as unknown as Response;
  }) as unknown as typeof fetch;

  return server;
}

export function lastPatch(server: FakeServer): Call | undefined {
  const patches = server.calls.filter((call) => call.method === "PATCH");
  return patches[patches.length - 1];
}

export function renderDetail(user: AuthUser, path = "/tickets/118") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={user} />}>
          <Route path="/tickets/:id" element={<TicketDetail />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
