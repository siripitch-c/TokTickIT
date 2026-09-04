import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  AttachmentMeta,
  ApiError,
  ReferenceItem,
  Requester,
  RequestedPriority,
  Ticket,
  createTicket,
  fetchCategories,
  fetchRelatedSystems,
  uploadAttachment,
} from "../api.js";
import {
  ALLOWED_EXTENSIONS,
  ATTACHMENT_HELP,
  LIMIT_MESSAGE,
  MAX_ATTACHMENTS,
  formatBytes,
  rejectionReason,
} from "../lib/attachmentRules.js";

// ui-spec.md §5 — Create Ticket Screen.
// specification.md FR-03/FR-04/FR-15, BR-19..BR-28, BR-33; tests.md UI-CREATE-01..10.

const SUMMARY_MIN = 5;
const SUMMARY_MAX = 150;
const SUMMARY_COUNTER_FROM = 120;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 2000;
const DESCRIPTION_COUNTER_FROM = 1800;

const PRIORITIES: { value: RequestedPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

type FieldName = "categoryId" | "relatedSystemId" | "requestedPriority" | "summary" | "description";
type FormValues = Record<FieldName, string>;
type FieldErrors = Partial<Record<FieldName, string>>;

interface PendingFile {
  key: string;
  file: File;
}

interface RejectedFile {
  key: string;
  name: string;
  reason: string;
}

interface SuccessState {
  ticket: Ticket;
  uploaded: AttachmentMeta[];
  failed: { name: string; reason: string }[];
}

const EMPTY_FORM: FormValues = {
  categoryId: "",
  relatedSystemId: "",
  requestedPriority: "",
  summary: "",
  description: "",
};

export default function CreateTicket() {
  const requester = useOutletContext<Requester>();
  const navigate = useNavigate();

  // The Ticket Date previews the value that becomes createdAt, so it is frozen
  // while a form is open rather than ticking forward (ui-spec.md §5.1) — but it
  // belongs to *this* form: "Create Another" starts a new one and must reset it,
  // otherwise the second ticket is shown the first one's opening time.
  const [openedAt, setOpenedAt] = useState(() => new Date());

  const [referenceState, setReferenceState] = useState<"loading" | "ready" | "error">("loading");
  const [categories, setCategories] = useState<ReferenceItem[]>([]);
  const [relatedSystems, setRelatedSystems] = useState<ReferenceItem[]>([]);

  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const fieldRefs = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  async function loadReferenceData() {
    setReferenceState("loading");
    try {
      const [loadedCategories, loadedSystems] = await Promise.all([
        fetchCategories(),
        fetchRelatedSystems(),
      ]);
      setCategories(loadedCategories);
      setRelatedSystems(loadedSystems);
      setReferenceState("ready");
    } catch {
      setReferenceState("error");
    }
  }

  useEffect(() => {
    loadReferenceData();
  }, []);

  function setValue(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // Clearing the message as soon as the field is corrected keeps the
    // validation summary honest rather than stale.
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  // AC-04/BR-23: mirrors the server rules exactly, so nothing that would fail
  // server-side is ever sent.
  function validate(): FieldErrors {
    const found: FieldErrors = {};
    const summary = values.summary.trim();
    const description = values.description.trim();

    if (!values.categoryId) found.categoryId = "Please choose a category.";
    if (!values.relatedSystemId) found.relatedSystemId = "Please choose a related system.";
    if (!values.requestedPriority) found.requestedPriority = "Please choose a requested priority.";
    if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) {
      found.summary = `Summary must be between ${SUMMARY_MIN} and ${SUMMARY_MAX} characters.`;
    }
    if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
      found.description = `Description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`;
    }
    return found;
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setAttachmentNotice(null);

    const accepted: PendingFile[] = [];
    const refused: RejectedFile[] = [];
    let limitHit = false;

    for (const file of files) {
      const reason = rejectionReason(file);
      if (reason) {
        // BR-26/BR-27: an invalid file is reported but never counted toward
        // the 0–5 total, so other valid selections are unaffected.
        refused.push({ key: `${file.name}-${Date.now()}-${refused.length}`, name: file.name, reason });
        continue;
      }
      if (pending.length + accepted.length >= MAX_ATTACHMENTS) {
        limitHit = true; // BR-28
        continue;
      }
      accepted.push({ key: `${file.name}-${Date.now()}-${accepted.length}`, file });
    }

    if (accepted.length > 0) setPending((current) => [...current, ...accepted]);
    if (refused.length > 0) setRejected((current) => [...current, ...refused]);
    if (limitHit) setAttachmentNotice(LIMIT_MESSAGE);
  }

  function removePending(key: string) {
    setPending((current) => current.filter((item) => item.key !== key));
    setAttachmentNotice(null);
  }

  // A rejected file could otherwise never leave the list: correcting the
  // mistake left its red row on screen with no way to dismiss it.
  function dismissRejected(key: string) {
    setRejected((current) => current.filter((item) => item.key !== key));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return; // BR-22: a second click during flight does nothing.

    const found = validate();
    if (Object.keys(found).length > 0) {
      // Every invalid field is flagged at once, then focus moves to the first
      // one (ui-spec.md §5.4) — no API call is made.
      setErrors(found);
      setSubmitError(null);
      const order: FieldName[] = ["categoryId", "relatedSystemId", "requestedPriority", "summary", "description"];
      const firstInvalid = order.find((field) => found[field]);
      if (firstInvalid) fieldRefs.current[firstInvalid]?.focus();
      return;
    }

    setErrors({});
    setSubmitError(null);
    setSubmitting(true);

    try {
      const ticket = await createTicket(requester.id, {
        categoryId: Number(values.categoryId),
        relatedSystemId: Number(values.relatedSystemId),
        requestedPriority: values.requestedPriority as RequestedPriority,
        summary: values.summary.trim(),
        description: values.description.trim(),
      });

      // BR-25/BR-34: the Ticket is already saved. Each attachment is uploaded
      // independently and a failure is reported against that file only — the
      // Ticket is never rolled back and successful uploads are kept.
      const uploaded: AttachmentMeta[] = [];
      const failed: { name: string; reason: string }[] = [];
      for (const item of pending) {
        try {
          uploaded.push(await uploadAttachment(requester.id, ticket.id, item.file));
        } catch (error) {
          failed.push({
            name: item.file.name,
            reason: error instanceof ApiError ? error.message : "Upload failed. Please try again.",
          });
        }
      }

      setSuccess({ ticket, uploaded, failed });
    } catch (error) {
      // BR-24/AC-06: every entered value stays in the form for retry; a
      // field-specific server message is shown on its own field.
      if (error instanceof ApiError && error.field && error.field in EMPTY_FORM) {
        setErrors({ [error.field as FieldName]: error.message });
      }
      setSubmitError(
        error instanceof ApiError && error.status < 500
          ? error.message
          : "Something went wrong saving your ticket. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother() {
    setSuccess(null);
    setOpenedAt(new Date());
    setValues(EMPTY_FORM);
    setErrors({});
    setPending([]);
    setRejected([]);
    setAttachmentNotice(null);
    setSubmitError(null);
  }

  if (success) {
    return <CreatedPanel state={success} onCreateAnother={startAnother} />;
  }

  const summaryLength = values.summary.trim().length;
  const descriptionLength = values.description.trim().length;

  return (
    <section className="zg-card">
      <nav className="zg-breadcrumb" aria-label="Breadcrumb">
        <Link className="zg-btn--tertiary" to="/my-tickets">
          My Tickets
        </Link>
        <span aria-hidden="true"> &rsaquo; </span>
        <span aria-current="page">Create Ticket</span>
      </nav>

      <h1 className="zg-text-xl">Create Ticket</h1>

      {referenceState === "loading" && (
        <div data-testid="zg-state-loading" className="zg-state--loading" role="status">
          <div className="zg-skeleton-bar" />
          Loading form options&hellip;
        </div>
      )}

      {referenceState === "error" && (
        <div data-testid="zg-state-error" className="zg-state--error" role="alert">
          <p>We couldn&rsquo;t load the categories and related systems.</p>
          <button type="button" className="zg-btn--secondary" onClick={loadReferenceData}>
            Retry
          </button>
        </div>
      )}

      {referenceState === "ready" && (
        <form onSubmit={handleSubmit} noValidate>
          {submitError && (
            <div data-testid="zg-submit-error" className="zg-state--error" role="alert">
              {submitError}
            </div>
          )}

          {/* System-generated row — read-only throughout (ui-spec.md §5.1). */}
          <div className="zg-field-row zg-field-row--3">
            <ReadOnlyField label="Ticket Number" value="Generated after submit" />
            <ReadOnlyField label="Ticket Date" value={openedAt.toLocaleString()} testId="ticket-date" />
            <ReadOnlyField label="Requester" value={requester.name} />
          </div>

          {/* Classification row (ui-spec.md §5.1). */}
          <div className="zg-field-row zg-field-row--3">
            <SelectField
              name="categoryId"
              label="Category"
              placeholder="Choose a category"
              options={categories}
              value={values.categoryId}
              error={errors.categoryId}
              disabled={submitting}
              onChange={setValue}
              inputRef={(el) => (fieldRefs.current.categoryId = el)}
            />
            <SelectField
              name="relatedSystemId"
              label="Related System"
              placeholder="Choose a related system"
              options={relatedSystems}
              value={values.relatedSystemId}
              error={errors.relatedSystemId}
              disabled={submitting}
              onChange={setValue}
              inputRef={(el) => (fieldRefs.current.relatedSystemId = el)}
            />
            <SelectField
              name="requestedPriority"
              label="Requested Priority"
              placeholder="Choose a priority"
              options={PRIORITIES.map((p) => ({ id: p.value, name: p.label }))}
              value={values.requestedPriority}
              error={errors.requestedPriority}
              disabled={submitting}
              onChange={setValue}
              inputRef={(el) => (fieldRefs.current.requestedPriority = el)}
            />
          </div>

          <FieldShell
            name="summary"
            label="Summary"
            error={errors.summary}
            counter={summaryLength > SUMMARY_COUNTER_FROM ? `${summaryLength}/${SUMMARY_MAX}` : null}
          >
            <input
              id="summary"
              type="text"
              className={errors.summary ? "zg-field--invalid" : "zg-field--editable"}
              value={values.summary}
              disabled={submitting}
              aria-invalid={Boolean(errors.summary)}
              aria-describedby={errors.summary ? "summary-error" : undefined}
              onChange={(e) => setValue("summary", e.target.value)}
              ref={(el) => (fieldRefs.current.summary = el)}
            />
          </FieldShell>

          <FieldShell
            name="description"
            label="Description"
            error={errors.description}
            counter={
              descriptionLength > DESCRIPTION_COUNTER_FROM
                ? `${descriptionLength}/${DESCRIPTION_MAX}`
                : null
            }
          >
            <textarea
              id="description"
              className={`zg-field--textarea ${errors.description ? "zg-field--invalid" : "zg-field--editable"}`}
              value={values.description}
              disabled={submitting}
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? "description-error" : undefined}
              onChange={(e) => setValue("description", e.target.value)}
              ref={(el) => (fieldRefs.current.description = el)}
            />
          </FieldShell>

          <section className="zg-section">
            <h2 className="zg-text-lg">Attachments</h2>

            <div
              data-testid="zg-dropzone"
              className="zg-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <label htmlFor="attachments" className="zg-field-label">
                Add attachments
              </label>
              <input
                id="attachments"
                type="file"
                multiple
                accept={ALLOWED_EXTENSIONS.join(",")}
                disabled={submitting}
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  // Reset so re-picking the same file still fires a change.
                  e.target.value = "";
                }}
              />
              <p className="zg-text-sm zg-text-muted">
                Drag files here, or choose them above. {ATTACHMENT_HELP}
              </p>
            </div>

            {attachmentNotice && (
              <p data-testid="zg-attachment-notice" className="zg-validation-message" role="alert">
                {attachmentNotice}
              </p>
            )}

            <ul className="zg-attachment-list">
              {pending.map((item) => (
                <li key={item.key} className="zg-attachment-row--pending">
                  <span className="zg-attachment-name">{item.file.name}</span>
                  <span className="zg-text-sm zg-text-muted">{formatBytes(item.file.size)}</span>
                  <button
                    type="button"
                    className="zg-btn--tertiary"
                    title={`Remove ${item.file.name} from this ticket`}
                    aria-label={`Remove ${item.file.name} from this ticket`}
                    disabled={submitting}
                    onClick={() => removePending(item.key)}
                  >
                    &times;
                  </button>
                </li>
              ))}
              {/* role="alert" goes on the message rather than the <li>: on the
                  row it replaces the implicit listitem role and drops the row
                  out of the list. ui-spec.md §9 asks for it on validation
                  messages, which is what it now marks. */}
              {rejected.map((item) => (
                <li key={item.key} className="zg-attachment-row--invalid">
                  <span className="zg-attachment-name">{item.name}</span>
                  <span className="zg-validation-message" role="alert">
                    {item.reason}
                  </span>
                  <button
                    type="button"
                    className="zg-btn--tertiary"
                    title={`Dismiss ${item.name}`}
                    aria-label={`Dismiss ${item.name}`}
                    disabled={submitting}
                    onClick={() => dismissRejected(item.key)}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <div className="zg-actions-row">
            <button
              type="button"
              className="zg-btn--secondary"
              disabled={submitting}
              onClick={() => navigate("/my-tickets")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={submitting ? "zg-btn--primary zg-btn--busy" : "zg-btn--primary"}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Submitting…" : "Submit Ticket"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ui-spec.md §5.4 success state: the form is replaced, not overlaid, so the
// generated Ticket Number is the only thing competing for attention.
function CreatedPanel({
  state,
  onCreateAnother,
}: {
  state: SuccessState;
  onCreateAnother: () => void;
}) {
  return (
    <section className="zg-card">
      <div data-testid="zg-state-success" className="zg-state--success" role="status">
        <span className="zg-icon-badge" aria-hidden="true" />
        <h1 className="zg-text-xl">Ticket created</h1>
        <p className="zg-ticket-number" data-testid="created-ticket-number">
          {state.ticket.ticketNumber}
        </p>
        {state.uploaded.length > 0 && (
          <p className="zg-text-sm zg-text-muted">
            {state.uploaded.length} attachment{state.uploaded.length === 1 ? "" : "s"} uploaded.
          </p>
        )}
      </div>

      {/* BR-25: the Ticket stands even when an attachment did not make it. */}
      {state.failed.length > 0 && (
        <div data-testid="zg-attachment-warning" className="zg-callout--warning" role="alert">
          <strong>Some attachments were not uploaded.</strong>
          <ul>
            {state.failed.map((item) => (
              <li key={item.name}>
                {item.name} — {item.reason}
              </li>
            ))}
          </ul>
          Your ticket was saved. You can add these files again from the ticket.
        </div>
      )}

      <div className="zg-actions-row">
        <button type="button" className="zg-btn--secondary" onClick={onCreateAnother}>
          Create Another
        </button>
        <Link className="zg-btn--primary" to={`/tickets/${state.ticket.id}`}>
          View Ticket
        </Link>
      </div>
    </section>
  );
}

// Read-only fields are shaded and marked aria-readonly rather than disabled, so
// screen readers still announce their value (ui-spec.md §2.1).
function ReadOnlyField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="zg-field">
      <span className="zg-field-label">{label}</span>
      <output className="zg-field--readonly" aria-readonly="true" data-testid={testId}>
        {value}
      </output>
    </div>
  );
}

function FieldShell({
  name,
  label,
  error,
  counter,
  children,
}: {
  name: FieldName;
  label: string;
  error?: string;
  counter?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="zg-field">
      <label className="zg-field-label" htmlFor={name}>
        {label} <span className="zg-required-marker" aria-hidden="true">*</span>
        <span className="zg-visually-hidden">(required)</span>
      </label>
      {children}
      {counter && (
        <span className="zg-text-xs zg-text-muted zg-char-counter">{counter}</span>
      )}
      {error && (
        <span id={`${name}-error`} className="zg-validation-message" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function SelectField({
  name,
  label,
  placeholder,
  options,
  value,
  error,
  disabled,
  onChange,
  inputRef,
}: {
  name: FieldName;
  label: string;
  placeholder: string;
  options: { id: number | string; name: string }[];
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (field: FieldName, value: string) => void;
  inputRef: (el: HTMLSelectElement | null) => void;
}) {
  return (
    <FieldShell name={name} label={label} error={error}>
      <select
        id={name}
        className={error ? "zg-field--invalid" : "zg-field--editable"}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        onChange={(e) => onChange(name, e.target.value)}
        ref={inputRef}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={String(option.id)}>
            {option.name}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

