import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ApiError,
  AuthUser,
  CURRENT_STATUSES,
  CurrentStatus,
  DashboardTicketRow,
  StaffDashboard as StaffDashboardData,
  fetchStaffDashboard,
} from "../api.js";
import { PriorityBadge, STATUS_LABEL, StatusBadge } from "../components/Badge.js";
import ForbiddenState from "../components/ForbiddenState.js";
import { formatDateTime } from "../lib/attachmentRules.js";
import { relativeTime } from "../lib/relativeTime.js";

// lab-04/ui-spec.md §4 — the IT Staff Dashboard. FR-12..FR-16, BR-21, AC-15..AC-18.
//
// Every number on this screen came from the server already counted (BR-24).
// Nothing here adds, filters or re-derives one, because a number this screen
// worked out for itself could disagree with the queue its own card links to —
// and the card is believed, which is what makes that kind of disagreement
// expensive.

type ScreenState = "loading" | "ready" | "forbidden" | "error";

/**
 * §4.5 — each card, the question it answers, and the queue that answers it
 * again. The link is the card's whole point: a number nobody can open is a
 * number nobody can check.
 */
interface CardSpec {
  key: keyof StaffDashboardData["metrics"];
  label: string;
  href: string;
  /** What the card says underneath, which differs when the number is zero. */
  sub: (count: number) => string;
  /** Spoken after the label and the value (§11), so the link is never a bare number. */
  destination: string;
}

const CARDS: CardSpec[] = [
  {
    key: "unassigned",
    label: "Unassigned",
    href: "/staff/tickets?owner=unassigned&status=open",
    sub: (n) => (n === 0 ? "The queue is clear." : "Open and waiting for an owner."),
    destination: "open the queue filtered to unassigned tickets",
  },
  {
    key: "assignedToMe",
    label: "Assigned to me",
    href: "/staff/tickets?owner=me&status=open",
    sub: (n) => (n === 0 ? "Nothing is assigned to you." : "Open tickets you own."),
    destination: "open the queue filtered to your tickets",
  },
  {
    key: "myOpenActions",
    label: "My open actions",
    href: "/staff/tickets?actionsAssignedTo=me&actionStatus=open",
    sub: (n) => (n === 0 ? "No unfinished actions." : "Still planned or in progress."),
    destination: "open the tickets carrying your unfinished actions",
  },
  {
    key: "waitingForRequester",
    label: "Waiting for Requester",
    href: "/staff/tickets?status=WAITING_FOR_REQUESTER",
    sub: (n) => (n === 0 ? "Nobody is waiting on a reply." : "Waiting on somebody else."),
    destination: "open the queue filtered to waiting for requester",
  },
  {
    key: "highItPriority",
    label: "High IT priority",
    href: "/staff/tickets?itPriority=HIGH&status=open",
    sub: (n) => (n === 0 ? "Nothing is marked high." : "Open and marked high."),
    destination: "open the queue filtered to high IT priority",
  },
  {
    key: "resolvedLast7Days",
    label: "Resolved in the last 7 days",
    href: "/staff/tickets?status=RESOLVED",
    sub: (n) => (n === 0 ? "Nothing resolved this week." : "Closed out this week."),
    destination: "open the queue filtered to resolved",
  },
];

