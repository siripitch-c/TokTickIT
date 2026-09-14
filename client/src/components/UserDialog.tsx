import { FormEvent, RefObject, useState } from "react";
import { AdminUser, ApiError, Role, createUser, setInitialPassword, updateUser } from "../api.js";
import Dialog from "./Dialog.js";
import PasswordField from "./PasswordField.js";

// ui-spec.md §9.3 (Create User) and §9.4 (Edit User). FR-24..FR-26, BR-18,
// BR-35..BR-38, AC-17..AC-20, AC-22, AC-23.
//
// One dialog in two modes. The rules below mirror the server's so a mistake is
// shown before a round trip, but the server is the authority: every refusal it
// sends back lands on the control it names, and the guard rails of §9.4 revert
// that control to the value it had.

const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 200;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "REQUESTER", label: "Requester" },
  { value: "IT_STAFF", label: "IT Staff" },
  { value: "ADMINISTRATOR", label: "Administrator" },
];

const PASSWORD_HELP = `${PASSWORD_MIN}–${PASSWORD_MAX} characters. The user must change it at first sign-in.`;
const PASSWORD_RULE = `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`;
// §9.4: the reason, shown before the refusal can happen (BR-37).
const SELF_RULE = "You cannot change your own role or status. Another administrator can.";
const GENERIC_FAILURE = "Something went wrong. Please try again.";

type Field = "name" | "email" | "role" | "isActive" | "initialPassword";
type Status = "active" | "inactive" | "";

interface Props {
  /** The account to edit, or null to create one. */
  user: AdminUser | null;
  /** The signed-in Administrator, for the rules about one's own account. */
  currentUserId: number;
  returnFocusTo: RefObject<HTMLElement>;
  onClose: () => void;
  onSaved: (user: AdminUser, created: boolean) => void;
  /** The signed-in Administrator's own account changed in a way the session must know about. */
  onOwnAccountChanged?: (user: AdminUser) => void;
}

const validPassword = (value: string) =>
  value.trim() !== "" && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;

