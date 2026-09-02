const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Issue #12 — Data model foundation & Requester context
// ---------------------------------------------------------------------------
export interface Requester {
  id: number;
  name: string;
}

// api-spec.md §3: GET /api/requesters -> { data: [...] }, active only, no
// requester context header required. Throws on any non-2xx response so the
// caller can show BR-08's safe error state.
export async function fetchRequesters(): Promise<Requester[]> {
  const res = await fetch(`${API_URL}/api/requesters`);
  if (!res.ok) {
    throw new Error("Failed to load Development Requesters");
  }
  const body = await res.json();
  return body.data as Requester[];
}
