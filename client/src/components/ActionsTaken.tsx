import { FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  ActionStatus,
  ActionTaken,
  ActorSummary,
  ApiError,
  AuthUser,
  NewAction,
  createAction,
  fetchActions,
  fetchAssignees,
  updateAction,
} from "../api.js";
import { formatDateTime } from "../lib/attachmentRules.js";
import ConfirmDialog from "./ConfirmDialog.js";

// ui-spec.md §6 — Actions Taken on Ticket Detail.
// specification.md FR-01..FR-07, BR-01..BR-14; api-spec.md §5.
//
// The work log: what was done, when, by whom, with what result, and whether
// anything still needs following up. Staff write it; the Requester reads it and
// is offered no write control at all — not a disabled one (FR-06), because a
// greyed button still says "this is for you, later".
//
// The server is the authority for every rule here. The form prevents what it
// can, but each refusal below is also a refusal at the API (BR-14), and the
// stale-write path exists precisely because the client cannot know it is the
// only writer.

const DESCRIPTION_MAX = 2000;
const TEXT_MAX = 2000;
const FOLLOW_UP_MIN = 5;
const FOLLOW_UP_MAX = 1000;

const STATUS_LABEL: Record<ActionStatus, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_CLASS: Record<ActionStatus, string> = {
  PLANNED: "zg-badge zg-badge--action-planned",
  IN_PROGRESS: "zg-badge zg-badge--action-progress",
  COMPLETED: "zg-badge zg-badge--action-complete",
  CANCELLED: "zg-badge zg-badge--action-cancelled",
};

/** The three a new Action may start in: cancelling something never planned records nothing. */
const CREATE_STATUSES: ActionStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED"];

export function ActionStatusBadge({ value }: { value: ActionStatus }) {
  // Text plus colour, never colour alone (ui-spec.md §2.2); Cancelled also
  // carries a strikethrough so the two muted states cannot be confused.
  return (
    <span className={STATUS_CLASS[value]} title={`Action status: ${STATUS_LABEL[value]}`}>
      {value === "COMPLETED" ? "✓ " : ""}
      {STATUS_LABEL[value]}
    </span>
  );
}

type LoadState = "loading" | "ready" | "error";

interface Props {
  ticketId: number;
  user: AuthUser;
  /** Staff may write; a Requester may only read (FR-06, BR-14). */
  canManage: boolean;
}

