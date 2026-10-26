import { useEffect, useId, useRef, useState } from "react";
import {
  ActorSummary,
  ApiError,
  AuthUser,
  CurrentStatus,
  RequestedPriority,
  Ticket,
  fetchAssignees,
  setItPriority,
  setTicketOwner,
  setTicketStatus,
} from "../api.js";
import { CONFIRMATION, allowedTransitions } from "../lib/statusTransitions.js";
import { PriorityBadge, STATUS_LABEL } from "./Badge.js";
import ConfirmDialog from "./ConfirmDialog.js";

// ui-spec.md §8.2 — the Operations panel. FR-15, FR-17, FR-18, AC-10..AC-13,
// BR-25..BR-33.
//
// Three controls that save independently, so one failure never discards the
// other two. Each select always shows the Ticket as the server last described
// it: a change is sent, and only the server's answer moves the value. That is
// what makes "the control reverts" on a failure (§2.6) automatic rather than a
// piece of bookkeeping that could be forgotten.

type Control = "owner" | "itPriority" | "status";

interface ControlState {
  saving: boolean;
  saved: boolean;
  error: string | null;
  // lab-04/ui-spec.md §2.3 and §7: a refusal that the user can act on is not
  // the same as one they can only read. A stale write offers Reload, and a
  // refused resolution points at the Actions that caused it.
  stale: boolean;
  openActions: boolean;
}

const IDLE: ControlState = { saving: false, saved: false, error: null, stale: false, openActions: false };
const SAVED_VISIBLE_MS = 2500;

