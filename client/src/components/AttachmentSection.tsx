import { useEffect, useRef, useState } from "react";
import { ApiError, AttachmentMeta, downloadAttachment, removeAttachment, uploadAttachment } from "../api.js";
import {
  ALLOWED_EXTENSIONS,
  ATTACHMENT_HELP,
  LIMIT_MESSAGE,
  MAX_ATTACHMENTS,
  formatBytes,
  formatDateTime,
  rejectionReason,
} from "../lib/attachmentRules.js";

// ui-spec.md §7.1 (Attachments panel) and §7.4 (its states).
// specification.md FR-11..FR-13, BR-26..BR-33; tests.md UI-DETAIL-03..08.

const REASON_MIN = 5;
const REASON_MAX = 200;

interface UploadRow {
  key: string;
  file: File;
  state: "uploading" | "error";
  message?: string;
}

interface Props {
  requesterId: number;
  ticketId: number;
  initialAttachments: AttachmentMeta[];
}

export default function AttachmentSection({ requesterId, ticketId, initialAttachments }: Props) {
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(initialAttachments);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [removeTarget, setRemoveTarget] = useState<AttachmentMeta | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // BR-28 counts active attachments only — a removed one has given its slot
  // back. In-flight uploads count too, or five simultaneous ones would all
  // pass a check taken before any of them landed.
  const activeCount =
    attachments.filter((a) => a.removedAt === null).length +
    uploads.filter((u) => u.state === "uploading").length;
  const atLimit = activeCount >= MAX_ATTACHMENTS;

  useEffect(() => {
    if (removeTarget) reasonRef.current?.focus();
  }, [removeTarget]);

  async function startUpload(row: UploadRow) {
    try {
      const created = await uploadAttachment(requesterId, ticketId, row.file);
      setAttachments((current) => [...current, created]);
      setUploads((current) => current.filter((u) => u.key !== row.key));
    } catch (error) {
      // BR-33: a failure is confined to its own row. The ticket and every other
      // attachment are untouched, and the file can be retried from here.
      setUploads((current) =>
        current.map((u) =>
          u.key === row.key
            ? {
                ...u,
                state: "error",
                message: error instanceof ApiError ? error.message : "Upload failed. Please try again.",
              }
            : u,
        ),
      );
    }
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setNotice(null);
    setActionError(null);

    const accepted: UploadRow[] = [];
    let refused: string | null = null;

    for (const file of files) {
      const reasonToRefuse = rejectionReason(file);
      if (reasonToRefuse) {
        refused = `${file.name} — ${reasonToRefuse}`;
        continue;
      }
      if (activeCount + accepted.length >= MAX_ATTACHMENTS) {
        refused = LIMIT_MESSAGE;
        continue;
      }
      accepted.push({ key: `${file.name}-${Date.now()}-${accepted.length}`, file, state: "uploading" });
    }

    if (refused) setNotice(refused);
    if (accepted.length === 0) return;

    setUploads((current) => [...current, ...accepted]);
    setAdding(false);
    accepted.forEach(startUpload);
  }

  function retry(row: UploadRow) {
    setUploads((current) =>
      current.map((u) => (u.key === row.key ? { ...u, state: "uploading", message: undefined } : u)),
    );
    startUpload({ ...row, state: "uploading" });
  }

  async function handleDownload(attachment: AttachmentMeta) {
    setActionError(null);
    try {
      await downloadAttachment(requesterId, attachment);
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "That file could not be downloaded. Please try again.",
      );
    }
  }

  function openRemove(attachment: AttachmentMeta) {
    setRemoveTarget(attachment);
    setReason("");
    setReasonError(null);
  }

  async function confirmRemove() {
    if (!removeTarget) return;

    // BR-31/AC-13: the reason is required and bounded, measured after trimming
    // so spaces cannot stand in for one. The modal stays open on failure and
    // the row is untouched until a valid reason is accepted.
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setReasonError(`Please give a reason between ${REASON_MIN} and ${REASON_MAX} characters.`);
      return;
    }

    setRemoving(true);
    setReasonError(null);
    try {
      const updated = await removeAttachment(requesterId, removeTarget.id, trimmed);
      setAttachments((current) => current.map((a) => (a.id === updated.id ? updated : a)));
      setRemoveTarget(null);
    } catch (error) {
      setReasonError(
        error instanceof ApiError ? error.message : "That attachment could not be removed. Please try again.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section data-testid="attachment-section" className="zg-section">
      <div className="zg-section-header">
        <h2 className="zg-text-lg">Attachments ({activeCount} active)</h2>
        <button
          type="button"
          className="zg-btn--secondary"
          disabled={atLimit}
          title={atLimit ? LIMIT_MESSAGE : "Add an attachment to this ticket"}
          onClick={() => setAdding((open) => !open)}
        >
          + Add Attachment
        </button>
      </div>

      {adding && (
        <div
          data-testid="zg-dropzone"
          className="zg-dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <label htmlFor="add-attachment" className="zg-field-label">
            Add attachments
          </label>
          <input
            id="add-attachment"
            type="file"
            multiple
            accept={ALLOWED_EXTENSIONS.join(",")}
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <p className="zg-text-sm zg-text-muted">
            Drag files here, or choose them above. {ATTACHMENT_HELP}
          </p>
        </div>
      )}

      {notice && (
        <p data-testid="zg-attachment-notice" className="zg-validation-message" role="alert">
          {notice}
        </p>
      )}

      {actionError && (
        <p data-testid="zg-attachment-action-error" className="zg-validation-message" role="alert">
          {actionError}
        </p>
      )}

      {attachments.length === 0 && uploads.length === 0 && (
        <p className="zg-text-sm zg-text-muted">No attachments on this ticket.</p>
      )}

      <ul className="zg-attachment-list">
        {attachments.map((attachment) =>
          attachment.removedAt === null ? (
            <li key={attachment.id} data-testid={`attachment-${attachment.id}`} className="zg-attachment-row--active">
              <span className="zg-attachment-name">{attachment.originalFilename}</span>
              <span className="zg-text-sm zg-text-muted">
                {formatBytes(attachment.sizeBytes)} · Uploaded {formatDateTime(attachment.uploadedAt)}
              </span>
              <span className="zg-attachment-actions">
                {/* Five rows would otherwise give five buttons all named
                    "Download" with nothing to tell them apart. The label names
                    the file and still starts with the visible word, so what is
                    heard matches what is read (BR-39). */}
                <button
                  type="button"
                  className="zg-btn--secondary"
                  title={`Download ${attachment.originalFilename}`}
                  aria-label={`Download ${attachment.originalFilename}`}
                  onClick={() => handleDownload(attachment)}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="zg-btn--destructive"
                  title={`Remove ${attachment.originalFilename}`}
                  aria-label={`Remove ${attachment.originalFilename}`}
                  onClick={() => openRemove(attachment)}
                >
                  &#10005;
                </button>
              </span>
            </li>
          ) : (
            // BR-30: no Download control is rendered at all — not a disabled
            // one. A control that cannot ever work is worse than its absence.
            <li key={attachment.id} data-testid={`attachment-${attachment.id}`} className="zg-attachment-row--removed">
              <span className="zg-attachment-name">{attachment.originalFilename}</span>
              <span className="zg-text-sm">
                {formatBytes(attachment.sizeBytes)} · Uploaded {formatDateTime(attachment.uploadedAt)} ·{" "}
                Removed {formatDateTime(attachment.removedAt)}
              </span>
              <span className="zg-text-sm">Reason: {attachment.removedReason}</span>
            </li>
          ),
        )}

        {uploads.map((row) => (
          <li
            key={row.key}
            data-testid={`upload-${row.key}`}
            className={row.state === "uploading" ? "zg-attachment-row--uploading" : "zg-attachment-row--upload-error"}
          >
            <span className="zg-attachment-name">{row.file.name}</span>
            {row.state === "uploading" ? (
              <span className="zg-text-sm zg-text-muted" role="status">
                Uploading…
              </span>
            ) : (
              <>
                <span className="zg-validation-message" role="alert">
                  {row.message}
                </span>
                <button type="button" className="zg-btn--secondary" onClick={() => retry(row)}>
                  Retry
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {removeTarget && (
        <div className="zg-modal-backdrop">
          <div
            data-testid="remove-modal"
            className="zg-modal--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-modal-title"
          >
            <h3 id="remove-modal-title" className="zg-text-lg">
              Remove {removeTarget.originalFilename}?
            </h3>
            <p className="zg-text-sm zg-text-muted">
              The file will no longer be downloadable. Its name, size and dates stay on the ticket
              along with the reason you give here.
            </p>

            <div className="zg-field">
              <label className="zg-field-label" htmlFor="removal-reason">
                Removal reason <span className="zg-required-marker" aria-hidden="true">*</span>
                <span className="zg-visually-hidden">(required)</span>
              </label>
              <textarea
                id="removal-reason"
                ref={reasonRef}
                className={`zg-field--textarea ${reasonError ? "zg-field--invalid" : "zg-field--editable"}`}
                value={reason}
                disabled={removing}
                aria-invalid={Boolean(reasonError)}
                aria-describedby={reasonError ? "removal-reason-error" : undefined}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (reasonError) setReasonError(null);
                }}
              />
              {reasonError && (
                <span id="removal-reason-error" className="zg-validation-message" role="alert">
                  {reasonError}
                </span>
              )}
            </div>

            <div className="zg-actions-row">
              <button
                type="button"
                className="zg-btn--secondary"
                disabled={removing}
                onClick={() => setRemoveTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={removing ? "zg-btn--destructive zg-btn--busy" : "zg-btn--destructive"}
                // §7.1: the destructive action stays unavailable until the
                // reason could actually be accepted.
                disabled={removing || reason.trim().length < REASON_MIN || reason.trim().length > REASON_MAX}
                aria-busy={removing}
                onClick={confirmRemove}
              >
                {removing ? "Removing…" : "Remove Attachment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
