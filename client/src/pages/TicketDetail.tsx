import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  ApiError,
  AuthUser,
  CurrentStatus,
  ReferenceItem,
  Ticket,
  fetchCategories,
  fetchRelatedSystems,
  fetchTicket,
  markAppearsResolved,
} from "../api.js";
import AttachmentSection from "../components/AttachmentSection.js";
import { PriorityBadge, RoleBadge, StatusBadge } from "../components/Badge.js";
import NotFoundState from "../components/NotFoundState.js";
import OperationsPanel from "../components/OperationsPanel.js";
import Thread from "../components/Thread.js";
import { formatDateTime } from "../lib/attachmentRules.js";
import { readId } from "../lib/ids.js";

// Lab 2 ui-spec.md §7 — Ticket Detail — extended by Lab 3 ui-spec.md §6 for the
// Requester and §8 for IT Staff and Administrators. One route and one screen for
// every role (§8), whose parts differ by role exactly as §8.3 tabulates:
//
//   Requester   ticket information, Attachments with Add and Remove, Public
//               Comments, then Problem Appears Resolved
//   Staff       ticket information, Operations, Attachments with Download only,
//               Public Comments, then Internal Notes
//
// What a role may read is still the server's decision: this screen asks for the
// Ticket and renders whatever it is given, and a Requester asking for somebody
// else's gets the same "not found" a missing Ticket gets (BR-16).

type DetailState = "loading" | "ready" | "not-found" | "error";

