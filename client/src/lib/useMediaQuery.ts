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

    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // addListener is the deprecated form, kept for older Safari and for test
    // doubles that only implement that half of the interface.
    if (list.addEventListener) {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    }
    list.addListener?.(onChange);
    return () => list.removeListener?.(onChange);
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