export default function ActionsTaken({ ticketId, user, canManage }: Props) {
  const headingId = useId();
  const [state, setState] = useState<LoadState>("loading");
  const [actions, setActions] = useState<ActionTaken[]>([]);
  const [assignees, setAssignees] = useState<ActorSummary[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<ActionTaken | null>(null);
  // Where focus returns when the confirmation closes (ui-spec.md §11).
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string; stale: boolean } | null>(null);
  /** Set when Complete was pressed on an Action with no result yet (ui-spec §6.4). */
  const [needsResult, setNeedsResult] = useState<number | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setState("loading");
    fetchActions(ticketId)
      .then((data) => {
        if (!live) return;
        setActions(data);
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [ticketId, attempt]);

  // The assignee list is staff-only data, so a Requester never asks for it.
  useEffect(() => {
    if (!canManage) return;
    let live = true;
    fetchAssignees()
      .then((data) => live && setAssignees(data))
      .catch(() => live && setAssignees([]));
    return () => {
      live = false;
    };
  }, [canManage]);

  function replace(updated: ActionTaken) {
    setActions((current) => current.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function changeStatus(action: ActionTaken, status: ActionStatus) {
    setBusyRow(action.id);
    setRowError(null);
    try {
      replace(await updateAction(action.id, { version: action.version, status }));
    } catch (error) {
      reportRowError(action.id, error);
    } finally {
      setBusyRow(null);
    }
  }

  function reportRowError(id: number, error: unknown) {
    const api = error instanceof ApiError ? error : null;
    // §2.3: a stale write is neither a validation message nor the generic
    // failure block. It offers Reload, because the person is about to lose
    // work if they ignore it (BR-27).
    const stale = api?.code === "STALE_UPDATE" || api?.code === "ACTION_FINAL";
    setRowError({
      id,
      message: api?.message ?? "We couldn't save that. Please try again.",
      stale,
    });
  }

  if (state === "loading") {
    return (
      <section className="zg-actions" data-testid="actions-taken-loading" aria-labelledby={headingId}>
        <h3 id={headingId} className="zg-actions-heading">
          Actions Taken
        </h3>
        <div className="zg-state--loading" role="status">
          Loading the actions…
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="zg-actions" data-testid="actions-taken-error" aria-labelledby={headingId}>
        <h3 id={headingId} className="zg-actions-heading">
          Actions Taken
        </h3>
        <div className="zg-state--error" role="alert">
          <p>We couldn't load the actions taken.</p>
          <button type="button" className="zg-btn zg-btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section id="actions-taken" className="zg-actions" data-testid="actions-taken" aria-labelledby={headingId}>
      <div className="zg-actions-header">
        <h3 id={headingId} className="zg-actions-heading">
          Actions Taken ({actions.length})
        </h3>
        {canManage && !creating && (
          <button type="button" className="zg-btn zg-btn--primary" onClick={() => setCreating(true)}>
            Add Action
          </button>
        )}
      </div>

      {canManage && creating && (
        <ActionForm
          heading="Add an action"
          assignees={assignees}
          currentUserId={user.id}
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            const created = await createAction(ticketId, values);
            setActions((current) => [...current, created]);
            setCreating(false);
          }}
        />
      )}

      {actions.length === 0 ? (
        <div className="zg-state--empty">No actions have been recorded on this ticket yet.</div>
      ) : (
        <ol className="zg-actions-list">
          {actions.map((action) =>
            editing === action.id ? (
              <li key={action.id} className="zg-action">
                <ActionForm
                  heading="Edit action"
                  assignees={assignees}
                  currentUserId={user.id}
                  initial={action}
                  missingResult={needsResult === action.id}
                  onCancel={() => {
                    setNeedsResult(null);
                    setEditing(null);
                  }}
                  onSubmit={async (values) => {
                    replace(await updateAction(action.id, { ...values, version: action.version }));
                    setNeedsResult(null);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={action.id} className="zg-action">
                <div className="zg-action-top">
                  <ActionStatusBadge value={action.status} />
                  <span className="zg-action-when">{formatDateTime(action.actionAt)}</span>
                </div>

                <p className="zg-action-description">{action.description}</p>

                <dl className="zg-action-fields">
                  <div>
                    <dt>Result</dt>
                    <dd>{action.result ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Who</dt>
                    <dd>
                      {action.performedBy.name}
                      {action.assignedTo.id !== action.performedBy.id && (
                        <span className="zg-action-assignee"> for {action.assignedTo.name}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Follow-up</dt>
                    <dd>{action.followUpRequired ? `Yes — ${action.followUpNote ?? ""}` : "No"}</dd>
                  </div>
                  {action.attachmentNotes && (
                    <div>
                      <dt>Files</dt>
                      <dd>{action.attachmentNotes}</dd>
                    </div>
                  )}
                </dl>

                {rowError?.id === action.id && (
                  <RowConflict
                    message={rowError.message}
                    stale={rowError.stale}
                    onReload={() => {
                      setRowError(null);
                      setAttempt((n) => n + 1);
                    }}
                  />
                )}

                {/* FR-06: a Requester gets no control here, and a finished
                    Action offers none to anybody — it is final (BR-05). */}
                {canManage && action.status !== "COMPLETED" && action.status !== "CANCELLED" && (
                  <div className="zg-action-controls">
                    <button
                      type="button"
                      className="zg-btn zg-btn--secondary"
                      disabled={busyRow === action.id}
                      onClick={() => {
                        setRowError(null);
                        setEditing(action.id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="zg-btn zg-btn--primary"
                      disabled={busyRow === action.id}
                      onClick={() => {
                        setRowError(null);
                        // BR-06: a result is what "completed" means. Rather than
                        // a dead button with the reason hidden in a tooltip, the
                        // edit form opens on the field that is missing.
                        if (!action.result) {
                          setNeedsResult(action.id);
                          setEditing(action.id);
                          return;
                        }
                        changeStatus(action, "COMPLETED");
                      }}
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      className="zg-btn zg-btn--secondary"
                      ref={cancelling?.id === action.id ? cancelTrigger : undefined}
                      disabled={busyRow === action.id}
                      onClick={() => setCancelling(action)}
                    >
                      Cancel action
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ol>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel this action?"
          confirmLabel="Cancel action"
          busy={busyRow === cancelling.id}
          returnFocusTo={cancelTrigger}
          onConfirm={async () => {
            const target = cancelling;
            setCancelling(null);
            await changeStatus(target, "CANCELLED");
          }}
          onCancel={() => setCancelling(null)}
        >
          It stays in the log and cannot be reopened.
        </ConfirmDialog>
      )}
    </section>
  );
}

interface FormProps {
  heading: string;
  assignees: ActorSummary[];
  currentUserId: number;
  initial?: ActionTaken;
  /** Opened because Complete was pressed with no result (ui-spec §6.4). */
  missingResult?: boolean;
  onCancel: () => void;
  onSubmit: (values: NewAction) => Promise<void>;
}

/** ui-spec.md §6.3 — inline rather than a modal: the author needs the rest of the Ticket visible. */
function ActionForm({ heading, assignees, currentUserId, initial, missingResult, onCancel, onSubmit }: FormProps) {
  const descriptionId = useId();
  const resultId = useId();
  const followUpNoteId = useId();
  const followUpGroupId = useId();

  const [description, setDescription] = useState(initial?.description ?? "");
  const [result, setResult] = useState(initial?.result ?? "");
  const [status, setStatus] = useState<ActionStatus>(initial?.status ?? "PLANNED");
  const [assignedToId, setAssignedToId] = useState<number>(initial?.assignedTo.id ?? currentUserId);
  const [followUpRequired, setFollowUpRequired] = useState(initial?.followUpRequired ?? false);
  const [followUpNote, setFollowUpNote] = useState(initial?.followUpNote ?? "");
  const [attachmentNotes, setAttachmentNotes] = useState(initial?.attachmentNotes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>(
    missingResult ? { result: "A result is required to complete an action." } : {},
  );
  const resultField = useRef<HTMLTextAreaElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The field that is missing takes focus, so a keyboard user is put where the
  // work is rather than told about it somewhere on the page.
  useEffect(() => {
    if (missingResult) resultField.current?.focus();
  }, [missingResult]);

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    const text = description.trim();
    if (text.length < 5 || text.length > DESCRIPTION_MAX) {
      found.description = `An action description must be between 5 and ${DESCRIPTION_MAX} characters.`;
    }
    // BR-06: a result is what "completed" means.
    if (status === "COMPLETED" && result.trim().length === 0) {
      found.result = "A result is required to complete an action.";
    }
    // BR-07: the note is mandatory from the moment follow-up is set to yes.
    if (followUpRequired) {
      const note = followUpNote.trim();
      if (note.length < FOLLOW_UP_MIN || note.length > FOLLOW_UP_MAX) {
        found.followUpNote = `A follow-up note is required, between ${FOLLOW_UP_MIN} and ${FOLLOW_UP_MAX} characters.`;
      }
    }
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setFailure(null);
    try {
      await onSubmit({
        description: description.trim(),
        result: result.trim(),
        status,
        assignedToId,
        followUpRequired,
        // BR-07: when follow-up is off the note is not sent at all.
        followUpNote: followUpRequired ? followUpNote.trim() : "",
        attachmentNotes: attachmentNotes.trim(),
      });
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      if (api?.field) {
        setErrors({ [api.field]: api.message });
      } else {
        // FR-24: everything typed stays in the form; only the message changes.
        setFailure(api?.message ?? "We couldn't save that. Please try again.");
      }
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <form className="zg-action-form" onSubmit={submit} noValidate>
      <h4 className="zg-action-form-heading">{heading}</h4>

      {failure && (
        <div className="zg-callout--error" role="alert">
          {failure}
        </div>
      )}

      <div className="zg-field">
        <label className="zg-field-label" htmlFor={descriptionId}>
          What was done <span className="zg-required-marker" aria-hidden="true">*</span>
        </label>
        <textarea
          id={descriptionId}
          className={`zg-field--textarea ${errors.description ? "zg-field--invalid" : "zg-field--editable"}`}
          value={description}
          maxLength={DESCRIPTION_MAX}
          aria-invalid={errors.description ? true : undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
        <span className={`zg-char-counter ${description.length >= DESCRIPTION_MAX ? "zg-char-counter--over" : ""}`}>
          {description.length} / {DESCRIPTION_MAX}
        </span>
        {errors.description && (
          <p className="zg-validation-message" role="alert">
            {errors.description}
          </p>
        )}
      </div>

      <div className="zg-field">
        <label className="zg-field-label" htmlFor={resultId}>
          Result
        </label>
        <textarea
          id={resultId}
          ref={resultField}
          className={`zg-field--textarea ${errors.result ? "zg-field--invalid" : "zg-field--editable"}`}
          value={result}
          maxLength={TEXT_MAX}
          aria-invalid={errors.result ? true : undefined}
          onChange={(event) => setResult(event.target.value)}
        />
        <span className="zg-text-xs zg-text-muted">Required to complete the action.</span>
        {errors.result && (
          <p className="zg-validation-message" role="alert">
            {errors.result}
          </p>
        )}
      </div>

      {/* One column, like every other row in this form. `zg-field-row--2`
          was written here in Issue #47 and no such rule exists, so this row
          has always rendered as one column; Issue #49 removed the class
          rather than inventing the rule, because §6.3 lists the fields in
          order and never asks for columns. */}
      <div className="zg-field-row">
        <div className="zg-field">
          <label className="zg-field-label" htmlFor={`${descriptionId}-assignee`}>
            Assigned to
          </label>
          <select
            id={`${descriptionId}-assignee`}
            className="zg-field--editable"
            value={assignedToId}
            onChange={(event) => setAssignedToId(Number(event.target.value))}
          >
            {/* BR-04: only active IT Staff and Administrators are offered. */}
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {errors.assignedToId && (
            <p className="zg-validation-message" role="alert">
              {errors.assignedToId}
            </p>
          )}
        </div>

        <div className="zg-field">
          <label className="zg-field-label" htmlFor={`${descriptionId}-status`}>
            Status
          </label>
          <select
            id={`${descriptionId}-status`}
            className="zg-field--editable"
            value={status}
            onChange={(event) => setStatus(event.target.value as ActionStatus)}
          >
            {CREATE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="zg-field zg-field--group" aria-describedby={followUpGroupId}>
        <legend className="zg-field-label">Follow-up required</legend>
        <span id={followUpGroupId} className="zg-text-xs zg-text-muted">
          Choose Yes and a follow-up note becomes required.
        </span>
        <div className="zg-radio-row">
          <label className="zg-radio">
            <input
              type="radio"
              name={`${descriptionId}-follow-up`}
              checked={!followUpRequired}
              onChange={() => setFollowUpRequired(false)}
            />
            No
          </label>
          <label className="zg-radio">
            <input
              type="radio"
              name={`${descriptionId}-follow-up`}
              checked={followUpRequired}
              onChange={() => setFollowUpRequired(true)}
            />
            Yes
          </label>
        </div>
      </fieldset>

      {followUpRequired && (
        <div className="zg-field">
          <label className="zg-field-label" htmlFor={followUpNoteId}>
            Follow-up note <span className="zg-required-marker" aria-hidden="true">*</span>
          </label>
          <textarea
            id={followUpNoteId}
            className={`zg-field--textarea zg-field--textarea-short ${
              errors.followUpNote ? "zg-field--invalid" : "zg-field--editable"
            }`}
            value={followUpNote}
            maxLength={FOLLOW_UP_MAX}
            aria-required="true"
            aria-invalid={errors.followUpNote ? true : undefined}
            onChange={(event) => setFollowUpNote(event.target.value)}
          />
          {errors.followUpNote && (
            <p className="zg-validation-message" role="alert">
              {errors.followUpNote}
            </p>
          )}
        </div>
      )}

      <div className="zg-field">
        <label className="zg-field-label" htmlFor={`${descriptionId}-files`}>
          Attachment notes
        </label>
        <input
          id={`${descriptionId}-files`}
          className="zg-field--editable"
          value={attachmentNotes}
          maxLength={TEXT_MAX}
          onChange={(event) => setAttachmentNotes(event.target.value)}
        />
        <span className="zg-text-xs zg-text-muted">Which file should a colleague look for?</span>
      </div>

      <div className="zg-action-form-controls">
        <button type="button" className="zg-btn zg-btn--secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {/* BR-31: disabled for the duration, so a double click cannot create two rows. */}
        <button type="submit" className="zg-btn zg-btn--primary" disabled={busy}>
          {busy ? "Saving…" : "Save action"}
        </button>
      </div>
    </form>
  );
}

/**
 * ui-spec.md §2.3 and §11 — a refused write, announced. A stale one offers
 * Reload and takes focus to it, because the person is about to lose work if
 * they scroll past the message; an ordinary refusal is read where it sits.
 */
function RowConflict({
  message,
  stale,
  onReload,
}: {
  message: string;
  stale: boolean;
  onReload: () => void;
}) {
  const reload = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (stale) reload.current?.focus();
  }, [stale, message]);

  return (
    <div className={stale ? "zg-conflict" : "zg-callout--error"} role="alert">
      <span>{message}</span>
      {stale && (
        <button ref={reload} type="button" className="zg-btn zg-btn--secondary" onClick={onReload}>
          Reload
        </button>
      )}
    </div>
  );
}
