import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttachmentSection from "../../src/components/AttachmentSection.js";
import { AttachmentMeta } from "../../src/api.js";

// tests.md UI-DETAIL-03..08; ui-spec.md §2.5, §7.1, §7.4;
// specification.md BR-26..BR-33, AC-07, AC-08, AC-13, AC-17, BR-39.
// Only the fetch layer is mocked — the limit, the confirm flow and the
// per-row failure handling are the component's real logic.

const REQUESTER_ID = 2;
const TICKET_ID = 118;

function attachment(overrides: Partial<AttachmentMeta> = {}): AttachmentMeta {
  return {
    id: 1,
    ticketId: TICKET_ID,
    originalFilename: "evidence.png",
    mimeType: "image/png",
    sizeBytes: 2048,
    uploadedAt: "2026-05-12T09:20:00.000Z",
    removedAt: null,
    removedReason: null,
    ...overrides,
  };
}

const pngFile = (name = "new-evidence.png") =>
  new File([new Uint8Array(64)], name, { type: "image/png" });

interface Handlers {
  upload?: () => { status: number; body: unknown };
  remove?: () => { status: number; body: unknown };
  download?: () => { status: number; body?: unknown };
}

function mockFetch(handlers: Handlers = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const reply = (r: { status: number; body?: unknown }) =>
      ({
        ok: r.status < 300,
        status: r.status,
        json: async () => r.body,
        blob: async () => new Blob(["file bytes"], { type: "image/png" }),
      }) as unknown as Response;

    if (url.includes("/download")) {
      return reply(handlers.download?.() ?? { status: 200 });
    }
    if (init?.method === "DELETE") {
      return reply(
        handlers.remove?.() ?? {
          status: 200,
          body: {
            data: attachment({
              removedAt: "2026-05-14T08:00:00.000Z",
              removedReason: "Uploaded the wrong screenshot",
            }),
          },
        },
      );
    }
    return reply(handlers.upload?.() ?? { status: 201, body: { data: attachment({ id: 99 }) } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderSection(initial: AttachmentMeta[] = []) {
  return render(
    <AttachmentSection requesterId={REQUESTER_ID} ticketId={TICKET_ID} initialAttachments={initial} />,
  );
}

const openAddPanel = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /add attachment/i }));

