import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { Role } from "../api.js";
import { LANDING } from "../lib/landing.js";

// ui-spec.md §2.4 — the forbidden state — and §12, which moves focus to its
// heading so a keyboard user who has just navigated hears the refusal instead
// of nothing.
//
// Rendered for a route guarded for another role and for an API call that
// answered 403: both are the server's decision made visible. It never says what
// is behind the refusal (BR-16, BR-20), and it is never used for a 404, which
// has its own state — wording a 404 as "forbidden" would confirm that the thing
// exists, undoing the server's refusal to say so.

export default function ForbiddenState({ role }: { role: Role }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const landing = LANDING[role];

  return (
    <div data-testid="zg-state-forbidden" className="zg-state--forbidden">
      <span className="zg-state-glyph" aria-hidden="true">
        &#128274;
      </span>
      <h1 ref={heading} tabIndex={-1}>
        You do not have access to this page.
      </h1>
      <Link className="zg-btn--secondary" to={landing.path}>
        Back to {landing.label}
      </Link>
    </div>
  );
}
