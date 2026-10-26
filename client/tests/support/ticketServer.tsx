import { render } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import TicketDetail from "../../src/pages/TicketDetail.js";
import type { ActionTaken, ActorSummary, AuthUser, Role, ThreadEntry, Ticket } from "../../src/api.js";

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
    // Lab 4: the two fields every Ticket now carries (lab-04 BR-26, BR-18).
    // A fixture Ticket has no open Actions unless a test says it has.
    version: 1,
    openActionCount: 0,
    ...overrides,
  };
}

/** lab-04/api-spec.md §4 — one Action, as the endpoints return it. */
export function makeAction(overrides: Partial<ActionTaken> = {}): ActionTaken {
  return {
    id: 501,
    ticketId: 118,
    actionAt: "2026-05-13T09:30:00.000Z",
    description: "Collected the laptop and ran the battery report.",
    result: null,
    status: "PLANNED",
    performedBy: actor(STAFF),
    assignedTo: actor(STAFF),
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    createdAt: "2026-05-13T09:31:00.000Z",
    updatedAt: "2026-05-13T09:31:00.000Z",
    version: 1,
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
  /** Lab 4 — the Ticket's work log (lab-04/api-spec.md §5). */
  actions?: ActionTaken[];
  /** Answers an Action write instead of applying it; return undefined to apply it. */
  actionWrite?: (method: string, body: Record<string, unknown>) => Reply | undefined;
}

export function mockServer(caller: AuthUser, setup: Partial<Omit<FakeServer, "calls">> = {}): FakeServer {
  const server: FakeServer = { ticket: makeTicket(), comments: [], notes: [], actions: [], calls: [], ...setup };

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

    // Lab 4 — Actions Taken (lab-04/api-spec.md §5).
    if (/\/api\/tickets\/\d+\/actions$/.test(url)) {
      const list = server.actions ?? [];
      if (method === "GET") return ok([...list]);
      const override = server.actionWrite?.(method, body ?? {});
      if (override) return override;
      const created: ActionTaken = {
        ...makeAction({
          id: 600 + list.length,
          description: String(body?.description ?? ""),
          result: (body?.result as string) || null,
          status: (body?.status as ActionTaken["status"]) ?? "PLANNED",
          followUpRequired: Boolean(body?.followUpRequired),
          followUpNote: (body?.followUpNote as string) || null,
          attachmentNotes: (body?.attachmentNotes as string) || null,
          performedBy: actor(caller),
          assignedTo:
            ASSIGNEES.find((a) => a.id === (body?.assignedToId as number)) ?? actor(caller),
        }),
      };
      list.push(created);
      return ok(created, 201);
    }

    const actionWrite = url.match(/\/api\/actions\/(\d+)$/);
    if (actionWrite && method === "PATCH") {
      const override = server.actionWrite?.(method, body ?? {});
      if (override) return override;
      const list = server.actions ?? [];
      const index = list.findIndex((a) => a.id === Number(actionWrite[1]));
      if (index === -1) return refused(404, "ACTION_NOT_FOUND", "Action not found.");
      const updated: ActionTaken = {
        ...list[index],
        ...(body?.description !== undefined ? { description: String(body.description) } : {}),
        ...(body?.result !== undefined ? { result: (body.result as string) || null } : {}),
        ...(body?.status !== undefined ? { status: body.status as ActionTaken["status"] } : {}),
        ...(body?.followUpRequired !== undefined
          ? {
              followUpRequired: Boolean(body.followUpRequired),
              followUpNote: body.followUpRequired ? ((body.followUpNote as string) ?? null) : null,
            }
          : {}),
        version: list[index].version + 1,
      };
      list[index] = updated;
      return ok(updated);
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
      // Lab 4 BR-26: a successful write raises the version, so a screen that
      // keeps writing keeps sending a version the server would still accept.
      server.ticket = { ...server.ticket, version: server.ticket.version + 1 };
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
