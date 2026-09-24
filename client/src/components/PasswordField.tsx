import { RefObject, useId, useState } from "react";

// Lab 3, Issue #30 — the password input used by Login and Change Password.
//
// It exists as one component because the show/hide toggle carries
// accessibility obligations (ui-spec.md §12: a `title` and an `aria-label`
// that both change with the state), and three copies of that in two screens is
// three chances to get one of them wrong.

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  error?: string | null;
  /** Rendered before any error, so the rule is readable rather than discovered by failing. */
  helper?: string;
  inputRef?: RefObject<HTMLInputElement>;
}

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  error,
  helper,
  inputRef,
}: Props) {
  const [visible, setVisible] = useState(false);
  const helperId = useId();

  const describedBy = [error ? `${id}-error` : null, helper ? helperId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="zg-field">
      <label htmlFor={id} className="zg-field-label">
        {label} <span className="zg-required-marker">*</span>
      </label>

      <div className="zg-password-control">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className={error ? "zg-field--invalid" : "zg-field--editable"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />
        <button
          type="button"
          className="zg-icon-btn"
          // Both attributes change with the state: a toggle whose label still
          // says "Show password" while the password is on screen tells a
          // screen-reader user the opposite of what is happening.
          title={visible ? "Hide password" : "Show password"}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? "🙈" : "👁"}
        </button>
      </div>

      {helper && (
        <p id={helperId} className="zg-text-xs zg-text-muted">
          {helper}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="zg-validation-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
