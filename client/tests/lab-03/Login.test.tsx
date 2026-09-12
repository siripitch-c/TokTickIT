import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Login from "../../src/pages/Login.js";

// tests.md UI-LOGIN-01..06; ui-spec.md §4; specification.md FR-01, BR-06,
// AC-01, AC-05.
// Only the fetch layer is mocked — validation, busy state and what survives a
// failure are the component's own logic.

const SAFE_MESSAGE = "Email or password is incorrect.";

function mockFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function ok(user: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: user }),
  } as Response;
}

function unauthorised() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: { code: "INVALID_CREDENTIALS", message: SAFE_MESSAGE } }),
  } as Response;
}

const REQUESTER = {
  id: 3,
  name: "Jennifer Anderson",
  email: "jennifer.anderson@example.edu",
  role: "REQUESTER",
  isActive: true,
  mustChangePassword: false,
  createdAt: "2026-05-12T09:14:00.000Z",
  updatedAt: "2026-09-12T08:02:00.000Z",
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const emailBox = () => screen.getByLabelText(/email/i);
const passwordBox = () => screen.getByLabelText(/^password/i);
// The busy state replaces the label with "Signing in…" (Lab 2 §2.2), so the
// pattern has to match both — a query that only finds the idle button would
// report "element missing" for what is really "the button is working".
const signIn = () => screen.getByRole("button", { name: /sign(ing)? in/i });

describe("Login screen", () => {
  it("UI-LOGIN-01 / FR-01: renders the two fields and nothing the product cannot do", () => {
    mockFetch();
    render(<Login onSignedIn={vi.fn()} />);

    expect(emailBox()).toBeInTheDocument();
    expect(passwordBox()).toBeInTheDocument();
    expect(signIn()).toBeEnabled();

    // ui-spec.md §4.1: rendering a control the product does not have would be
    // worse than omitting it. None of these exist in Lab 3.
    expect(screen.queryByText(/remember me/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create an account|sign up/i)).not.toBeInTheDocument();
  });

  it("UI-LOGIN-02 / BR-42: an empty submit reports both fields and sends nothing", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    await user.click(signIn());

    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("UI-LOGIN-03 / AC-01: a successful sign-in hands the user up", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(ok(REQUESTER));
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(<Login onSignedIn={onSignedIn} />);

    await user.type(emailBox(), REQUESTER.email);
    await user.type(passwordBox(), "ChangeMe123!");
    await user.click(signIn());

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(REQUESTER));

    // api-spec.md §1: without this the browser drops the cookie and every
    // later request looks unauthenticated.
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).credentials).toBe("include");
  });

  it("UI-LOGIN-04 / AC-05, BR-06: a 401 keeps both values and shows one safe message", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(unauthorised());
    const onSignedIn = vi.fn();
    const user = userEvent.setup();
    render(<Login onSignedIn={onSignedIn} />);

    await user.type(emailBox(), "someone@example.edu");
    await user.type(passwordBox(), "wrong-password");
    await user.click(signIn());

    const callout = await screen.findByTestId("zg-login-error");
    expect(callout).toHaveTextContent(SAFE_MESSAGE);
    expect(onSignedIn).not.toHaveBeenCalled();

    // ui-spec.md §4.2: the password is not cleared. Retyping it because of a
    // typo in the email address punishes the wrong mistake.
    expect(passwordBox()).toHaveValue("wrong-password");
    expect(emailBox()).toHaveValue("someone@example.edu");
    expect(passwordBox()).toHaveFocus();
  });

  it("UI-LOGIN-04 / BR-06: the message never hints at which of the three failures it was", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(unauthorised());
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(emailBox(), "nobody@example.edu");
    await user.type(passwordBox(), "anything");
    await user.click(signIn());

    const text = (await screen.findByTestId("zg-login-error")).textContent ?? "";
    // A wrong password, an unknown address and a deactivated account are one
    // answer. Any of these words would separate them again.
    for (const leak of [/not found/i, /no account/i, /deactivat/i, /inactive/i, /disabled/i]) {
      expect(text).not.toMatch(leak);
    }
  });

  it("UI-LOGIN-05 / BR-43: a network failure is a safe message, and Sign In works again", async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(emailBox(), REQUESTER.email);
    await user.type(passwordBox(), "ChangeMe123!");
    await user.click(signIn());

    expect(await screen.findByTestId("zg-login-error")).toBeInTheDocument();
    expect(signIn()).toBeEnabled();
    expect(emailBox()).toHaveValue(REQUESTER.email);
  });

  it("UI-LOGIN-06 / FR-01: while the request is in flight the form is busy and locked", async () => {
    const fetchMock = mockFetch();
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(emailBox(), REQUESTER.email);
    await user.type(passwordBox(), "ChangeMe123!");
    await user.click(signIn());

    await waitFor(() => expect(signIn()).toHaveAttribute("aria-busy", "true"));
    expect(signIn()).toBeDisabled();
    expect(emailBox()).toBeDisabled();
    expect(passwordBox()).toBeDisabled();

    release(ok(REQUESTER));
    await waitFor(() => expect(signIn()).toBeEnabled());
  });

  it("UI-LOGIN-06: a second click while busy does not send a second request", async () => {
    const fetchMock = mockFetch();
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    render(<Login onSignedIn={vi.fn()} />);

    await user.type(emailBox(), REQUESTER.email);
    await user.type(passwordBox(), "ChangeMe123!");
    await user.click(signIn());
    await user.click(signIn());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(ok(REQUESTER));
  });
});