export default function TicketDetail() {
  const user = useOutletContext<AuthUser>();
  const { id } = useParams<{ id: string }>();
  const ticketId = readId(id);
  // Only an explicit staff role gets the staff view. Anything else — including a
  // role the client does not recognise — gets the Requester view, which offers
  // the least; the server decides what either may actually do (FR-08).
  const isStaff = user.role === "IT_STAFF" || user.role === "ADMINISTRATOR";
  const back = isStaff
    ? { path: "/staff/tickets", label: "Ticket Queue" }
    : { path: "/my-tickets", label: "My Tickets" };

  const [state, setState] = useState<DetailState>("loading");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [categories, setCategories] = useState<ReferenceItem[]>([]);
  const [systems, setSystems] = useState<ReferenceItem[]>([]);

  useEffect(() => {
    Promise.all([fetchCategories(), fetchRelatedSystems()])
      .then(([loadedCategories, loadedSystems]) => {
        setCategories(loadedCategories);
        setSystems(loadedSystems);
      })
      .catch(() => {
        // Names are labels for ids the ticket already carries; without them the
        // ticket still reads, so this failure does not take the screen down.
        setCategories([]);
        setSystems([]);
      });
  }, []);

  useEffect(() => {
    if (ticketId === null) {
      // An id that could never name a row is the same answer as one that does
      // not (BR-12) — do not ask the server about it.
      setState("not-found");
      return;
    }

    let current = true;
    setState("loading");
    setTicket(null);

    fetchTicket(ticketId)
      .then((loaded) => {
        if (!current) return;
        setTicket(loaded);
        setState("ready");
      })
      .catch((error) => {
        if (!current) return;
        // BR-12/AC-03: a ticket owned by somebody else answers 404 exactly as a
        // nonexistent one does, and this screen must not tell them apart either.
        setState(error instanceof ApiError && error.status === 404 ? "not-found" : "error");
      });

    return () => {
      current = false;
    };
  }, [user.id, ticketId]);

  const nameOf = (list: ReferenceItem[], lookupId: number) =>
    list.find((item) => item.id === lookupId)?.name ?? "—";

  // A comment moves the Ticket's Last Updated on the server (api-spec.md §8),
  // so the Ticket is re-read quietly afterwards and the screen shows the time
  // the server now holds. A failure here is harmless: the comment itself landed.
  const refreshTicket = () => {
    if (ticketId === null) return;
    fetchTicket(ticketId)
      .then(setTicket)
      .catch(() => {});
  };

  if (state === "loading") {
    return (
      <section className="zg-card zg-card--detail">
        <div data-testid="zg-state-loading" className="zg-state--loading" role="status">
          {/* §7.4: skeleton blocks for the information panel… */}
          <div className="zg-skeleton-bar" />
          <div className="zg-skeleton-bar" />
          <div className="zg-skeleton-bar" />
          {/* …and a skeleton list for the attachments below the divider, so the
              card does not visibly grow when the real panel arrives. */}
          <hr className="zg-detail-divider" />
          <div data-testid="zg-skeleton-attachments" className="zg-skeleton-list">
            <div className="zg-skeleton-bar" />
            <div className="zg-skeleton-bar" />
          </div>
          Loading ticket…
        </div>
      </section>
    );
  }

  // §7.4: the whole card is replaced. No ticket data is rendered first and then
  // hidden, so there is nothing to flash on screen (UI-DETAIL-02). Lab 3
  // ui-spec.md §10 keeps a 404 and a failure apart: different states, and
  // different words.
  if (state === "not-found") {
    return (
      <section className="zg-card zg-card--detail">
        <NotFoundState backTo={back.path} backLabel={back.label} />
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="zg-card zg-card--detail">
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load this ticket.</p>
          <Link className="zg-btn--secondary" to={back.path}>
            Back to {back.label}
          </Link>
        </div>
      </section>
    );
  }

  if (!ticket) return null;

  return (
    <section className="zg-card zg-card--detail">
      <div className="zg-detail-header">
        <nav className="zg-breadcrumb" aria-label="Breadcrumb">
          <Link className="zg-btn--tertiary" to={back.path}>
            {back.label}
          </Link>
          <span aria-hidden="true"> &rsaquo; </span>
          <span aria-current="page">Ticket Details</span>
        </nav>
        <Link className="zg-btn--tertiary" to={back.path}>
          &larr; Back to {back.label}
        </Link>
      </div>

      <h1 className="zg-text-xl zg-text-left">{ticket.ticketNumber}</h1>

      {/* §8.3: staff see the Requester's signal in the header rather than a
          button; the status stays theirs to change (BR-05). */}
      {isStaff && ticket.requesterResolvedAt && (
        <p data-testid="requester-resolved" className="zg-callout--info">
          Requester reported this resolved on {formatDateTime(ticket.requesterResolvedAt)}.
        </p>
      )}

      {/* §7.1 and §8.1: the fields a Requester entered, read-only for every
          role. Correcting a Requester's words in place would destroy the record
          of what was reported. */}
      <div className="zg-field-row zg-field-row--4">
        <ReadOnly label="Ticket No." value={ticket.ticketNumber} testId="detail-ticket-number" />
        <ReadOnly label="Ticket Date" value={formatDateTime(ticket.createdAt)} />
        <ReadOnly label="Category" value={nameOf(categories, ticket.categoryId)} />
        <ReadOnly label="Related System" value={nameOf(systems, ticket.relatedSystemId)} />
      </div>

      <div className="zg-field-row zg-field-row--4">
        {/* The Ticket's own Requester, from the Ticket — not the signed-in user,
            who for staff is somebody else entirely. §8.1: staff see the name
            with its role badge; the Requester's own view keeps Lab 2's field. */}
        {isStaff ? (
          <div className="zg-field">
            <span className="zg-field-label">Requester</span>
            <output className="zg-field--readonly zg-field--with-badge" aria-readonly="true">
              <span>{ticket.requester.name}</span>
              <RoleBadge role={ticket.requester.role} />
            </output>
          </div>
        ) : (
          <ReadOnly label="Requester" value={ticket.requester.name} />
        )}
        <BadgeField label="Requested Priority">
          <PriorityBadge value={ticket.requestedPriority} label="Requested priority" />
        </BadgeField>
        <BadgeField label="IT Priority">
          <PriorityBadge value={ticket.itPriority} label="IT priority" />
        </BadgeField>
        <BadgeField label="Current Status">
          <StatusBadge value={ticket.currentStatus} />
        </BadgeField>
      </div>

      {isStaff && (
        <div className="zg-field-row zg-field-row--4">
          <ReadOnly label="Last Updated" value={formatDateTime(ticket.updatedAt)} />
        </div>
      )}

      <ReadOnly label="Summary" value={ticket.summary} block />
      <ReadOnly label="Description" value={ticket.description} block multiline />

      {isStaff && <OperationsPanel ticket={ticket} user={user} onChange={setTicket} />}

      {/* §7.1 item 2: a hard visual break, because the handout requires ticket
          information and attachment actions to be clearly distinguished. */}
      <hr className="zg-detail-divider" />

      <AttachmentSection
        key={ticket.id}
        ticketId={ticket.id}
        initialAttachments={ticket.attachments}
        canManage={!isStaff}
      />

      <Thread ticketId={ticket.id} kind="comments" onPosted={refreshTicket} />

      {/* §6: Problem Appears Resolved follows Public Comments for the Requester.
          §8.1: Internal Notes come last for staff, below Public Comments and
          never beside them, so the two composers are never adjacent. For a
          Requester that panel is not hidden — it is not rendered at all (BR-20). */}
      {isStaff ? (
        <Thread ticketId={ticket.id} kind="notes" />
      ) : (
        <ResolutionSignal ticket={ticket} onChange={setTicket} />
      )}
    </section>
  );
}

