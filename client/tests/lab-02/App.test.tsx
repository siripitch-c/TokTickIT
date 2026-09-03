import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../../src/App.js";

// tests.md UI-CTX-03/04, BR-06/BR-07. These live at the App level (not in
// RequesterSelection.test.tsx) because persistence-across-remount and the
// Change Requester action are app-shell behavior, not something the
// Selection screen can exercise on its own — see App.tsx's restoreSession()
// and handleChangeRequester().

globalThis.fetch = vi.fn();

const REQUESTERS = [
  { id: 1, name: "Jennifer Anderson" },
  { id: 2, name: "Michael Brown" },
];

function mockRequestersOk() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ data: REQUESTERS }),
  });
}

// The guard added with Issue #13 sends any Requester-scoped route back to the
// selector, so these tests need the reference-data calls that Create Ticket
// makes once the guard lets it through.
function mockAllEndpoints() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = url.includes("/api/requesters")
      ? REQUESTERS
      : [{ id: 1, name: "Hardware" }];
    return { ok: true, status: 200, json: async () => ({ data }) } as unknown as Response;
  });
}

describe("App — Development Requester context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    window.history.pushState({}, "", "/");
  });

  it("UI-CTX-03: with no prior selection, shows RequesterSelection", async () => {
    mockRequestersOk();
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Select Development Requester/i)).toBeInTheDocument()
    );
  });

  it("UI-CTX-03: a selection persists across remount (BR-06) without re-prompting", async () => {
    mockRequestersOk();
    sessionStorage.setItem("toktickit.selectedRequesterId", "2");

    render(<App />);

    // Restores straight into the ready shell — no selector shown.
    await waitFor(() =>
      expect(screen.getByTestId("current-requester-name")).toHaveTextContent(
        "Michael Brown"
      )
    );
    expect(screen.queryByText(/Select Development Requester/i)).not.toBeInTheDocument();

    // Simulate "navigating away and back" (e.g. a reload within the same
    // tab session) by unmounting and rendering a fresh App instance against
    // the same sessionStorage.
    const { unmount } = render(<App />);
    unmount();
    render(<App />);

    await waitFor(() =>
      expect(screen.getAllByTestId("current-requester-name")[0]).toHaveTextContent(
        "Michael Brown"
      )
    );
  });

  it("UI-CTX-03: a stale/now-inactive stored id falls back to the selector instead of a broken shell", async () => {
    mockRequestersOk(); // active list no longer contains id 99
    sessionStorage.setItem("toktickit.selectedRequesterId", "99");

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Select Development Requester/i)).toBeInTheDocument()
    );
    // The stale id must not be left behind for a future visit.
    expect(sessionStorage.getItem("toktickit.selectedRequesterId")).toBeNull();
  });

  it("UI-CTX-04: selecting a Requester moves from the selector into the ready shell", async () => {
    mockRequestersOk();
    render(<App />);

    await waitFor(() => screen.getByLabelText(/Development Requester/i));
    fireEvent.change(screen.getByLabelText(/Development Requester/i), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByTestId("current-requester-name")).toHaveTextContent(
        "Jennifer Anderson"
      )
    );
  });

  it("AC-02: opening a Requester-scoped route with nothing selected shows the selector instead", async () => {
    mockAllEndpoints();
    window.history.pushState({}, "", "/tickets/new");

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Select Development Requester/i)).toBeInTheDocument()
    );
    // The guarded screen must not render at all, not even briefly behind the
    // selector — the redirect happens before it mounts.
    expect(screen.queryByText(/^Create Ticket$/)).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/select-requester");
  });

  it("AC-02: after choosing a Requester the originally-requested route is restored", async () => {
    mockAllEndpoints();
    window.history.pushState({}, "", "/tickets/new");

    render(<App />);

    await waitFor(() => screen.getByLabelText(/Development Requester/i));
    fireEvent.change(screen.getByLabelText(/Development Requester/i), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // Back to where the Requester was heading, not to the default route.
    await waitFor(() => expect(window.location.pathname).toBe("/tickets/new"));
    expect(screen.getByTestId("current-requester-name")).toHaveTextContent("Jennifer Anderson");
  });

  it("UI-CTX-09: the mobile navigation toggle names what it will do, in both states (BR-39)", async () => {
    mockAllEndpoints();
    sessionStorage.setItem("toktickit.selectedRequesterId", "1");
    render(<App />);

    await waitFor(() => expect(screen.getByTestId("current-requester-name")).toBeInTheDocument());

    const toggle = screen.getByRole("button", { name: /open navigation menu/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Icon-only, so the tooltip has to carry the same words as the label.
    expect(toggle).toHaveAttribute("title", "Open navigation menu");

    fireEvent.click(toggle);

    const openToggle = screen.getByRole("button", { name: /close navigation menu/i });
    expect(openToggle).toHaveAttribute("aria-expanded", "true");
    expect(openToggle).toHaveAttribute("title", "Close navigation menu");
    // The panel it controls carries the same actions as the desktop header.
    const panel = document.getElementById("zg-mobile-nav");
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("My Tickets");
    expect(panel!.textContent).toContain("Create Ticket");
    expect(panel!.textContent).toContain("Jennifer Anderson");
  });

  it("UI-CTX-04: Change Requester clears the stored selection and returns to the selector, no stale data", async () => {
    mockRequestersOk();
    sessionStorage.setItem("toktickit.selectedRequesterId", "1");
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("current-requester-name")).toHaveTextContent(
        "Jennifer Anderson"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));

    // Back to the selector — no leftover name/context from the previous
    // Requester rendered anywhere on screen.
    await waitFor(() =>
      expect(screen.getByText(/Select Development Requester/i)).toBeInTheDocument()
    );
    expect(screen.queryByTestId("current-requester-name")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("toktickit.selectedRequesterId")).toBeNull();

    // A fresh selection re-fetches rather than reusing anything cached.
    fireEvent.change(screen.getByLabelText(/Development Requester/i), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(screen.getByTestId("current-requester-name")).toHaveTextContent(
        "Michael Brown"
      )
    );
  });
});