describe("Attachment section", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("UI-DETAIL-03: adding an attachment shows uploading, then the finished row (BR-33)", async () => {
    // The upload request is held open so the in-flight state is observable
    // rather than replaced in the same tick.
    let finish: (value: Response) => void = () => {};
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/attachments")) {
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    renderSection();

    await openAddPanel(user);
    await user.upload(screen.getByLabelText(/add attachments/i), pngFile());

    await waitFor(() => expect(screen.getByText(/uploading/i)).toBeInTheDocument());
    expect(screen.getByText("new-evidence.png")).toBeInTheDocument();

    finish({
      ok: true,
      status: 201,
      json: async () => ({ data: attachment({ id: 99, originalFilename: "new-evidence.png" }) }),
    } as unknown as Response);

    // The uploading row becomes the finished one in place.
    await waitFor(() => expect(screen.getByTestId("attachment-99")).toBeInTheDocument());
    expect(screen.queryByText(/uploading/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /attachments \(1 active\)/i })).toBeInTheDocument();
  });

  it("UI-DETAIL-03: a failed upload marks only its own row and offers a retry (BR-33)", async () => {
    let fail = true;
    mockFetch({
      upload: () =>
        fail
          ? { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } } }
          : { status: 201, body: { data: attachment({ id: 99, originalFilename: "new-evidence.png" }) } },
    });
    const user = userEvent.setup();
    renderSection([attachment({ id: 1, originalFilename: "already-here.png" })]);

    await openAddPanel(user);
    await user.upload(screen.getByLabelText(/add attachments/i), pngFile());

    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
    // The attachment that was already on the ticket is untouched.
    expect(screen.getByText("already-here.png")).toBeInTheDocument();
    expect(screen.getByTestId("attachment-1")).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(screen.getByTestId("attachment-99")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("UI-DETAIL-04: downloading an active attachment saves it under its original name (AC-17)", async () => {
    mockFetch();
    const created: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        created.push(this.download);
      });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake");
    globalThis.URL.revokeObjectURL = vi.fn();

    const user = userEvent.setup();
    renderSection([attachment({ id: 1, originalFilename: "screenshot of the error.png" })]);

    await user.click(screen.getByRole("button", { name: /download screenshot of the error\.png/i }));

    // The download is fetched with the Requester header rather than followed as
    // a plain link, so the saved name comes from the metadata, not the URL.
    await waitFor(() => expect(created).toEqual(["screenshot of the error.png"]));
    clickSpy.mockRestore();
  });

  it("UI-DETAIL-05: removal needs confirmation and a valid reason (BR-31, AC-13)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    renderSection([attachment({ id: 1 })]);

    // Nothing happens on the row until the confirm step is completed.
    await user.click(screen.getByRole("button", { name: /remove evidence\.png/i }));
    const modal = screen.getByTestId("remove-modal");
    expect(within(modal).getByLabelText(/removal reason/i)).toBeInTheDocument();

    // The destructive action is unavailable until the reason could be accepted.
    const confirm = within(modal).getByRole("button", { name: /remove attachment/i });
    expect(confirm).toBeDisabled();

    await user.type(within(modal).getByLabelText(/removal reason/i), "oops");
    expect(confirm).toBeDisabled(); // four characters is under the minimum
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "DELETE")).toHaveLength(0);

    await user.type(within(modal).getByLabelText(/removal reason/i), " wrong file");
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    await waitFor(() => expect(screen.queryByTestId("remove-modal")).not.toBeInTheDocument());
    const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === "DELETE")!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      removalReason: "oops wrong file",
    });
  });

  it("UI-DETAIL-05: cancelling leaves the attachment exactly as it was", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    renderSection([attachment({ id: 1 })]);

    await user.click(screen.getByRole("button", { name: /remove evidence\.png/i }));
    await user.click(within(screen.getByTestId("remove-modal")).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByTestId("remove-modal")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download evidence\.png/i })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "DELETE")).toHaveLength(0);
  });

  it("UI-DETAIL-06: a 6th attachment is refused client-side, matching the API (BR-28, AC-07)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    const five = [1, 2, 3, 4, 5].map((id) => attachment({ id, originalFilename: `file-${id}.png` }));
    renderSection(five);

    expect(screen.getByRole("heading", { name: /attachments \(5 active\)/i })).toBeInTheDocument();

    // The control that would add a sixth is unavailable, and says why.
    const addButton = screen.getByRole("button", { name: /add attachment/i });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute("title", expect.stringMatching(/maximum 5/i));

    await user.click(addButton);
    expect(screen.queryByLabelText(/add attachments/i)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "POST")).toHaveLength(0);
  });

  it("UI-DETAIL-06: a removed attachment frees its slot again (BR-28 counts active only)", async () => {
    mockFetch();
    const rows = [
      ...[1, 2, 3, 4].map((id) => attachment({ id, originalFilename: `file-${id}.png` })),
      attachment({
        id: 5,
        originalFilename: "gone.png",
        removedAt: "2026-05-14T08:00:00.000Z",
        removedReason: "Wrong file",
      }),
    ];
    renderSection(rows);

    expect(screen.getByRole("heading", { name: /attachments \(4 active\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add attachment/i })).toBeEnabled();
  });

  it("UI-DETAIL-07: a removed attachment keeps its metadata and loses its download control (BR-29, BR-30)", async () => {
    mockFetch();
    renderSection([
      attachment({
        id: 1,
        originalFilename: "taken-down.pdf",
        sizeBytes: 4096,
        removedAt: "2026-05-14T08:00:00.000Z",
        removedReason: "Uploaded the wrong document",
      }),
    ]);

    const row = screen.getByTestId("attachment-1");
    expect(within(row).getByText("taken-down.pdf")).toBeInTheDocument();
    expect(within(row).getByText(/4 KB/)).toBeInTheDocument();
    expect(within(row).getByText(/Reason: Uploaded the wrong document/)).toBeInTheDocument();
    expect(within(row).getByText(/Removed/)).toBeInTheDocument();

    // Absent, not disabled: a control that can never work is worse than none.
    expect(within(row).queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("UI-DETAIL-08: the icon-only remove control carries both a label and a tooltip (BR-39)", async () => {
    mockFetch();
    renderSection([attachment({ id: 1, originalFilename: "evidence.png" })]);

    const remove = screen.getByRole("button", { name: /remove evidence\.png/i });
    // The visible glyph is not a name, so both attributes have to be present
    // and say the same thing.
    expect(remove).toHaveAttribute("aria-label", "Remove evidence.png");
    expect(remove).toHaveAttribute("title", "Remove evidence.png");

    const download = screen.getByRole("button", { name: /download evidence\.png/i });
    expect(download).toHaveAttribute("title", "Download evidence.png");
  });

  it("a disallowed file is refused before any upload is attempted (BR-26)", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    renderSection();

    await openAddPanel(user);
    // Dropped rather than picked: the input carries an accept list, so a
    // disallowed type can only arrive this way — which is why it is re-checked.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.drop(screen.getByTestId("zg-dropzone"), {
      dataTransfer: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByTestId("zg-attachment-notice")).toHaveTextContent(/unsupported file type/i);
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === "POST")).toHaveLength(0);
  });
});
