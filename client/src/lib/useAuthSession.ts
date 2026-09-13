import { useCallback, useEffect, useRef, useState } from "react";
import { AuthUser, fetchCurrentUser } from "../api.js";

// Lab 3, Issue #30 — the signed-in user, replacing useRequesterSession.
//
// The Lab 2 hook resumed an id from sessionStorage and asked the server
// whether it still named an active Requester. This one stores nothing: the
// session lives in an httpOnly cookie the client cannot read, so the only way
// to know who is signed in is to ask (BR-03, BR-13). That is the point — a
// value the client keeps is a value the client can change.

export type AuthSession =
  | { status: "checking"; user: null }
  | { status: "signed-out"; user: null }
  | { status: "must-change-password"; user: AuthUser }
  | { status: "ready"; user: AuthUser }
  // BR-13 draws the line between "nobody is signed in" and "the server did not
  // answer". Collapsing them would send a signed-in user to Login every time
  // the API hiccupped, losing whatever they were doing.
  | { status: "unavailable"; user: null };

export type UseAuthSession = AuthSession & {
  /** Re-asks the server, e.g. after a password change alters the flag. */
  refresh: () => void;
  /** Adopts the user a sign-in just returned, without a second round trip. */
  adopt: (user: AuthUser) => void;
  /** Drops the local user. The cookie is destroyed by the logout endpoint. */
  clear: () => void;
};

function classify(user: AuthUser | null): AuthSession {
  if (!user) return { status: "signed-out", user: null };
  // AC-02: the flag decides the destination, and it is the server's flag —
  // the client never infers it from how the user arrived.
  return user.mustChangePassword
    ? { status: "must-change-password", user }
    : { status: "ready", user };
}

export function useAuthSession(): UseAuthSession {
  const [session, setSession] = useState<AuthSession>({ status: "checking", user: null });

  // Carried over from the Lab 2 hook: every lookup is tokenised, so a slow
  // response that arrives after the user has signed out cannot put them back
  // on screen.
  const lookup = useRef(0);

  const refresh = useCallback(() => {
    const token = ++lookup.current;
    setSession({ status: "checking", user: null });

    fetchCurrentUser()
      .then((user) => {
        if (token !== lookup.current) return;
        setSession(classify(user));
      })
      .catch(() => {
        if (token !== lookup.current) return;
        setSession({ status: "unavailable", user: null });
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const adopt = useCallback((user: AuthUser) => {
    lookup.current++; // any lookup still in flight is now stale
    setSession(classify(user));
  }, []);

  const clear = useCallback(() => {
    lookup.current++;
    setSession({ status: "signed-out", user: null });
  }, []);

  return { ...session, refresh, adopt, clear } as UseAuthSession;
}
