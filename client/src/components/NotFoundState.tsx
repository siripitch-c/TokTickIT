import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

// ui-spec.md §2.5 — the not-found state, split out from Lab 2's generic failure
// block because Lab 3 has three different reasons a screen can fail to load, and
// they call for different words (§10).
//
// The wording does not choose between "does not exist" and "is not yours". The
// server already refuses to tell those apart (BR-16); a screen that phrased one
// of them more confidently would undo that. §12: its heading takes focus, so a
// keyboard user who has just followed a link hears what happened.

export default function NotFoundState({ backTo, backLabel }: { backTo: string; backLabel: string }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div data-testid="zg-state-not-found" className="zg-state--not-found">
      <h1 ref={heading} tabIndex={-1}>
        This ticket does not exist, or you do not have access to it.
      </h1>
      <Link className="zg-btn--secondary" to={backTo}>
        Back to {backLabel}
      </Link>
    </div>
  );
}