export default function StaffDashboard() {
  const user = useOutletContext<AuthUser>();
  const [state, setState] = useState<ScreenState>("loading");
  const [data, setData] = useState<StaffDashboardData | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState("loading");

    fetchStaffDashboard()
      .then((loaded) => {
        if (!current) return;
        setData(loaded);
        setState("ready");
      })
      .catch((error) => {
        if (!current) return;
        setState(error instanceof ApiError && error.status === 403 ? "forbidden" : "error");
      });

    return () => {
      current = false;
    };
  }, [attempt]);

  if (state === "forbidden") return <ForbiddenState role={user.role} />;

  return (
    <section className="zg-card zg-card--wide">
      {/* §4.4: the header renders immediately, in every state, so the screen
          never looks like it failed to exist. */}
      <div className="zg-list-header">
        <div>
          <h1 className="zg-text-xl zg-text-left">Dashboard</h1>
          <p className="zg-text-sm zg-text-muted">Your work, and the queue right now.</p>
        </div>
      </div>

      {state === "loading" && <DashboardSkeleton />}

      {/* §4.4: one honest failure rather than six half-loaded cards — the
          dashboard is read as a whole, so it fails as a whole (AC-23). */}
      {state === "error" && (
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load the dashboard.</p>
          <button type="button" className="zg-btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {state === "ready" && data && <DashboardBody data={data} />}
    </section>
  );
}

function DashboardBody({ data }: { data: StaffDashboardData }) {
  return (
    <>
      <div className="zg-metric-grid" data-testid="metric-grid">
        {CARDS.map((card) => {
          const value = data.metrics[card.key] as number;
          return (
            <MetricCard
              key={card.key}
              label={card.label}
              value={value}
              href={card.href}
              sub={card.sub(value)}
              destination={card.destination}
            />
          );
        })}
      </div>

      <ByStatusStrip byStatus={data.metrics.byStatus} />

      {/* §4.1 item 4, FR-16: an Administrator's two extra numbers. IT Staff do
          not receive the key at all, so there is nothing here to hide. */}
      {data.administratorMetrics && (
        <>
          <hr className="zg-detail-divider" />
          <h2 className="zg-text-lg zg-text-left">Accounts</h2>
          <div className="zg-metric-grid zg-metric-grid--pair" data-testid="administrator-metrics">
            {/* §4.5 names a status filter for these two, and User Management
                has none to link to — it carries search and role only. They open
                the screen itself rather than promising a filter that would not
                apply; ui-spec.md §4.1 was corrected to say so in Issue #49. */}
            <MetricCard
              label="Active users"
              value={data.administratorMetrics.activeUsers}
              href="/admin/users"
              sub="Accounts that can sign in."
              destination="open user management"
              unit="accounts"
            />
            <MetricCard
              label="Inactive users"
              value={data.administratorMetrics.inactiveUsers}
              href="/admin/users"
              sub="Accounts that cannot sign in."
              destination="open user management"
              unit="accounts"
            />
          </div>
        </>
      )}

      <div className="zg-dashboard-lists">
        <TicketList
          testId="recently-updated"
          heading="Recently updated"
          rows={data.recentlyUpdated}
          empty="No open tickets have been updated."
        />
        <TicketList
          testId="needs-attention"
          heading="Needs attention"
          rows={data.needsAttention}
          empty="Nothing is waiting longer than it should."
        />
      </div>
    </>
  );
}

/**
 * §11: one focusable control whose accessible name reads label, then value,
 * then where it goes — so a screen reader never announces a bare number. A zero
 * card is still a link (UI-DASHS-02): "nothing to do" is worth opening to see.
 */
function MetricCard({
  label,
  value,
  href,
  sub,
  destination,
  unit = "tickets",
}: {
  label: string;
  value: number;
  href: string;
  sub: string;
  destination: string;
  unit?: string;
}) {
  return (
    <Link
      to={href}
      className="zg-metric"
      data-testid={`metric-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
      aria-label={`${label}, ${value} ${value === 1 ? unit.replace(/s$/, "") : unit}, ${destination}`}
    >
      <span className="zg-metric-label">{label}</span>
      <span className="zg-metric-value">{value}</span>
      <span className="zg-metric-sub">{sub}</span>
    </Link>
  );
}

/** §4.1 item 3 — a list, so its length is announced; zeros are rendered, never dropped. */
function ByStatusStrip({ byStatus }: { byStatus: Record<CurrentStatus, number> }) {
  return (
    <div className="zg-status-strip" data-testid="by-status">
      <h2 className="zg-text-lg zg-text-left">By status</h2>
      <ul className="zg-status-strip-list">
        {CURRENT_STATUSES.map((status) => (
          <li key={status}>
            <Link
              to={`/staff/tickets?status=${status}`}
              className="zg-status-pair"
              aria-label={`${STATUS_LABEL[status]}, ${byStatus[status]}, open the queue filtered to ${STATUS_LABEL[status]}`}
            >
              <StatusBadge value={status} />
              <span className="zg-status-count">{byStatus[status]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketList({
  testId,
  heading,
  rows,
  empty,
}: {
  testId: string;
  heading: string;
  rows: DashboardTicketRow[];
  empty: string;
}) {
  return (
    <div className="zg-dashboard-list" data-testid={testId}>
      <h2 className="zg-text-lg zg-text-left">{heading}</h2>
      {rows.length === 0 ? (
        // §4.4: an empty list says so inside its own card. The rest of the
        // dashboard is fine, and a page-level empty state would claim otherwise.
        <p className="zg-state--empty">{empty}</p>
      ) : (
        <ul className="zg-dashboard-rows">
          {rows.map((row) => (
            <li key={row.id}>
              {/* §4.1: the whole row opens the Ticket — a row with one small
                  link inside it is a smaller target for the same intent. */}
              <Link to={`/tickets/${row.id}`} className="zg-dashboard-row">
                <span className="zg-dashboard-row-top">
                  <span className="zg-dashboard-number">{row.ticketNumber}</span>
                  <StatusBadge value={row.currentStatus} />
                  <PriorityBadge value={row.itPriority} label="IT priority" />
                </span>
                <span className="zg-dashboard-summary">{row.summary}</span>
                <span className="zg-dashboard-row-foot">
                  <span>{row.owner ? row.owner.name : "Unassigned"}</span>
                  <span title={formatDateTime(row.updatedAt)}>{relativeTime(row.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * §4.4 — the page's own shape while it loads, rather than a spinner in a void.
 *
 * The lists get skeleton rows as well as the cards, because they are the taller
 * half of the page: without them the screen doubles in height the moment the
 * answer arrives, which is the jump a skeleton exists to prevent.
 */
function DashboardSkeleton() {
  return (
    <div data-testid="zg-state-loading" className="zg-state--loading" role="status">
      <span className="zg-visually-hidden">Loading the dashboard…</span>
      <div className="zg-metric-grid" aria-hidden="true">
        {CARDS.map((card) => (
          <div key={card.key} className="zg-metric zg-metric--skeleton" />
        ))}
      </div>
      <div className="zg-dashboard-lists" aria-hidden="true">
        {["recently-updated", "needs-attention"].map((list) => (
          <div key={list} className="zg-dashboard-list">
            <div className="zg-skeleton-heading" />
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="zg-skeleton-row" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
