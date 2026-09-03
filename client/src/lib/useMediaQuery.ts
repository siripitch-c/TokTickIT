import { useEffect, useState } from "react";

// Issue #14 — viewport-driven rendering.
//
// ui-spec.md §6.3 says the desktop table is *replaced entirely* by cards below
// 768px, not merely hidden. Rendering both and toggling with CSS would leave a
// screen reader walking two copies of every ticket, so the choice is made here
// and only one of the two is ever in the DOM.
//
// The subscription is to matchMedia rather than a resize listener: it fires
// once when the breakpoint is crossed instead of on every intermediate pixel.

export const MOBILE_QUERY = "(max-width: 767px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));

  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;

    // Read from the list rather than from the event, so both paths below agree
    // on the answer and neither has to trust the other to have fired.
    const sync = () => setMatches(list.matches);
    sync();

    // `change` is the correct subscription and is all a real window resize
    // needs. `resize` is a belt-and-braces second path for environments that
    // update `matches` without dispatching the media-query event — some
    // viewport-emulation tooling does exactly that, and a stale layout there
    // wastes time during visual checks. `sync` reads from the list rather than
    // an event, so being called from both costs only a state write React
    // discards when the value has not changed.
    //
    // addListener is the deprecated form, kept for older Safari and for test
    // doubles that only implement that half of the interface.
    if (list.addEventListener) {
      list.addEventListener("change", sync);
    } else {
      list.addListener?.(sync);
    }
    window.addEventListener("resize", sync);

    return () => {
      if (list.removeEventListener) {
        list.removeEventListener("change", sync);
      } else {
        list.removeListener?.(sync);
      }
      window.removeEventListener("resize", sync);
    };
  }, [query]);

  return matches;
}

// Environments without matchMedia (jsdom by default, older browsers) report
// "no match", which lands on the desktop layout — the safer default, since it
// shows every column rather than hiding data behind a breakpoint guess.
function read(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}
