import { FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, AuthUser, login } from "../api.js";
import PasswordField from "../components/PasswordField.js";

// ui-spec.md §4 — Login Screen. FR-01, AC-01, AC-05.

interface Props {
  /** Called with the signed-in user so the app can adopt it without a refetch. */
  onSignedIn: (user: AuthUser) => void;
}

export default function Login({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);

  // ui-spec.md §4.2: focus returns to the password field after a failure.
  //
  // It cannot be done in the catch block: the field is `disabled` while the
  // request is in flight, and focusing a disabled input does nothing. This
  // waits for the render that re-enables it, which is what an effect is for.
  useEffect(() => {
    if (failure && !busy) passwordRef.current?.focus();
  }, [failure, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    // Client-side validation only decides whether to send the request. The
    // server validates again regardless (BR-19, FR-08); this exists so an
    // empty form does not cost a round trip.
    const missingEmail = email.trim() === "" ? "Please enter your email address." : null;
    const missingPassword = password === "" ? "Please enter your password." : null;
    setEmailError(missingEmail);
    setPasswordError(missingPassword);
    setFailure(null);
    if (missingEmail || missingPassword) return;

    setBusy(true);
    try {
      onSignedIn(await login(email, password));
    } catch (error) {
      // BR-06, AC-05: one message for a wrong password, an unknown address and
      // a deactivated account alike. The server refuses to distinguish them,
      // and softening any one of the three here would put the distinction
      // straight back. The message is the server's own, not a local string, so
      // the two cannot drift apart.
      setFailure(
        error instanceof ApiError
          ? error.message
          : "Something went wrong. Please try again.",
      );
      // The password is deliberately not cleared (ui-spec.md §4.2): retyping a
      // long password because of a typo in the email address is a punishment
      // for the wrong mistake.
      //
      // Focus is restored by the effect above, once the re-render has
      // re-enabled the field.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="zg-auth-screen">
      <div className="zg-auth-brand">
        <span className="zg-auth-glyph" aria-hidden="true">
          ⏱
        </span>
        <span className="zg-auth-wordmark">TokTickIT</span>
      </div>

      <div className="zg-card zg-auth-card">
        <h1 className="zg-text-xl">Sign in to TokTickIT</h1>
        <p className="zg-text-sm zg-text-muted">Use the account your administrator created for you.</p>

        {failure && (
          <div data-testid="zg-login-error" className="zg-state--error" role="alert">
            {failure}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="zg-field">
            <label htmlFor="email" className="zg-field-label">
              Email <span className="zg-required-marker">*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              className={emailError ? "zg-field--invalid" : "zg-field--editable"}
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
            />
            {emailError && (
              <p id="email-error" className="zg-validation-message" role="alert">
                {emailError}
              </p>
            )}
          </div>

          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            disabled={busy}
            error={passwordError}
            inputRef={passwordRef}
          />

          <button
            type="submit"
            className={`zg-btn--primary zg-btn--block${busy ? " zg-btn--busy" : ""}`}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
