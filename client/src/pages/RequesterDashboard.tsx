import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ApiError,
  AuthUser,
  CurrentStatus,
  RequesterDashboard as RequesterDashboardData,
  RequesterTicketRow,
  fetchRequesterDashboard,
} from "../api.js";
import { PriorityBadge, StatusBadge } from "../components/Badge.js";
import ForbiddenState from "../components/ForbiddenState.js";
import { formatDateTime } from "../lib/attachmentRules.js";
import { relativeTime } from "../lib/relativeTime.js";

// lab-04/ui-spec.md §5 — the Requester Dashboard. FR-17..FR-20, BR-22,
// AC-19..AC-23.
//
// Everything here is the caller's own, because the server will not answer with
// anybody else's (BR-23, FR-20). The screen never asks whose dashboard it
// wants: there is no identifier to pass, which is the clearest way to say that
// one could not help.

type ScreenState = "loading" | "ready" | "forbidden" | "error";

interface CardSpec {
  key: keyof RequesterDashboardData["metrics"];
  label: string;
  href: string;
  sub: (count: number) => string;
  destination: string;
}

/** §5.3 — each card opens My Tickets with the filter that produced its number. */
const CARDS: CardSpec[] = [
  {
    key: "openTickets",
    label: "My open tickets",
    href: "/my-tickets?status=open",
    sub: (n) => (n === 0 ? "Nothing open at the moment." : "Still being worked on."),
    destination: "open my tickets",
  },
  {
    key: "waitingForMe",
    label: "Waiting for me",
    href: "/my-tickets?status=WAITING_FOR_REQUESTER",
    sub: (n) => (n === 0 ? "Nobody is waiting on you." : "IT Staff need something from you."),
    destination: "open my tickets waiting for a reply",
  },
  {
    key: "resolvedAwaitingConfirmation",
    label: "Resolved, awaiting my confirmation",
    href: "/my-tickets?status=RESOLVED",
    sub: (n) => (n === 0 ? "Nothing to confirm." : "Check these and confirm they are fixed."),
    destination: "open my resolved tickets",
  },
];

/**
 * §5.1 item 3 — why a Ticket is in the attention panel. The row's own status is
 * the reason, so nothing else has to carry it and the two cannot disagree.
 */
const REASON: Partial<Record<CurrentStatus, string>> = {
  WAITING_FOR_REQUESTER: "Waiting for your reply",
  RESOLVED: "Resolved — please confirm",
};

export default function RequesterDashboard() {
  const user = useOutletContext<AuthUser>();
  const [state, setState] = useState<ScreenState>("loading");
  const [data, setData] = useState<RequesterDashboardData | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState("loading");

    fetchRequesterDashboard()
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
      <div className="zg-list-header">
        <div>
          <h1 className="zg-text-xl zg-text-left">Dashboard</h1>
          <p className="zg-text-sm zg-text-muted">Your tickets at a glance.</p>
        </div>
      </div>

      {state === "loading" && <RequesterSkeleton />}

      {state === "error" && (
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load the dashboard.</p>
          <button type="button" className="zg-btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {state === "ready" && data && <RequesterBody data={data} />}
    </section>
  );
}

function RequesterBody({ data }: { data: RequesterDashboardData }) {
  // §5.2, AC-21: a Requester with nothing at all gets the one call to action on
  // either dashboard, because raising a ticket is the only useful next step.
  const nothingAtAll =
    data.metrics.openTickets === 0 &&
    data.metrics.waitingForMe === 0 &&
    data.metrics.resolvedAwaitingConfirmation === 0 &&
    data.recentlyUpdated.length === 0;

  return (
    <>
      <div className="zg-metric-grid zg-metric-grid--three" data-testid="metric-grid">
        {CARDS.map((card) => {
          const value = data.metrics[card.key];
          return (
            <Link
              key={card.key}
              to={card.href}
              className="zg-metric"
              data-testid={`metric-${card.key}`}
              aria-label={`${card.label}, ${value} ${value === 1 ? "ticket" : "tickets"}, ${card.destination}`}
            >
              <span className="zg-metric-label">{card.label}</span>
              <span className="zg-metric-value">{value}</span>
              <span className="zg-metric-sub">{card.sub(value)}</span>
            </Link>
          );
        })}
      </div>

      {nothingAtAll && (
        <p className="zg-dashboard-cta" data-testid="create-ticket-cta">
          <Link className="zg-btn--primary" to="/tickets/new">
            Create Ticket
          </Link>
        </p>
      )}

      <div className="zg-dashboard-list" data-testid="attention">
        <h2 className="zg-text-lg zg-text-left">Attention required</h2>
        {data.attention.length === 0 ? (
          <p className="zg-state--empty">Nothing needs you right now.</p>
        ) : (
          <ul className="zg-dashboard-rows">
            {data.attention.map((row) => (
              <li key={row.id}>
                <TicketRow row={row} reason={REASON[row.currentStatus]} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="zg-dashboard-lists">
        <TicketList
          testId="recently-updated"
          heading="Recently updated"
          rows={data.recentlyUpdated}
          empty="Nothing of yours has changed yet."
        />
        <TicketList
          testId="recently-resolved"
          heading="Recently resolved"
          rows={data.recentlyResolved}
          empty="Nothing has been resolved yet."
        />
      </div>
    </>
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
  rows: RequesterTicketRow[];
  empty: string;
}) {
  return (
    <div className="zg-dashboard-list" data-testid={testId}>
      <h2 className="zg-text-lg zg-text-left">{heading}</h2>
      {rows.length === 0 ? (
        <p className="zg-state--empty">{empty}</p>
      ) : (
        <ul className="zg-dashboard-rows">
          {rows.map((row) => (
            <li key={row.id}>
              <TicketRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The whole row opens the Ticket, as it does on the staff dashboard (§4.1). */
function TicketRow({ row, reason }: { row: RequesterTicketRow; reason?: string }) {
  return (
    <Link to={`/tickets/${row.id}`} className="zg-dashboard-row">
      <span className="zg-dashboard-row-top">
        <span className="zg-dashboard-number">{row.ticketNumber}</span>
        <StatusBadge value={row.currentStatus} />
        <PriorityBadge value={row.requestedPriority} label="Requested priority" />
      </span>
      <span className="zg-dashboard-summary">{row.summary}</span>
      <span className="zg-dashboard-row-foot">
        {/* §5.1: the reason is shown where the row is, not inferred by the
            reader from a badge they would have to know the meaning of. */}
        <span>{reason ?? ""}</span>
        <span title={formatDateTime(row.updatedAt)}>{relativeTime(row.updatedAt)}</span>
      </span>
    </Link>
  );
}

/** §5.2 follows §4.4: the page's own shape while it loads. */
function RequesterSkeleton() {
  return (
    <div data-testid="zg-state-loading" className="zg-state--loading" role="status">
      <span className="zg-visually-hidden">Loading the dashboard…</span>
      <div className="zg-metric-grid zg-metric-grid--three" aria-hidden="true">
        {CARDS.map((card) => (
          <div key={card.key} className="zg-metric zg-metric--skeleton" />
        ))}
      </div>
      <div className="zg-dashboard-list" aria-hidden="true">
        <div className="zg-skeleton-heading" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="zg-skeleton-row" />
        ))}
      </div>
    </div>
  );
}
