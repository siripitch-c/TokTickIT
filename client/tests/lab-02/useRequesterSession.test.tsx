import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useRequesterSession } from "../../src/lib/useRequesterSession.js";

// tests.md UI-CTX-08, specification.md BR-07.
// The hook is exercised directly rather than through App because the state it
// guards — a response arriving after the Requester has already been changed —
// is not reachable by clicking, and BR-07 is explicit that no stale Requester
// context may become visible.

globalThis.fetch = vi.fn();

function Probe() {
  const session = useRequesterSession();
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <span data-testid="name">{session.requester?.name ?? "-"}</span>
      <button type="button" onClick={session.changeRequester}>
        change requester
      </button>
    </div>
  );
}

describe("useRequesterSession (UI-CTX-08, BR-07)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
  });

  it("ignores a response that arrives after the Requester has been changed", async () => {
    let resolveRequesters: (value: unknown) => void = () => {};
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveRequesters = resolve;
      }),
    );
    sessionStorage.setItem("toktickit.selectedRequesterId", "1");

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("checking"));

    // The Requester gives up on the pending load and asks to change identity.
    screen.getByRole("button", { name: /change requester/i }).click();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("needs-selection"));

    // The in-flight lookup now completes. Applying it would drop the previous
    // Requester's context back on screen, which BR-07 forbids.
    resolveRequesters({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 1, name: "Jennifer Anderson" }] }),
    });

    await Promise.resolve();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("needs-selection"));
    expect(screen.getByTestId("name")).toHaveTextContent("-");
    expect(sessionStorage.getItem("toktickit.selectedRequesterId")).toBeNull();
  });

  it("still applies the response of the most recent lookup", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 2, name: "Michael Brown" }] }),
    });
    sessionStorage.setItem("toktickit.selectedRequesterId", "2");

    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("name")).toHaveTextContent("Michael Brown");
  });
});