export default function UserDialog({ user, currentUserId, returnFocusTo, onClose, onSaved, onOwnAccountChanged }: Props) {
  const editing = user !== null;
  const isSelf = editing && user.id === currentUserId;

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role | "">(user?.role ?? "");
  // Creating starts with neither choice made: an active or inactive account is
  // a decision, not a default (api-spec.md §9).
  const [status, setStatus] = useState<Status>(user ? (user.isActive ? "active" : "inactive") : "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // §9.4 — Set New Initial Password: its own field, its own button, its own endpoint.
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);

  // §9.3: while either request is in flight the dialog cannot be closed — not by
  // Escape, not by Cancel, and not by a save that would close it — so a
  // confirmation is never lost to the dialog going away underneath it.
  const pending = busy || passwordBusy;

  function validate(): Partial<Record<Field, string>> {
    const found: Partial<Record<Field, string>> = {};
    const trimmedName = name.trim();
    if (trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX) {
      found.name = `Name must be between ${NAME_MIN} and ${NAME_MAX} characters.`;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail === "") {
      found.email = "Enter an email address.";
    } else if (trimmedEmail.length > EMAIL_MAX || !EMAIL_SHAPE.test(trimmedEmail)) {
      found.email = "Enter a valid email address.";
    }
    if (role === "") found.role = "Choose a role.";
    if (status === "") found.isActive = "Choose whether the account is active.";
    if (!editing && !validPassword(password)) found.initialPassword = PASSWORD_RULE;
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const found = validate();
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const fields = { name: name.trim(), email: email.trim(), role: role as Role, isActive: status === "active" };
    try {
      const saved = editing
        ? await updateUser(user.id, fields)
        : await createUser({ ...fields, initialPassword: password });
      // The parent closes the dialog; nothing here runs after that.
      onSaved(saved, !editing);
    } catch (error) {
      if (error instanceof ApiError && error.field) {
        // A refusal the server tied to a field is shown on that field — the
        // duplicate address on Email (AC-17), the guard rails on the control
        // that tripped them — and every other value is kept (§2.6).
        setErrors({ [error.field]: error.message });
        // §2.6 and §9.4: in the Edit dialog every conflict returns its control to
        // the value it had — the duplicate address as well as the two guard
        // rails. Creating keeps what was typed instead (§9.3, AC-17).
        if (editing && error.status === 409) {
          if (error.field === "email") setEmail(user.email);
          if (error.field === "role") setRole(user.role);
          if (error.field === "isActive") setStatus(user.isActive ? "active" : "inactive");
        }
      } else {
        setFailure(error instanceof ApiError ? error.message : GENERIC_FAILURE);
      }
      setBusy(false);
    }
  }

  async function submitNewPassword() {
    if (!user || pending) return;
    setPasswordSet(false);
    if (!validPassword(newPassword)) {
      setNewPasswordError(PASSWORD_RULE);
      return;
    }

    setPasswordBusy(true);
    setNewPasswordError(null);
    try {
      const updated = await setInitialPassword(user.id, newPassword);
      // Never shown again (BR-07, AC-18). The field is emptied and only the
      // consequence is confirmed.
      setNewPassword("");
      setPasswordSet(true);
      if (isSelf) {
        // On one's own account the server keeps this session but now requires a
        // new password (api-spec.md §9). Handing the account up moves the
        // application straight to Change Password, where its next request would
        // have sent it anyway.
        onOwnAccountChanged?.(updated);
      }
    } catch (error) {
      setNewPasswordError(error instanceof ApiError ? error.message : GENERIC_FAILURE);
    } finally {
      setPasswordBusy(false);
    }
  }

  const describedBySelf = isSelf ? "user-self-rule" : undefined;
  const describe = (field: Field, id: string) =>
    [errors[field] ? `${id}-error` : null, describedBySelf].filter(Boolean).join(" ") || undefined;

  return (
    <Dialog
      title={editing ? `Edit ${user.name}` : "Create User"}
      onDismiss={onClose}
      returnFocusTo={returnFocusTo}
      dismissable={!pending}
      testId="user-dialog"
    >
      {failure && (
        <div data-testid="zg-user-dialog-error" className="zg-callout--error" role="alert">
          {failure}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <TextField id="user-name" label="Name" value={name} onChange={setName} error={errors.name} disabled={busy} />
        <TextField
          id="user-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          disabled={busy}
        />

        <div className="zg-field">
          <label htmlFor="user-role" className="zg-field-label">
            Role <span className="zg-required-marker">*</span>
          </label>
          <select
            id="user-role"
            className={isSelf ? "zg-field--disabled" : errors.role ? "zg-field--invalid" : "zg-field--editable"}
            value={role}
            disabled={busy || isSelf}
            onChange={(e) => setRole(e.target.value as Role | "")}
            aria-invalid={errors.role ? true : undefined}
            aria-describedby={describe("role", "user-role")}
          >
            {/* BR-18: exactly one — a single select, never a checkbox list. */}
            {!editing && <option value="">Choose a role</option>}
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.role && (
            <p id="user-role-error" className="zg-validation-message" role="alert">
              {errors.role}
            </p>
          )}
        </div>

        <fieldset
          className={isSelf ? "zg-field zg-radio-group zg-radio-group--disabled" : "zg-field zg-radio-group"}
          aria-describedby={describe("isActive", "user-status")}
        >
          <legend className="zg-field-label">
            Status <span className="zg-required-marker">*</span>
          </legend>
          {(["active", "inactive"] as const).map((value) => (
            <label key={value} className="zg-radio">
              <input
                type="radio"
                name="user-status"
                value={value}
                checked={status === value}
                disabled={busy || isSelf}
                onChange={() => setStatus(value)}
              />
              {value === "active" ? "Active" : "Inactive"}
            </label>
          ))}
          {errors.isActive && (
            <p id="user-status-error" className="zg-validation-message" role="alert">
              {errors.isActive}
            </p>
          )}
        </fieldset>

        {isSelf && (
          <p id="user-self-rule" className="zg-text-xs zg-text-muted">
            {SELF_RULE}
          </p>
        )}

        {!editing && (
          <PasswordField
            id="user-initial-password"
            label="Initial Password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            disabled={busy}
            error={errors.initialPassword ?? null}
            helper={PASSWORD_HELP}
          />
        )}

        <div className="zg-actions-row">
          <button type="button" className="zg-btn--secondary" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={busy ? "zg-btn--primary zg-btn--busy" : "zg-btn--primary"}
            disabled={pending}
            aria-busy={busy || undefined}
          >
            {busy ? "Saving…" : editing ? "Save Changes" : "Create User"}
          </button>
        </div>
      </form>

      {editing && (
        // Outside the form on purpose: pressing Enter in the details above must
        // never reset a password, and renaming someone must never change one.
        <section className="zg-dialog-section" aria-labelledby="set-password-heading">
          <h3 id="set-password-heading">Set New Initial Password</h3>
          <PasswordField
            id="user-new-initial-password"
            label="New Initial Password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(value) => {
              setNewPassword(value);
              setPasswordSet(false);
            }}
            disabled={passwordBusy}
            error={newPasswordError}
            helper={PASSWORD_HELP}
          />
          {passwordSet && (
            <p data-testid="initial-password-set" className="zg-text-sm" role="status">
              This account must choose a new password at its next sign-in.
            </p>
          )}
          <div className="zg-actions-row">
            <button
              type="button"
              className={passwordBusy ? "zg-btn--secondary zg-btn--busy" : "zg-btn--secondary"}
              disabled={pending}
              aria-busy={passwordBusy || undefined}
              onClick={submitNewPassword}
            >
              {passwordBusy ? "Setting…" : "Set Password"}
            </button>
          </div>
        </section>
      )}
    </Dialog>
  );
}

function TextField({
  id,
  label,
  type = "text",
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  type?: "text" | "email";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled: boolean;
}) {
  return (
    <div className="zg-field">
      <label htmlFor={id} className="zg-field-label">
        {label} <span className="zg-required-marker">*</span>
      </label>
      <input
        id={id}
        type={type}
        autoComplete="off"
        className={error ? "zg-field--invalid" : "zg-field--editable"}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p id={`${id}-error`} className="zg-validation-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
