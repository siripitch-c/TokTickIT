import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChangePassword from "../../src/pages/ChangePassword.js";

// tests.md UI-PWD-01..06; ui-spec.md §5; specification.md FR-05, FR-06,
// BR-02, BR-08, BR-09, AC-02.

const CURRENT = "ChangeMe123!";
const NEXT = "a-much-better-password";

const USER = {
  id: 4,
  name: "David Lee",
  email: "david.lee@example.edu",
  role: "REQUESTER",
  isActive: true,
  mustChangePassword: false,
  createdAt: "2026-05-12T09:14:00.000Z",
  updatedAt: "2026-09-12T08:02:00.000Z",
};

function mockFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = () =>
  ({ ok: true, status: 200, json: async () => ({ data: USER }) }) as Response;

const fieldError = (field: string, message: string) =>
  ({
    ok: false,
    status: 400,
    json: async () => ({ error: { code: "VALIDATION_ERROR", message, field } }),
  }) as Response;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const current = () => screen.getByLabelText(/current password/i);
const next = () => screen.getByLabelText(/^new password/i);
const confirm = () => screen.getByLabelText(/confirm new password/i);
const save = () => screen.getByRole("button", { name: /sav(e|ing)/i });

async function fill(user: ReturnType<typeof userEvent.setup>, a: string, b: string, c: string) {
  if (a) await user.type(current(), a);
  if (b) await user.type(next(), b);
  if (c) await user.type(confirm(), c);
}

describe("Change Password screen", () => {
  it("UI-PWD-01 / BR-02, AC-02: the mandatory mode explains itself and offers no way out", () => {
    mockFetch();
    render(<ChangePassword mandatory onChanged={vi.fn()} />);

    expect(screen.getByTestId("zg-initial-password-banner")).toHaveTextContent(
      /initial password/i,
    );
    // There is nothing to go back to: every other route redirects here until a
    // new password is saved, and the server refuses them anyway.
    expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  });

  it("UI-PWD-02 / FR-06: the voluntary mode has no banner and can be cancelled", async () => {
    mockFetch();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ChangePassword mandatory={false} onChanged={vi.fn()} onCancel={onCancel} />);

    expect(screen.queryByTestId("zg-initial-password-banner")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("UI-PWD-03 / BR-08: the length rule is readable before anything fails", () => {
    mockFetch();
    render(<ChangePassword mandatory={false} onChanged={vi.fn()} />);

    // ui-spec.md §5: present from the start, so the rule is read rather than
    // discovered by failing.
    expect(screen.getByText(/8–72 characters/)).toBeInTheDocument();
  });

  it("UI-PWD-03 / BR-08: 7 and 73 characters are refused without a request", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<ChangePassword mandatory={false} onChanged={vi.fn()} />);

    const short = "a".repeat(7);
    await fill(user, CURRENT, short, short);
    await user.click(save());
    expect(await screen.findByText(/between 8 and 72 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(next());
    await user.clear(confirm());
    const long = "a".repeat(73);
    await fill(user, "", long, long);
    await user.click(save());
    expect(await screen.findByText(/between 8 and 72 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("UI-PWD-04 / BR-09: reusing the current password, and a mismatched confirmation, each fail on their own field", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<ChangePassword mandatory={false} onChanged={vi.fn()} />);

    await fill(user, CURRENT, CURRENT, CURRENT);
    await user.click(save());
    expect(await screen.findByText(/must be different/i)).toBeInTheDocument();

    await user.clear(next());
    await user.clear(confirm());
    await fill(user, "", NEXT, `${NEXT}-typo`);
    await user.click(save());
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("UI-PWD-05 / BR-42: a wrong current password lands under that field, not as a screen failure", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      fieldError("currentPassword", "Your current password is incorrect."),
    );
    const user = userEvent.setup();
    render(<ChangePassword mandatory={false} onChanged={vi.fn()} />);

    await fill(user, "not-my-password", NEXT, NEXT);
    await user.click(save());

    expect(await screen.findByText(/current password is incorrect/i)).toBeInTheDocument();
    // The session is valid; one typed value is not. A screen-level failure
    // would read as "something went wrong", which is the wrong story.
    expect(screen.queryByTestId("zg-change-password-error")).not.toBeInTheDocument();
    expect(current()).toHaveAttribute("aria-invalid", "true");
  });

  it("UI-PWD-06 / AC-02: a successful change confirms itself, then hands the updated user up", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(ok());
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ChangePassword mandatory onChanged={onChanged} />);

    await fill(user, CURRENT, NEXT, NEXT);
    await user.click(save());

    // ui-spec.md §5 and §10: the toast comes first and the navigation follows
    // it. In the mandatory case this is the only confirmation the change
    // worked before the application replaces the screen.
    expect(await screen.findByTestId("zg-state-success")).toBeInTheDocument();
    expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(USER), { timeout: 3000 });

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).credentials).toBe("include");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmPassword: NEXT,
    });
  });

  it("UI-PWD-06: while saving, all three fields are locked and a second click sends nothing", async () => {
    const fetchMock = mockFetch();
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    render(<ChangePassword mandatory onChanged={vi.fn()} />);

    await fill(user, CURRENT, NEXT, NEXT);
    await user.click(save());

    await waitFor(() => expect(save()).toHaveAttribute("aria-busy", "true"));
    expect(current()).toBeDisabled();
    expect(next()).toBeDisabled();
    expect(confirm()).toBeDisabled();

    await user.click(save());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(ok());
  });

  it("UI-PWD-06 / BR-43: a failure with no field is a safe screen message, and nothing typed is lost", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<ChangePassword mandatory={false} onChanged={vi.fn()} />);

    await fill(user, CURRENT, NEXT, NEXT);
    await user.click(save());

    expect(await screen.findByTestId("zg-change-password-error")).toBeInTheDocument();
    expect(current()).toHaveValue(CURRENT);
    expect(next()).toHaveValue(NEXT);
    expect(save()).toBeEnabled();
  });
});
