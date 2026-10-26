import type { Role } from "../api.js";

// ui-spec.md §3 — where each role lands after signing in, the route "/"
// resolves to, and what the way back to it is called. Shared by the routing and
// by the forbidden state, whose one button returns a person to their own
// landing screen (§2.4).
// Lab 4, Issue #50 — FR-25: every role lands on the Dashboard. One route for
// all three (lab-04/ui-spec.md §3), so the way back from a refusal is the same
// sentence for everybody and a link shared between colleagues always works.
export const LANDING: Record<Role, { path: string; label: string }> = {
  REQUESTER: { path: "/dashboard", label: "Dashboard" },
  IT_STAFF: { path: "/dashboard", label: "Dashboard" },
  ADMINISTRATOR: { path: "/dashboard", label: "Dashboard" },
};
