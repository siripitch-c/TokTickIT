import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import RequesterSelection from "../../src/components/RequesterSelection.js";

globalThis.fetch = vi.fn();

function mockRequesters(data: { id: number; name: string }[]) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ data }),
  });
}

function mockFailure() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
}

describe("RequesterSelection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
  });

  it("UI-CTX-01: initial render shows the testing-only notice, dropdown, and disabled Continue", async () => {
    mockRequesters([{ id: 1, name: "Jennifer Anderson" }]);
    render(<RequesterSelection onContinue={vi.fn()} />);

    expect(
      screen.getByText(/this is for testing only and is not a login screen/i)
    ).toBeInTheDocument();

    await waitFor(() => expect(screen.getByLabelText(/Development Requester/i)).toBeInTheDocument());

    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toBeDisabled();
  });

  it("UI-CTX-02: shows the loading state before requesters resolve", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves
    render(<RequesterSelection onContinue={vi.fn()} />);
    expect(screen.getByTestId("zg-state-loading")).toBeInTheDocument();
  });

  it("UI-CTX-02: shows the empty state per BR-09 when zero active Requesters exist", async () => {
    mockRequesters([]);
    render(<RequesterSelection onContinue={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("zg-state-empty")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("UI-CTX-02: shows the error state with Retry per BR-08 when the API call fails", async () => {
    mockFailure();
    render(<RequesterSelection onContinue={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("zg-state-error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("selecting a Requester and pressing Continue calls onContinue with that id", async () => {
    mockRequesters([
      { id: 1, name: "Jennifer Anderson" },
      { id: 2, name: "Michael Brown" },
    ]);
    const onContinue = vi.fn();
    render(<RequesterSelection onContinue={onContinue} />);

    await waitFor(() => screen.getByLabelText(/Development Requester/i));
    fireEvent.change(screen.getByLabelText(/Development Requester/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onContinue).toHaveBeenCalledWith(2);
    expect(sessionStorage.getItem("toktickit.selectedRequesterId")).toBe("2");
  });

  it("UI-CTX-05: Retry button has an accessible name (icon-only controls elsewhere must too, per BR-39)", async () => {
    mockFailure();
    render(<RequesterSelection onContinue={vi.fn()} />);
    await waitFor(() => screen.getByRole("button", { name: /retry/i }));
    // getByRole with an accessible name already asserts this; no icon-only
    // controls exist on this screen, so BR-39 has nothing further to check here.
  });
});