// BR-34: the signal no longer applies once staff have resolved, closed or
// cancelled the Ticket.
const PAST_RESOLUTION: CurrentStatus[] = ["RESOLVED", "CLOSED", "CANCELLED"];

/** ui-spec.md §6 — "Problem Appears Resolved". FR-12, AC-16, BR-05, BR-34. */
function ResolutionSignal({ ticket, onChange }: { ticket: Ticket; onChange: (ticket: Ticket) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signalled: a fact with a time, not a toggle, so the button is
  // replaced by when it was said.
  if (ticket.requesterResolvedAt) {
    return (
      <p data-testid="resolution-signalled" className="zg-resolution-signalled">
        You reported this looked resolved on {formatDateTime(ticket.requesterResolvedAt)}.
      </p>
    );
  }

  // Not applicable: absent rather than disabled — an inert control would only
  // invite a click.
  if (PAST_RESOLUTION.includes(ticket.currentStatus)) return null;

  async function signal() {
    setBusy(true);
    setError(null);
    try {
      onChange(await markAppearsResolved(ticket.id));
    } catch (failure) {
      // §2.6: a conflict is inline under the row, and the button is back.
      setError(failure instanceof ApiError ? failure.message : "That could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="resolution-row" className="zg-resolution-row" aria-label="Problem Appears Resolved">
      <p className="zg-text-sm">Tell IT Staff the problem looks fixed. They decide when the ticket is resolved.</p>
      <button
        type="button"
        className={busy ? "zg-btn--secondary zg-btn--busy" : "zg-btn--secondary"}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void signal()}
      >
        {busy ? "Sending…" : "Problem Appears Resolved"}
      </button>
      {error && (
        <p className="zg-validation-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ReadOnly({
  label,
  value,
  block,
  multiline,
  testId,
}: {
  label: string;
  value: string;
  block?: boolean;
  multiline?: boolean;
  testId?: string;
}) {
  return (
    <div className={block ? "zg-field zg-field--block" : "zg-field"}>
      <span className="zg-field-label">{label}</span>
      <output
        className={multiline ? "zg-field--readonly zg-field--readonly-multiline" : "zg-field--readonly"}
        aria-readonly="true"
        data-testid={testId}
      >
        {value}
      </output>
    </div>
  );
}

/** A read-only field whose value is a badge rather than text (§2.3). */
function BadgeField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="zg-field">
      <span className="zg-field-label">{label}</span>
      <span className="zg-field--readonly zg-field--badge">{children}</span>
    </div>
  );
}
