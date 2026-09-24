import { CurrentStatus, RequestedPriority, Role } from "../api.js";

// ui-spec.md §2.3 — Requested Priority, IT Priority and Current Status badges.
//
// Every badge renders text *and* colour, never colour alone: the label is what
// carries the meaning for anyone who cannot separate the fills, and the colour
// is reinforcement. Shared here rather than written per screen so My Tickets
// and Ticket Detail (#15) cannot drift apart.

const PRIORITY_CLASS: Record<RequestedPriority, string> = {
  LOW: "zg-badge zg-badge--low",
  MEDIUM: "zg-badge zg-badge--medium",
  HIGH: "zg-badge zg-badge--high",
};

const PRIORITY_LABEL: Record<RequestedPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export function PriorityBadge({
  value,
  label,
}: {
  value: RequestedPriority | null;
  /** Names which priority this is, so "Not set" is never ambiguous out of context. */
  label: string;
}) {
  // §2.3: an unset IT Priority is its own state, shown as "Not set" rather
  // than as a blank cell that could read as a rendering failure.
  if (value === null) {
    return (
      <span className="zg-badge zg-badge--unset" title={`${label}: not set`}>
        Not set
      </span>
    );
  }
  return (
    <span className={PRIORITY_CLASS[value]} title={`${label}: ${PRIORITY_LABEL[value]}`}>
      {PRIORITY_LABEL[value]}
    </span>
  );
}

// Lab 3 ui-spec.md §2.1 — eight statuses, one class each. Every badge is text
// plus colour; three also carry a signal that is not colour at all (a border, a
// glyph, a strike), which is what keeps the pairs sharing a hue apart.
const STATUS: Record<CurrentStatus, { label: string; className: string; glyph?: string }> = {
  NEW: { label: "New", className: "zg-badge--status-new" },
  OPEN: { label: "Open", className: "zg-badge--status-open" },
  IN_PROGRESS: { label: "In Progress", className: "zg-badge--status-in-progress" },
  WAITING_FOR_REQUESTER: { label: "Waiting for Requester", className: "zg-badge--status-waiting" },
  RESOLVED: { label: "Resolved", className: "zg-badge--status-resolved", glyph: "✓" },
  CLOSED: { label: "Closed", className: "zg-badge--status-closed" },
  REOPENED: { label: "Reopened", className: "zg-badge--status-reopened", glyph: "↻" },
  CANCELLED: { label: "Cancelled", className: "zg-badge--status-cancelled" },
};

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(STATUS).map(([value, { label }]) => [value, label]),
) as Record<CurrentStatus, string>;

export function StatusBadge({ value }: { value: CurrentStatus }) {
  const status = STATUS[value];
  return (
    <span className={`zg-badge ${status.className}`} title={`Status: ${status.label}`}>
      {status.glyph && <span aria-hidden="true">{status.glyph} </span>}
      {status.label}
    </span>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  REQUESTER: "Requester",
  IT_STAFF: "IT Staff",
  ADMINISTRATOR: "Administrator",
};

/**
 * ui-spec.md §2.3 — deliberately the quietest badge in the system. A role is an
 * attribute of a person, not a state to scan for, so it never competes with the
 * status and priority badges beside it.
 */
export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="zg-badge zg-badge--role" title={`Role: ${ROLE_LABEL[role]}`}>
      {ROLE_LABEL[role]}
    </span>
  );
}