const PRIORITIES: { value: RequestedPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

interface Props {
  ticket: Ticket;
  user: AuthUser;
  onChange: (ticket: Ticket) => void;
  /** Re-reads the Ticket from the server — what Reload does after a stale
   *  write (lab-04 BR-27, FR-24). */
  onReload: () => void;
}

export default function OperationsPanel({ ticket, user, onChange, onReload }: Props) {
  const headingId = useId();
  const ownerId = useId();
  const priorityId = useId();
  const statusId = useId();
  const statusHelpId = useId();
  const resolveHelpId = useId();

  const [assignees, setAssignees] = useState<ActorSummary[]>([]);
  const [assigneesLoaded, setAssigneesLoaded] = useState(false);
  const [controls, setControls] = useState<Record<Control, ControlState>>({
    owner: IDLE,
    itPriority: IDLE,
    status: IDLE,
  });
  const [pendingStatus, setPendingStatus] = useState<CurrentStatus | null>(null);

  const statusSelect = useRef<HTMLSelectElement>(null);
  const savedTimers = useRef<Partial<Record<Control, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    fetchAssignees()
      .then((people) => {
        setAssignees(people);
        setAssigneesLoaded(true);
      })
      // The Claim button and the current owner still work without the list.
      .catch(() => setAssignees([]));
  }, []);

  useEffect(() => {
    const timers = savedTimers.current;
    return () => Object.values(timers).forEach((timer) => clearTimeout(timer));
  }, []);

  const update = (control: Control, next: Partial<ControlState>) =>
    setControls((current) => ({ ...current, [control]: { ...current[control], ...next } }));

  // Reload re-reads the Ticket and clears the conflict it was shown for: the
  // record the warning was about is the record that just came back, so leaving
  // the warning up would be warning about nothing (lab-04/ui-spec.md §2.3).
  const reload = (control: Control) => () => {
    update(control, IDLE);
    onReload();
  };

  async function save(control: Control, send: () => Promise<Ticket>) {
    clearTimeout(savedTimers.current[control]);
    update(control, { saving: true, saved: false, error: null, stale: false, openActions: false });
    try {
      onChange(await send());
      update(control, { saving: false, saved: true });
      savedTimers.current[control] = setTimeout(() => update(control, { saved: false }), SAVED_VISIBLE_MS);
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      update(control, {
        saving: false,
        error: api?.message ?? "That change could not be saved. Please try again.",
        stale: api?.code === "STALE_UPDATE",
        openActions: api?.code === "OPEN_ACTIONS_REMAIN",
      });
    }
  }

  // BR-26: an owner deactivated after assignment stays on the Ticket, and the
  // select says so truthfully — a disabled "(inactive)" option — rather than
  // pretending the Ticket is unassigned. Choosing anyone else replaces them.
  const ownerListed = ticket.owner === null || assignees.some((person) => person.id === ticket.owner!.id);

  const moves = allowedTransitions(ticket.currentStatus);
  const currentLabel = STATUS_LABEL[ticket.currentStatus];

  // lab-04 BR-18, AC-09. The count comes from the Ticket the server described,
  // so the sentence here and the refusal the server would send are the same
  // number. The option is disabled to save a pointless attempt, never to make
  // the decision: the server is still the authority (FR-08).
  const open = ticket.openActionCount;
  const resolveBlocked = open > 0;
  const resolveReason =
    open === 1
      ? "1 action on this ticket is still open. Complete or cancel it before resolving it."
      : `${open} actions on this ticket are still open. Complete or cancel them before resolving it.`;

  function chooseStatus(next: CurrentStatus) {
    // BR-33: Closed and Cancelled ask first. The select keeps showing the real
    // status underneath, so cancelling leaves nothing to undo.
    if (CONFIRMATION[next]) {
      setPendingStatus(next);
      return;
    }
    void save("status", () => setTicketStatus(ticket.id, ticket.version, next));
  }

  async function confirmStatus() {
    if (!pendingStatus) return;
    const next = pendingStatus;
    await save("status", () => setTicketStatus(ticket.id, ticket.version, next));
    setPendingStatus(null);
  }

  return (
    <section data-testid="operations-panel" className="zg-operations" aria-labelledby={headingId}>
      <h2 id={headingId} className="zg-text-lg">
        Operations
      </h2>

      <div className="zg-operations-grid">
        <div className="zg-field">
          <label className="zg-field-label" htmlFor={ownerId}>
            Ticket Owner
          </label>
          <div className="zg-operations-control">
            <select
              id={ownerId}
              className="zg-field--editable"
              value={ticket.ownerId === null ? "" : String(ticket.ownerId)}
              disabled={controls.owner.saving}
              onChange={(e) => {
                const value = e.target.value;
                void save("owner", () =>
                  setTicketOwner(ticket.id, ticket.version, value === "" ? null : Number(value)),
                );
              }}
            >
              <option value="">Unassigned</option>
              {ticket.owner && !ownerListed && (
                <option value={String(ticket.owner.id)} disabled={assigneesLoaded}>
                  {assigneesLoaded ? `${ticket.owner.name} (inactive)` : ticket.owner.name}
                </option>
              )}
              {assignees.map((person) => (
                <option key={person.id} value={String(person.id)}>
                  {person.name}
                </option>
              ))}
            </select>
            {/* AC-10: one click makes the signed-in user the owner. */}
            <button
              type="button"
              className="zg-btn--secondary"
              disabled={controls.owner.saving || ticket.ownerId === user.id}
              onClick={() => void save("owner", () => setTicketOwner(ticket.id, ticket.version, user.id))}
            >
              Claim
            </button>
          </div>
          <Feedback state={controls.owner} onReload={reload("owner")} />
        </div>

        <div className="zg-field">
          {/* BR-29, AC-12: Requested Priority sits directly above, read-only,
              so the two are compared rather than confused. */}
          <span className="zg-field-label">Requested Priority</span>
          <span className="zg-field--readonly zg-field--badge" aria-readonly="true">
            <PriorityBadge value={ticket.requestedPriority} label="Requested priority" />
          </span>
          <label className="zg-field-label" htmlFor={priorityId}>
            IT Priority
          </label>
          <select
            id={priorityId}
            className="zg-field--editable"
            value={ticket.itPriority ?? ""}
            disabled={controls.itPriority.saving}
            onChange={(e) => {
              const value = e.target.value as RequestedPriority;
              void save("itPriority", () => setItPriority(ticket.id, ticket.version, value));
            }}
          >
            {ticket.itPriority === null && (
              <option value="" disabled>
                Not set
              </option>
            )}
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Feedback state={controls.itPriority} onReload={reload("itPriority")} />
        </div>

        <div className="zg-field">
          <label className="zg-field-label" htmlFor={statusId}>
            Current Status
          </label>
          {/* AC-13: only the moves BR-31 permits from here are offered. The
              option list changes with the status, so the select is described by
              a line naming the status it is currently offering moves from
              (§12, A11Y-07). */}
          <select
            ref={statusSelect}
            id={statusId}
            className="zg-field--editable"
            value={ticket.currentStatus}
            disabled={controls.status.saving || moves.length === 0}
            aria-describedby={
              resolveBlocked && moves.includes("RESOLVED") ? `${statusHelpId} ${resolveHelpId}` : statusHelpId
            }
            onChange={(e) => chooseStatus(e.target.value as CurrentStatus)}
          >
            <option value={ticket.currentStatus}>{currentLabel} (current)</option>
            {moves.map((status) => (
              <option
                key={status}
                value={status}
                // lab-04 AC-09: Resolve stays listed while Actions are open —
                // removing it would leave the reader guessing where it went —
                // but it cannot be chosen, and the sentence below says why.
                disabled={status === "RESOLVED" && resolveBlocked}
              >
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          <p id={statusHelpId} className="zg-text-xs zg-text-muted">
            {moves.length === 0
              ? `This ticket is ${currentLabel}. It cannot move to any other status.`
              : `This ticket is ${currentLabel}. Only the moves allowed from ${currentLabel} are listed.`}
          </p>
          {/* §12, A11Y: the reason is attached to the select rather than only
              shown beside it, so a keyboard user meets it before choosing. */}
          {resolveBlocked && moves.includes("RESOLVED") && (
            <p id={resolveHelpId} className="zg-text-xs zg-text-muted">
              {resolveReason}
            </p>
          )}
          <Feedback state={controls.status} onReload={reload("status")} />
        </div>
      </div>

      {pendingStatus && (
        <ConfirmDialog
          title={`Move this ticket to ${STATUS_LABEL[pendingStatus]}?`}
          confirmLabel={`Move to ${STATUS_LABEL[pendingStatus]}`}
          busy={controls.status.saving}
          returnFocusTo={statusSelect}
          onCancel={() => setPendingStatus(null)}
          onConfirm={() => void confirmStatus()}
        >
          {CONFIRMATION[pendingStatus]}
        </ConfirmDialog>
      )}
    </section>
  );
}

/** §8.2: a saving indicator, a brief success check, or the refusal in place. */
function Feedback({ state, onReload }: { state: ControlState; onReload: () => void }) {
  const reloadButton = useRef<HTMLButtonElement>(null);

  // lab-04/ui-spec.md §11: focus moves to Reload when a write is refused as
  // stale, because the person is about to lose their change if they scroll
  // past the message. Every other refusal is read where it sits.
  useEffect(() => {
    if (state.stale) reloadButton.current?.focus();
  }, [state.stale, state.error]);

  if (state.saving) {
    return (
      <span className="zg-inline-status zg-inline-status--saving" role="status">
        Saving…
      </span>
    );
  }
  if (state.error) {
    // lab-04/ui-spec.md §2.3: a stale write is not a validation message. The
    // record moved underneath the user, so the block offers the one action
    // that helps — re-read it — rather than inviting them to press Save again.
    if (state.stale) {
      return (
        <div className="zg-conflict" role="alert">
          <span>{state.error}</span>
          <button ref={reloadButton} type="button" className="zg-btn zg-btn--secondary" onClick={onReload}>
            Reload
          </button>
        </div>
      );
    }
    // lab-04/ui-spec.md §7: a refused resolution names the Actions that caused
    // it and takes the reader to them, because that is where the work is.
    if (state.openActions) {
      return (
        <div className="zg-conflict" role="alert">
          <span>{state.error}</span>
          <a href="#actions-taken">Go to Actions Taken</a>
        </div>
      );
    }
    // §2.6, §12: every other refusal is announced, and it sits under the
    // control that caused it rather than taking over the screen.
    return (
      <p className="zg-validation-message" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.saved) {
    return (
      <span className="zg-inline-status zg-inline-status--saved" role="status">
        &#10003; Saved
      </span>
    );
  }
  return null;
}
