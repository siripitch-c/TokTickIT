import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, AuthUser, changePassword } from "../api.js";
import PasswordField from "../components/PasswordField.js";

// ui-spec.md §5 — Change Password Screen. FR-05, FR-06, BR-02, AC-02.
//
// One screen, two ways in. `mandatory` is not inferred from how the user got
// here: it comes from the server's `mustChangePassword` flag, which is also
// what the server's own gate reads (BR-02). The banner and the missing Cancel
// button are feedback; the refusal is the gate.

const MIN_LENGTH = 8;
const MAX_LENGTH = 72;

// ui-spec.md §5 and §10: success is a toast *then* navigation, not silent
// navigation. Long enough to be read, short enough that nobody waits on it —
// and in the mandatory case it is the only confirmation the change worked
// before the application replaces the screen.
const SUCCESS_PAUSE_MS = 1200;

interface Props {
  mandatory: boolean;
  onChanged: (user: AuthUser) => void;
  onCancel?: () => void;
}

export default function ChangePassword({ mandatory, onChanged, onCancel }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  function validate(): Record<string, string | null> {
    const found: Record<string, string | null> = {};
    if (current === "") found.currentPassword = "Please enter your current password.";
    if (next === "") {
      found.newPassword = "Please enter a new password.";
    } else if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) {
      // BR-08. The same bounds the server enforces, checked here only to save
      // a round trip — the server is still the authority.
      found.newPassword = `Password must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters.`;
    } else if (next === current) {
      found.newPassword = "Your new password must be different from your current one."; // BR-09
    }
    if (confirm === "") {
      found.confirmPassword = "Please type the new password again.";
    } else if (confirm !== next) {
      found.confirmPassword = "The two passwords do not match."; // BR-09
    }
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const found = validate();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const updated = await changePassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      });
      setSaved(true);
      timer.current = setTimeout(() => onChanged(updated), SUCCESS_PAUSE_MS);
    } catch (error) {
      // api-spec.md §4 answers a wrong current password with 400 and
      // `field: "currentPassword"`. ui-spec.md §5 requires that to appear
      // under the control, not as a screen-level failure — the session is
      // fine, one typed value is not.
      if (error instanceof ApiError && error.field) {
        setErrors({ [error.field]: error.message });
      } else {
        setFailure(
          error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // No full-page wrapper in either mode: ui-spec.md §5 renders this inside
    // the shell both times, and what separates the two is the banner, the
    // missing Cancel and the absent navigation — not the page frame.
    <div>
      <div className="zg-card zg-auth-card">
        <h1 className="zg-text-xl">Change your password</h1>

        {saved ? (
          <div data-testid="zg-state-success" className="zg-state--success" role="status">
            <p>Your password has been changed.</p>
            {/* The form is gone rather than disabled: there is nothing left to
                correct, and leaving three filled password fields on screen
                after they have been accepted serves no one. */}
          </div>
        ) : (
          <>

        {mandatory && (
          <div data-testid="zg-initial-password-banner" className="zg-callout--info" role="status">
            Your account is using an initial password. Choose a new one to continue.
          </div>
        )}

        {failure && (
          <div data-testid="zg-change-password-error" className="zg-state--error" role="alert">
            {failure}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <PasswordField
            id="currentPassword"
            label="Current Password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            disabled={busy}
            error={errors.currentPassword}
          />
          <PasswordField
            id="newPassword"
            label="New Password"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            disabled={busy}
            error={errors.newPassword}
            helper={`${MIN_LENGTH}–${MAX_LENGTH} characters`}
          />
          <PasswordField
            id="confirmPassword"
            label="Confirm New Password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            disabled={busy}
            error={errors.confirmPassword}
          />

          <div className="zg-actions-row">
            {/* Absent in the mandatory case: there is nothing to go back to. */}
            {!mandatory && onCancel && (
              <button type="button" className="zg-btn--secondary" disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            )}
            <button
              type="submit"
              className={`zg-btn--primary${busy ? " zg-btn--busy" : ""}`}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              {busy ? "Saving…" : "Save New Password"}
            </button>
          </div>
        </form>
          </>
        )}
      </div>
    </div>
  );
}
