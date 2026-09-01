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

describe("App — Development Requester context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
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
