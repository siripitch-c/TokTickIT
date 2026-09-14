import { KeyboardEvent, ReactNode, RefObject, useEffect, useId, useRef } from "react";

// ui-spec.md §8.2, §9.3 and §9.4 — the `zg-dialog` shell every dialog in the
// application uses: the status confirmation, and the Create and Edit User
// dialogs.
//
// It carries the modal rule Lab 2 set and §12 repeats, once, so no dialog can
// get it partly wrong: focus moves into the dialog, Tab and Shift+Tab cannot
// leave it, Escape dismisses it, and on close focus returns to the control that
// opened it — a keyboard user is put back where they were, not at the top of
// the page.

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  children: ReactNode;
  onDismiss: () => void;
  /** Where focus goes when the dialog closes. */
  returnFocusTo: RefObject<HTMLElement>;
  /** Where focus starts. The first control that can take it, when omitted. */
  initialFocus?: RefObject<HTMLElement>;
  /** §9.3: a dialog that is saving cannot be dismissed. */
  dismissable?: boolean;
  className?: string;
  testId?: string;
  describedBy?: string;
}

export default function Dialog({
  title,
  children,
  onDismiss,
  returnFocusTo,
  initialFocus,
  dismissable = true,
  className,
  testId,
  describedBy,
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const start = initialFocus?.current ?? dialog.current?.querySelector<HTMLElement>(FOCUSABLE);
    start?.focus();
    const opener = returnFocusTo.current;
    // A control that is no longer on the page — a row that left the list after
    // the save — cannot take focus back, and is not asked to.
    return () => {
      if (opener?.isConnected) opener.focus();
    };
    // Once, on opening: focus is placed on arrival and handed back on the way out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (dismissable) onDismiss();
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
        data-testid={testId}
        className={className ? `zg-dialog ${className}` : "zg-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="zg-text-lg">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
