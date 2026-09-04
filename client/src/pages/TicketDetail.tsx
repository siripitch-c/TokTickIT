import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  ApiError,
  ReferenceItem,
  Requester,
  Ticket,
  fetchCategories,
  fetchRelatedSystems,
  fetchTicket,
} from "../api.js";
import { PriorityBadge, StatusBadge } from "../components/Badge.js";
import AttachmentSection from "../components/AttachmentSection.js";
import { formatDateTime } from "../lib/attachmentRules.js";
import { readId } from "../lib/ids.js";

// ui-spec.md §7 — Requester Ticket Detail Screen.
// specification.md FR-09, BR-11, BR-12, BR-38; tests.md UI-DETAIL-01..02.

type DetailState = "loading" | "ready" | "not-found" | "error";

export default function TicketDetail() {
  const requester = useOutletContext<Requester>();
  const { id } = useParams<{ id: string }>();
  const ticketId = readId(id);

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

    fetchTicket(requester.id, ticketId)
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
  }, [requester.id, ticketId]);

  const nameOf = (list: ReferenceItem[], lookupId: number) =>
    list.find((item) => item.id === lookupId)?.name ?? "—";

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
  // hidden, so there is nothing to flash on screen (UI-DETAIL-02).
  if (state === "not-found" || state === "error") {
    return (
      <section className="zg-card zg-card--detail">
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>{state === "not-found" ? "Ticket not found." : "We couldn't load this ticket."}</p>
          <Link className="zg-btn--secondary" to="/my-tickets">
            Back to My Tickets
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
          <Link className="zg-btn--tertiary" to="/my-tickets">
            My Tickets
          </Link>
          <span aria-hidden="true"> &rsaquo; </span>
          <span aria-current="page">Ticket Details</span>
        </nav>
        <Link className="zg-btn--tertiary" to="/my-tickets">
          &larr; Back to My Tickets
        </Link>
      </div>

      <h1 className="zg-text-xl zg-text-left">{ticket.ticketNumber}</h1>

      {/* §7.1: the same field set as Create Ticket, all read-only, so a
          Requester recognises the information they entered. */}
      <div className="zg-field-row zg-field-row--4">
        <ReadOnly label="Ticket No." value={ticket.ticketNumber} testId="detail-ticket-number" />
        <ReadOnly label="Ticket Date" value={formatDateTime(ticket.createdAt)} />
        <ReadOnly label="Category" value={nameOf(categories, ticket.categoryId)} />
        <ReadOnly label="Related System" value={nameOf(systems, ticket.relatedSystemId)} />
      </div>

      <div className="zg-field-row zg-field-row--4">
        <ReadOnly label="Requester" value={requester.name} />
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

      <ReadOnly label="Summary" value={ticket.summary} block />
      <ReadOnly label="Description" value={ticket.description} block multiline />

      {/* §7.1 item 2: a hard visual break, because the handout requires ticket
          information and attachment actions to be clearly distinguished. */}
      <hr className="zg-detail-divider" />

      <AttachmentSection
        requesterId={requester.id}
        ticketId={ticket.id}
        initialAttachments={ticket.attachments}
      />
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
