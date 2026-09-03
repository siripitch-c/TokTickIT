import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRequesters, Requester } from "../api.js";
import {
  clearSelectedRequesterId,
  getSelectedRequesterId,
} from "./requesterContext.js";

// Issue #13 — the current Development Requester, lifted out of App.tsx so the
// app shell, the route guard, and every Requester-scoped screen read the same
// value (BR-06/BR-07). Introduced by Issue #12 as inline App state; extracted
// here once routing arrived and more than one screen needed it.

export type RequesterSession =
  | { status: "checking"; requester: null }
  | { status: "needs-selection"; requester: null }
  | { status: "ready"; requester: Requester };

// Intersected with the union (rather than declared as an interface) so that
// narrowing on `status` still narrows `requester` to a non-null Requester.
export type UseRequesterSession = RequesterSession & {
  /** Re-resolves the stored id, e.g. right after the selector writes one. */
  refresh: () => void;
  /** BR-07: drops the stored selection so no stale context stays visible. */
  changeRequester: () => void;
};

export function useRequesterSession(): UseRequesterSession {
  const [session, setSession] = useState<RequesterSession>({
    status: "checking",
    requester: null,
  });

  // Every lookup carries a token. A response whose token is no longer the
  // current one is discarded, because by the time it arrived the Requester had
  // already moved on — applying it would put the previous Requester's context
  // back on screen, which BR-07 forbids (tests.md UI-CTX-08).
  const lookup = useRef(0);

  // BR-06: resume the previously-selected Requester from sessionStorage. The
  // active list is re-fetched rather than trusting a cached name, so a
  // Requester who has since been deactivated is caught here and sent back to
  // the selector instead of being shown as a stale "ready" shell.
  const refresh = useCallback(() => {
    const token = ++lookup.current;
    const id = getSelectedRequesterId();
    if (id === null) {
      setSession({ status: "needs-selection", requester: null });
      return;
    }

    setSession({ status: "checking", requester: null });
    fetchRequesters()
      .then((requesters) => {
        if (token !== lookup.current) return;
        const match = requesters.find((r) => r.id === id);
        if (match) {
          setSession({ status: "ready", requester: match });
        } else {
          clearSelectedRequesterId();
          setSession({ status: "needs-selection", requester: null });
        }
      })
      .catch(() => {
        if (token !== lookup.current) return;
        // Safe fallback: without confirmation we do not render a shell we
        // cannot back up. Selecting again is always possible.
        clearSelectedRequesterId();
        setSession({ status: "needs-selection", requester: null });
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const changeRequester = useCallback(() => {
    lookup.current++; // any lookup still in flight is now stale
    clearSelectedRequesterId();
    setSession({ status: "needs-selection", requester: null });
  }, []);

  return { ...session, refresh, changeRequester } as UseRequesterSession;
}
