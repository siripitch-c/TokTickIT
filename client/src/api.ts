const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface SystemStatus {
  online: boolean;
  categories: Category[];
}

// Issue 2 + Issue 4 — call the backend.
// Steps: fetch `${API_URL}/api/health`; if not ok, throw.
//        then fetch `${API_URL}/api/categories`; if not ok, throw.
//        return { online: true, categories }.
// Throwing on failure lets the UI show a single Offline/error state.
export async function checkSystem(): Promise<SystemStatus> {
  // TODO(Issue 2 & 4): implement the two fetch calls described above.
  throw new Error("checkSystem not implemented yet");
}

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
