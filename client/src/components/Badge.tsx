import { RequestedPriority } from "../api.js";

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

export function StatusBadge({ value }: { value: "NEW" }) {
  // Lab 2 only ever produces NEW (BR-02); later statuses join this map.
  const labels: Record<string, string> = { NEW: "New" };
  return (
    <span className="zg-badge zg-badge--status-new" title={`Status: ${labels[value] ?? value}`}>
      {labels[value] ?? value}
    </span>
  );
}
