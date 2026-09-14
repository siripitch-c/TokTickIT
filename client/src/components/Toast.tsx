import { useEffect, useRef } from "react";

// ui-spec.md §9.3 and §10 — the `zg-state--success` toast User Management shows
// after a save. It is a status message, announced without taking focus, so a
// keyboard user who has just been returned to the list stays where they are.

const TOAST_MS = 4000;

export default function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  // The latest callback, so a parent re-rendering does not restart the timer.
  const done = useRef(onDone);
  done.current = onDone;

  // Timed from when it appears. A new toast is a new element (the parent keys
  // each one), so it gets its full time even when its words repeat.
  useEffect(() => {
    const timer = setTimeout(() => done.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div data-testid="zg-toast" className="zg-state--success zg-toast" role="status">
      {message}
    </div>
  );
}
