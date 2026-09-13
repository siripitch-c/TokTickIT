import type { Role } from "../api.js";

// ui-spec.md §3 — where each role lands after signing in, the route "/"
// resolves to, and what the way back to it is called. Shared by the routing and
// by the forbidden state, whose one button returns a person to their own
// landing screen (§2.4).
export const LANDING: Record<Role, { path: string; label: string }> = {
  REQUESTER: { path: "/my-tickets", label: "My Tickets" },
  IT_STAFF: { path: "/staff/tickets", label: "Ticket Queue" },
  ADMINISTRATOR: { path: "/admin/users", label: "User Management" },
};
