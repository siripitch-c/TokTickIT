import { FormEvent, useEffect, useId, useState } from "react";
import { ApiError, ThreadEntry, ThreadKind, fetchThread, postToThread } from "../api.js";
import { formatDateTime } from "../lib/attachmentRules.js";
import { RoleBadge } from "./Badge.js";

// ui-spec.md §2.7 (`zg-thread`) and §2.8 (`zg-thread--internal`).
// specification.md FR-19, FR-20, BR-04, BR-20..BR-24, AC-14, AC-15.
//
// One component for both threads, because their shape is the same (BR-22) —
// and deliberately not one *appearance*. §2.8 calls the internal panel's design
// a safety control: a person must never post privately-meant text into the
// public thread by mistake. So the two differ in five independent ways —
// border, fill, heading, placeholder and button label — and never only in
// colour, which would fail exactly the people most likely to make the mistake.

const MAX = 2000;

const COPY: Record<
  ThreadKind,
  { heading: string; empty: string; placeholder: string; label: string; submit: string; busy: string; failure: string }
> = {
  comments: {
    heading: "Public Comments",
    empty: "No comments yet.",
    placeholder: "Write a comment. The Requester and IT Staff can both read it.",
    label: "Add a public comment",
    submit: "Post Comment",
    busy: "Posting…",
    failure: "We couldn't load the comments.",
  },
  notes: {
    heading: "Internal Notes — not visible to the Requester",
    empty: "No internal notes yet.",
    placeholder: "Internal note — the Requester cannot see this.",
    label: "Add an internal note",
    submit: "Add Internal Note",
    busy: "Adding…",
    failure: "We couldn't load the internal notes.",
  },
};

type LoadState = "loading" | "ready" | "error";

interface Props {
  ticketId: number;
  kind: ThreadKind;
  /** Told about each entry once the server has accepted it. */
  onPosted?: (entry: ThreadEntry) => void;
}

export default function Thread({ ticketId, kind, onPosted }: Props) {
  const copy = COPY[kind];
  const internal = kind === "notes";
  const headingId = useId();
  const inputId = useId();
  const counterId = useId();

  const [state, setState] = useState<LoadState>("loading");
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setState("loading");
    fetchThread(ticketId, kind)
      .then((loaded) => {
        if (!current) return;
        setEntries(loaded);
        setState("ready");
      })
      .catch(() => {
        if (current) setState("error");
      });
    return () => {
      current = false;
    };
  }, [ticketId, kind, attempt]);

  // BR-23 is measured after trimming, so the counter and the button agree:
  // spaces alone neither count toward the limit nor make a body.
  const length = text.trim().length;
  const overLimit = length > MAX;
  const canSubmit = length >= 1 && !overLimit && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      const created = await postToThread(ticketId, kind, text);
      // §2.7: the new entry appears at the bottom and the textarea clears.
      setEntries((current) => [...current, created]);
      setState("ready");
      setText("");
      onPosted?.(created);
    } catch (failure) {
      // What was typed is kept, so a failed post costs nothing to retry.
      setError(failure instanceof ApiError ? failure.message : "That could not be posted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid={internal ? "internal-notes" : "public-comments"}
      className={internal ? "zg-thread-panel zg-thread--internal" : "zg-thread-panel"}
      aria-labelledby={headingId}
    >
      {/* A real heading, before its composer, so a screen-reader user meets
          "not visible to the Requester" before they can type (§12, A11Y-04). */}
      <h2 id={headingId} className="zg-text-lg zg-thread-heading">
        {internal && <span aria-hidden="true">&#128274; </span>}
        {copy.heading}
      </h2>

      {state === "loading" && (
        <p className="zg-state--loading" role="status">
          Loading…
        </p>
      )}

      {state === "error" && (
        <div className="zg-state--error" role="alert">
          <p>{copy.failure}</p>
          <button type="button" className="zg-btn--secondary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {state === "ready" && entries.length === 0 && (
        <p data-testid={`${kind}-empty`} className="zg-state--empty">
          {copy.empty}
        </p>
      )}

      {/* An ordered list, so the count and each entry's position are announced
          (§12, A11Y-09). Oldest first: a conversation reads downwards. */}
      {state === "ready" && entries.length > 0 && (
        <ol className="zg-thread">
          {entries.map((entry) => (
            <li key={entry.id} className="zg-thread-entry">
              <div className="zg-thread-entry-header">
                <span className="zg-thread-author">{entry.author.name}</span>
                <RoleBadge role={entry.author.role} />
                <time className="zg-text-sm zg-text-muted" dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                  {relativeTime(entry.createdAt)}
                </time>
              </div>
              {/* BR-24: plain text. React escapes it, and nothing here is ever
                  handed to innerHTML, so markup in a body is shown, not run. */}
              <p className="zg-thread-body">{entry.body}</p>
            </li>
          ))}
        </ol>
      )}

      <form className="zg-thread-composer" onSubmit={submit}>
        <label htmlFor={inputId} className="zg-visually-hidden">
          {copy.label}
        </label>
        <textarea
          id={inputId}
          className="zg-field--editable zg-thread-input"
          placeholder={copy.placeholder}
          value={text}
          disabled={busy}
          aria-describedby={counterId}
          aria-invalid={overLimit || undefined}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="zg-thread-composer-footer">
          <span
            id={counterId}
            data-testid={`${kind}-counter`}
            className={overLimit ? "zg-char-counter zg-char-counter--over" : "zg-char-counter zg-text-sm zg-text-muted"}
          >
            {length} / {MAX}
          </span>
          <button
            type="submit"
            className={busy ? "zg-btn--primary zg-btn--busy" : "zg-btn--primary"}
            disabled={!canSubmit}
            aria-busy={busy || undefined}
          >
            {busy ? copy.busy : copy.submit}
          </button>
        </div>
        {error && (
          <p className="zg-validation-message" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/** §2.7: a relative time on the entry, with the absolute one in its `title`. */
function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDateTime(iso);
}
