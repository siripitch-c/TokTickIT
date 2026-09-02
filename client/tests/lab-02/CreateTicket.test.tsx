import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import CreateTicket from "../../src/pages/CreateTicket.js";

// tests.md UI-CREATE-01..10; ui-spec.md §5.4; specification.md BR-19..BR-28,
// BR-22, BR-24, AC-01/AC-04/AC-06/AC-07/AC-16.
// Only the fetch layer is mocked — validation, state transitions, and the
// attachment rules under test are the real component logic.

const REQUESTER = { id: 7, name: "Jennifer Anderson" };
const CATEGORIES = [
  { id: 1, name: "Account and Access" },
  { id: 2, name: "Hardware" },
];
const RELATED_SYSTEMS = [
  { id: 3, name: "VPN" },
  { id: 4, name: "Other / Not Listed" },
];

const CREATED_TICKET = {
  id: 118,
  ticketNumber: "TKT-2026-000118",
  requesterId: REQUESTER.id,
  categoryId: 2,
  relatedSystemId: 3,
  summary: "VPN drops every few minutes",
  description: "The VPN client disconnects roughly every five minutes on campus Wi-Fi.",
  requestedPriority: "MEDIUM",
  itPriority: null,
  currentStatus: "NEW",
  createdAt: "2026-05-12T09:14:00.000Z",
  updatedAt: "2026-05-12T09:14:00.000Z",
  attachments: [],
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

type FetchHandler = (url: string, init?: RequestInit) => unknown;

/** Routes each mocked call by URL so tests only override what they care about. */
function mockFetch(overrides: { create?: FetchHandler; upload?: FetchHandler; reference?: FetchHandler } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/categories")) {
      return (overrides.reference?.(url, init) as Response) ?? jsonResponse(200, { data: CATEGORIES });
    }
    if (url.includes("/api/related-systems")) {
      return (overrides.reference?.(url, init) as Response) ?? jsonResponse(200, { data: RELATED_SYSTEMS });
    }
    if (url.includes("/attachments")) {
      return (
        (overrides.upload?.(url, init) as Response) ??
        jsonResponse(201, {
          data: {
            id: 44,
            ticketId: CREATED_TICKET.id,
            originalFilename: "evidence.png",
            mimeType: "image/png",
            sizeBytes: 128,
            uploadedAt: "2026-05-12T09:20:00.000Z",
            removedAt: null,
            removedReason: null,
          },
        })
      );
    }
    if (url.includes("/api/tickets")) {
      return (overrides.create?.(url, init) as Response) ?? jsonResponse(201, { data: CREATED_TICKET });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={["/tickets/new"]}>
      <Routes>
        <Route element={<Outlet context={REQUESTER} />}>
          <Route path="/tickets/new" element={<CreateTicket />} />
        </Route>
        <Route path="/my-tickets" element={<p>My Tickets placeholder</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderReadyForm() {
  renderScreen();
  await waitFor(() => expect(screen.getByLabelText(/^Summary/)).toBeInTheDocument());
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/^Category/), "2");
  await user.selectOptions(screen.getByLabelText(/^Related System/), "3");
  await user.selectOptions(screen.getByLabelText(/^Requested Priority/), "MEDIUM");
  await user.type(screen.getByLabelText(/^Summary/), CREATED_TICKET.summary);
  await user.type(screen.getByLabelText(/^Description/), CREATED_TICKET.description);
}

const submitButton = () => screen.getByRole("button", { name: /submit ticket|submitting/i });

const pngFile = (name = "evidence.png", size = 128) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

const postCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("Create Ticket screen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("UI-CREATE-01: shows the loading state, then the form; a reference-data failure is safe and retryable", async () => {
    let failNext = true;
    const fetchMock = mockFetch({
      reference: () => (failNext ? jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }) : undefined),
    });

    renderScreen();
    expect(screen.getByTestId("zg-state-loading")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("zg-state-error")).toBeInTheDocument());
    expect(screen.queryByLabelText(/^Summary/)).not.toBeInTheDocument();

    failNext = false;
    await userEvent.setup().click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByLabelText(/^Summary/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
  });

  it("UI-CREATE-02..05: an empty form flags every required field at once and calls no API (AC-04)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderReadyForm();

    await user.click(submitButton());

    for (const message of [
      /Please choose a category/i,
      /Please choose a related system/i,
      /Please choose a requested priority/i,
      /Summary must be between 5 and 150 characters/i,
      /Description must be between 10 and 2000 characters/i,
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument();
    }

    // Focus moves to the first invalid field (ui-spec.md §5.4).
    expect(screen.getByLabelText(/^Category/)).toHaveFocus();
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it("UI-CREATE-02..05: too-short and whitespace-only text is rejected client-side (BR-19, BR-20)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderReadyForm();

    await user.selectOptions(screen.getByLabelText(/^Category/), "2");
    await user.selectOptions(screen.getByLabelText(/^Related System/), "3");
    await user.selectOptions(screen.getByLabelText(/^Requested Priority/), "LOW");
    await user.type(screen.getByLabelText(/^Summary/), "    ");
    await user.type(screen.getByLabelText(/^Description/), "too short");

    await user.click(submitButton());

    expect(screen.getByText(/Summary must be between 5 and 150 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/Description must be between 10 and 2000 characters/i)).toBeInTheDocument();
    expect(postCalls(fetchMock)).toHaveLength(0);

    // Correcting a field clears its message rather than leaving it stale.
    await user.clear(screen.getByLabelText(/^Summary/));
    await user.type(screen.getByLabelText(/^Summary/), "VPN down");
    expect(screen.queryByText(/Summary must be between 5 and 150 characters/i)).not.toBeInTheDocument();
  });

  it("UI-CREATE-06: a valid submission posts the trimmed payload and shows the generated number (AC-01)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderReadyForm();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("created-ticket-number")).toHaveTextContent("TKT-2026-000118"));

    const [url, init] = postCalls(fetchMock)[0];
    expect(String(url)).toContain("/api/tickets");
    expect((init as RequestInit).headers).toMatchObject({ "X-Requester-Id": "7" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      categoryId: 2,
      relatedSystemId: 3,
      requestedPriority: "MEDIUM",
      summary: CREATED_TICKET.summary,
      description: CREATED_TICKET.description,
    });

    // The success panel replaces the form rather than overlaying it (§5.4).
    expect(screen.queryByLabelText(/^Summary/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view ticket/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create another/i })).toBeInTheDocument();
  });

  it("UI-CREATE-07: a double-click submits once and shows the busy state (BR-22, AC-16)", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    const fetchMock = mockFetch({
      create: () => new Promise((resolve) => { resolveCreate = resolve; }),
    });
    const user = userEvent.setup();
    await renderReadyForm();

    await fillValidForm(user);
    await user.click(submitButton());
    await user.click(submitButton());

    await waitFor(() => expect(submitButton()).toHaveAttribute("aria-busy", "true"));
    expect(submitButton()).toBeDisabled();
    expect(postCalls(fetchMock)).toHaveLength(1);

    resolveCreate(jsonResponse(201, { data: CREATED_TICKET }));
    await waitFor(() => expect(screen.getByTestId("created-ticket-number")).toBeInTheDocument());
    expect(postCalls(fetchMock)).toHaveLength(1);
  });

  it("UI-CREATE-08: a failed submission keeps every entered value and re-enables Submit (BR-24, AC-06)", async () => {
    mockFetch({ create: () => { throw new TypeError("Failed to fetch"); } });
    const user = userEvent.setup();
    await renderReadyForm();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("zg-submit-error")).toBeInTheDocument());
    expect(screen.getByLabelText(/^Summary/)).toHaveValue(CREATED_TICKET.summary);
    expect(screen.getByLabelText(/^Description/)).toHaveValue(CREATED_TICKET.description);
    expect(screen.getByLabelText(/^Category/)).toHaveValue("2");
    expect(submitButton()).not.toBeDisabled();
    expect(screen.queryByTestId("created-ticket-number")).not.toBeInTheDocument();
  });

  it("UI-CREATE-08: a server-side field error lands on its own field (BR-23)", async () => {
    mockFetch({
      create: () =>
        jsonResponse(400, {
          error: { code: "VALIDATION_ERROR", message: "Summary must be between 5 and 150 characters.", field: "summary" },
        }),
    });
    const user = userEvent.setup();
    await renderReadyForm();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() =>
      expect(screen.getByLabelText(/^Summary/)).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getByLabelText(/^Summary/)).toHaveValue(CREATED_TICKET.summary);
  });

  it("UI-CREATE-09: 0-5 attachments are accepted and a 6th is blocked client-side (BR-28, AC-07)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderReadyForm();

    const input = screen.getByLabelText(/add attachments/i);
    await user.upload(input, [1, 2, 3, 4, 5].map((n) => pngFile(`evidence-${n}.png`)));

    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);

    await user.upload(input, pngFile("evidence-6.png"));
    expect(screen.getByTestId("zg-attachment-notice")).toHaveTextContent(/Maximum 5 attachments/i);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("evidence-6.png")).not.toBeInTheDocument();

    // Freeing a slot lets a new file in again.
    await user.click(screen.getByRole("button", { name: /Remove evidence-1\.png/i }));
    await user.upload(input, pngFile("evidence-6.png"));
    expect(screen.getByText("evidence-6.png")).toBeInTheDocument();

    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("created-ticket-number")).toBeInTheDocument());
    // One create plus one upload per selected file (BR-25: uploads are separate).
    expect(postCalls(fetchMock)).toHaveLength(6);
  });

  it("UI-CREATE-10: a disallowed type or oversized file is refused before any upload (BR-26, BR-27)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    await renderReadyForm();

    // Dropped rather than picked: the file input carries an `accept` list, so
    // a disallowed type can only reach the component by drag-and-drop — which
    // is exactly why the component must re-check it (BR-26).
    fireEvent.drop(screen.getByTestId("zg-dropzone"), {
      dataTransfer: {
        files: [
          new File(["x"], "notes.txt", { type: "text/plain" }),
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }),
          pngFile("valid.png"),
        ],
      },
    });

    expect(screen.getByText(/Unsupported file type/i)).toBeInTheDocument();
    expect(screen.getByText(/File exceeds 5 MB/i)).toBeInTheDocument();
    // The valid selection is unaffected by its rejected neighbours (§5.4).
    expect(screen.getByText("valid.png")).toBeInTheDocument();
    expect(postCalls(fetchMock)).toHaveLength(0);

    await fillValidForm(user);
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByTestId("created-ticket-number")).toBeInTheDocument());

    // Only the one valid file was ever uploaded.
    expect(postCalls(fetchMock).filter(([url]) => String(url).includes("/attachments"))).toHaveLength(1);
  });

  it("BR-25: a failed attachment upload still leaves the Ticket created, with the file named", async () => {
    mockFetch({
      upload: () =>
        jsonResponse(415, {
          error: { code: "UNSUPPORTED_FILE_TYPE", message: "That file type is not allowed." },
        }),
    });
    const user = userEvent.setup();
    await renderReadyForm();

    await user.upload(screen.getByLabelText(/add attachments/i), pngFile("evidence.png"));
    await fillValidForm(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByTestId("created-ticket-number")).toHaveTextContent("TKT-2026-000118"));
    const warning = screen.getByTestId("zg-attachment-warning");
    expect(warning).toHaveTextContent("evidence.png");
    expect(warning).toHaveTextContent(/not allowed/i);
  });

  it("shows the read-only system-generated row with the current Requester (ui-spec.md §5.1)", async () => {
    mockFetch();
    await renderReadyForm();

    expect(screen.getByText("Generated after submit")).toBeInTheDocument();
    expect(screen.getByText(REQUESTER.name)).toBeInTheDocument();
    for (const field of screen.getAllByRole("status", { hidden: true })) {
      // Read-only fields announce their value rather than being disabled.
      expect(field).toHaveAttribute("aria-readonly", "true");
    }
  });
});
