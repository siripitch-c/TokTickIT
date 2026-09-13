import { KeyboardEvent, ReactNode, RefObject, useEffect, useId, useRef } from "react";

// ui-spec.md §8.2 and §9.3 — the `zg-dialog` shell, here with the narrow
// `zg-confirm-dialog` modifier and a destructive confirm button. Issue #33's
// Create and Edit User dialogs use the same shell.
//
// It carries the modal rule Lab 2 set and §12 repeats: focus moves into the
// dialog, Tab and Shift+Tab cannot leave it, Escape cancels, and on close focus
// returns to the control that opened it — so a keyboard user is put back where
// they were rather than at the top of the page.

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    // Cancel takes focus first: pressing Enter on a dialog nobody has read yet
    // should be the harmless answer, not the one that closes a Ticket.
    cancel.current?.focus();
    const opener = returnFocusTo.current;
    return () => opener?.focus();
  }, [returnFocusTo]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;

    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="zg-dialog-backdrop">
      <div
        ref={dialog}
        data-testid="confirm-dialog"
        className="zg-dialog zg-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="zg-text-lg">
          {title}
        </h2>
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
      </div>
    </div>
  );
}
