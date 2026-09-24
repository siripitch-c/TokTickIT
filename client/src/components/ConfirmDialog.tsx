import { ReactNode, RefObject, useId, useRef } from "react";
import Dialog from "./Dialog.js";

// ui-spec.md §8.2 — the confirmation before Closed or Cancelled: the shared
// `zg-dialog` shell (Dialog.tsx) with the narrow `zg-confirm-dialog` modifier and
// a destructive confirm button. The shell carries the focus rules; this carries
// the words and the two answers.

interface Props {
  title: string;
  /** The consequence, in words (§8.2). */
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Where focus goes when the dialog closes. */
  returnFocusTo: RefObject<HTMLElement>;
}

export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
  returnFocusTo,
}: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

  return (
    <Dialog
      title={title}
      onDismiss={onCancel}
      returnFocusTo={returnFocusTo}
      // Cancel takes focus first: pressing Enter on a dialog nobody has read yet
      // should be the harmless answer, not the one that closes a Ticket.
      initialFocus={cancel}
      dismissable={!busy}
      className="zg-confirm-dialog"
      testId="confirm-dialog"
      describedBy={bodyId}
    >
      <p id={bodyId}>{children}</p>
      <div className="zg-actions-row">
        <button ref={cancel} type="button" className="zg-btn--secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={busy ? "zg-btn--destructive zg-btn--busy" : "zg-btn--destructive"}
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
