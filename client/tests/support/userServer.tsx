import { render } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import UserManagement from "../../src/pages/UserManagement.js";
import type { AdminUser, AuthUser, Role } from "../../src/api.js";

// Shared by UserManagement.test.tsx and accessibility.test.tsx.
//
// An in-memory stand-in for the four /api/users endpoints (api-spec.md §9),
// which applies a change the way the API would and records every request the
// screen made. Only the network is faked: what to validate before sending, what
// to send, and where to show a refusal are the screen's own logic.

export function account(id: number, name: string, role: Role, overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.edu`,
    role,
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-05-12T09:14:00.000Z",
    updatedAt: "2026-09-12T08:02:00.000Z",
    ...overrides,
  };
}

export const ADMIN = account(1, "Anong Kittisak", "ADMINISTRATOR");
export const OTHER_ADMIN = account(2, "Bella Admin", "ADMINISTRATOR");
export const STAFF = account(3, "Somsak Wattana", "IT_STAFF");
export const RETIRED = account(4, "Retired Technician", "IT_STAFF", { isActive: false });
export const REQUESTER = account(5, "Jennifer Anderson", "REQUESTER");

export interface Reply {
  status: number;
  body: unknown;
}

const ok = (data: unknown, status = 200): Reply => ({ status, body: { data } });

export const refused = (status: number, code: string, message: string, field?: string): Reply => ({
  status,
  body: { error: field ? { code, message, field } : { code, message } },
});

export interface UserCall {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

export interface FakeUsers {
  users: AdminUser[];
  calls: UserCall[];
  /** Answers a write instead of applying it; return undefined to apply it. */
  write?: (method: string, path: string, body: Record<string, unknown>) => Reply | undefined;
  /** Answers the list instead of filtering `users`. */
  listReply?: () => Reply;
  /** Leaves a request unanswered, to hold the screen in its busy state. */
  hang?: (method: string, path: string) => boolean;
}

export function mockUsers(setup: Partial<Omit<FakeUsers, "calls">> = {}): FakeUsers {
  const server: FakeUsers = {
    users: [ADMIN, OTHER_ADMIN, STAFF, RETIRED, REQUESTER],
    calls: [],
    ...setup,
  };

  const answer = (method: string, path: URL, body: Record<string, unknown> | undefined): Reply => {
    const pathname = path.pathname;

    if (method === "GET" && pathname === "/api/users") {
      if (server.listReply) return server.listReply();
      const search = (path.searchParams.get("search") ?? "").toLowerCase();
      const role = path.searchParams.get("role");
      const rows = server.users
        .filter((u) => !role || u.role === role)
        .filter((u) => !search || u.name.toLowerCase().includes(search) || u.email.includes(search))
        .sort((a, b) => a.name.localeCompare(b.name));
      return ok(rows);
    }

    if (method !== "GET" && body) {
      const override = server.write?.(method, pathname, body);
      if (override) return override;
    }

    if (method === "POST" && pathname === "/api/users" && body) {
      const created = account(100 + server.users.length, String(body.name).trim(), body.role as Role, {
        email: String(body.email).trim().toLowerCase(),
        isActive: body.isActive as boolean,
        mustChangePassword: true,
      });
      server.users = [...server.users, created];
      return ok(created, 201);
    }

    const edit = pathname.match(/^\/api\/users\/(\d+)$/);
    if (method === "PATCH" && edit && body) {
      const current = server.users.find((u) => u.id === Number(edit[1]));
      if (!current) return refused(404, "USER_NOT_FOUND", "User not found.");
      const updated: AdminUser = {
        ...current,
        name: body.name !== undefined ? String(body.name).trim() : current.name,
        email: body.email !== undefined ? String(body.email).trim().toLowerCase() : current.email,
        role: (body.role as Role | undefined) ?? current.role,
        isActive: (body.isActive as boolean | undefined) ?? current.isActive,
      };
      server.users = server.users.map((u) => (u.id === updated.id ? updated : u));
      return ok(updated);
    }

    const reset = pathname.match(/^\/api\/users\/(\d+)\/initial-password$/);
    if (method === "POST" && reset) {
      const current = server.users.find((u) => u.id === Number(reset[1]));
      if (!current) return refused(404, "USER_NOT_FOUND", "User not found.");
      const updated = { ...current, mustChangePassword: true };
      server.users = server.users.map((u) => (u.id === updated.id ? updated : u));
      return ok(updated);
    }

    return refused(404, "NOT_FOUND", "Resource not found.");
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    server.calls.push({ method, url, body });
    const path = new URL(url, "http://localhost");
    if (server.hang?.(method, path.pathname)) return new Promise<Response>(() => {});
    const reply = answer(method, path, body);
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as unknown as Response;
  }) as unknown as typeof fetch;

  return server;
}

/** The query string of the most recent list request. */
export function lastList(server: FakeUsers): URLSearchParams {
  const lists = server.calls.filter((call) => call.method === "GET" && call.url.includes("/api/users"));
  return new URL(lists[lists.length - 1].url, "http://localhost").searchParams;
}

/** The most recent request that was not a read. */
export function lastWrite(server: FakeUsers): UserCall | undefined {
  const writes = server.calls.filter((call) => call.method !== "GET");
  return writes[writes.length - 1];
}

export function renderUsers(me: AuthUser = ADMIN, onOwnAccountChanged?: (user: AdminUser) => void) {
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <Routes>
        <Route element={<Outlet context={me} />}>
          <Route path="/admin/users" element={<UserManagement onOwnAccountChanged={onOwnAccountChanged} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
