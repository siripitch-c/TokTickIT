import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REQUESTER, STAFF, makeAction, mockServer, refused, renderDetail } from "../support/ticketServer.js";

// tests.md UI-ACTION-01..11; ui-spec.md §2.2, §2.3, §6; specification.md
// FR-01..FR-07, BR-04..BR-11, BR-27, BR-31, AC-07.
//
// What a person on each side of the work log sees and can do. That the API
// refuses the rest is proven at the API (API-ACTION-14, API-ACTION-15); a
// hidden control is never the evidence for an authorization claim.

// The panel renders a loading state first, so the tests wait for the ready
// one by its own test id rather than racing the heading.
const panel = () => screen.findByTestId("actions-taken");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("The work log", () => {
  it("UI-ACTION-01 / FR-01, BR-11: every Action renders with its fields, in the order the API returned", async () => {
    mockServer(STAFF, {
      actions: [
        makeAction({ id: 1, description: "Collected the laptop and ran the battery report." }),
        makeAction({
          id: 2,
          description: "Replaced the battery and charged it to full.",
          result: "Battery now holds four hours.",
          status: "COMPLETED",
          attachmentNotes: "battery-report.pdf on this ticket.",
        }),
      ],
    });
    renderDetail(STAFF);

    const section = await panel();
    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Collected the laptop and ran the battery report.");
    expect(rows[1]).toHaveTextContent("Replaced the battery and charged it to full.");
    expect(rows[1]).toHaveTextContent("Battery now holds four hours.");
    expect(rows[1]).toHaveTextContent("battery-report.pdf on this ticket.");
    // An open Action has no result yet, and says so rather than looking broken.
    expect(rows[0]).toHaveTextContent("—");
  });

  it("UI-ACTION-02 / BR-05, ui-spec §2.2: all four statuses render their label, never colour alone", async () => {
    mockServer(STAFF, {
      actions: [
        makeAction({ id: 1, status: "PLANNED" }),
        makeAction({ id: 2, status: "IN_PROGRESS" }),
        makeAction({ id: 3, status: "COMPLETED", result: "Done." }),
        makeAction({ id: 4, status: "CANCELLED" }),
      ],
    });
    renderDetail(STAFF);

    const section = await panel();
    for (const label of ["Planned", "In Progress", "Completed", "Cancelled"]) {
      expect(within(section).getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("UI-ACTION-01 / BR-02: an Action carried out by somebody other than its author says so", async () => {
    mockServer(STAFF, {
      actions: [
        makeAction({
          performedBy: { id: 7, name: "Somsak Wattana", role: "IT_STAFF" },
          assignedTo: { id: 9, name: "Anong Kittisak", role: "ADMINISTRATOR" },
        }),
      ],
    });
    renderDetail(STAFF);

    const section = await panel();
    expect(within(section).getByText(/Somsak Wattana/)).toBeInTheDocument();
    expect(within(section).getByText(/for Anong Kittisak/)).toBeInTheDocument();
  });

  it("UI-ACTION-01: an empty log is a state of its own, not a failure", async () => {
    mockServer(STAFF, { actions: [] });
    renderDetail(STAFF);

    const section = await panel();
    expect(within(section).getByText(/No actions have been recorded/i)).toBeInTheDocument();
  });
});

describe("Recording an action", () => {
  it("UI-ACTION-03 / FR-05, BR-07: choosing Yes reveals the note and makes it required; No hides and clears it", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, { actions: [] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));

    expect(screen.queryByLabelText(/Follow-up note/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Yes" }));
    const note = screen.getByLabelText(/Follow-up note/i);
    expect(note).toHaveAttribute("aria-required", "true");

    await user.type(screen.getByLabelText(/What was done/i), "Ordered a replacement battery.");
    await user.type(note, "Chase the supplier on Monday.");

    // Turning it off again drops the note rather than carrying it invisibly.
    await user.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.queryByLabelText(/Follow-up note/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    const sent = server.calls.find((c) => c.method === "POST")!.body!;
    expect(sent.followUpRequired).toBe(false);
    expect(sent.followUpNote).toBe("");
  });

  it("UI-ACTION-03 / BR-07: submitting with follow-up on and no note is refused in the form, with no request", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, { actions: [] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));
    await user.type(screen.getByLabelText(/What was done/i), "Ordered a replacement battery.");
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Save action" }));

    expect(await screen.findByText(/A follow-up note is required/i)).toBeInTheDocument();
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("UI-ACTION-04 / BR-10: the description counter tracks what is typed and short text is refused", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, { actions: [] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));
    await user.type(screen.getByLabelText(/What was done/i), "four");

    expect(screen.getByText("4 / 2000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByText(/between 5 and 2000 characters/i)).toBeInTheDocument();
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("UI-ACTION-08 / BR-04: the assignee list offers the active staff and defaults to the signed-in user", async () => {
    const user = userEvent.setup();
    mockServer(STAFF, { actions: [] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));

    const select = screen.getByLabelText(/Assigned to/i) as HTMLSelectElement;
    expect(select.value).toBe(String(STAFF.id));
    expect(within(select).getByRole("option", { name: "Somsak Wattana" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Anong Kittisak" })).toBeInTheDocument();
  });

  it("UI-ACTION-06 / BR-31: the save control disables while the request is in flight, so a double click posts once", async () => {
    const user = userEvent.setup();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = mockServer(STAFF, { actions: [] });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") await held;
      return realFetch(input, init);
    }) as typeof fetch;
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));
    await user.type(screen.getByLabelText(/What was done/i), "Ordered a replacement battery.");

    const save = screen.getByRole("button", { name: "Save action" });
    await user.click(save);
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Saving…" })).catch(() => undefined);

    release();
    await waitFor(() => expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(1));
  });

  it("UI-ACTION-11 / FR-24: a refused save keeps every value the person typed", async () => {
    const user = userEvent.setup();
    mockServer(STAFF, {
      actions: [],
      actionWrite: (method) =>
        method === "POST" ? refused(500, "INTERNAL_ERROR", "Something went wrong. Please try again.") : undefined,
    });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Add Action" }));
    await user.type(screen.getByLabelText(/What was done/i), "Ordered a replacement battery.");
    await user.type(screen.getByLabelText(/^Result/i), "Waiting for the supplier.");
    await user.click(screen.getByRole("button", { name: "Save action" }));

    expect(await screen.findByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/What was done/i)).toHaveValue("Ordered a replacement battery.");
    expect(screen.getByLabelText(/^Result/i)).toHaveValue("Waiting for the supplier.");
  });
});

describe("Completing, cancelling and conflicts", () => {
  it("UI-ACTION-05 / BR-06, ui-spec §6.4: Complete with no result opens the form on the missing field instead of sending a request", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, { actions: [makeAction({ result: null })] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Complete" }));

    const result = await screen.findByLabelText(/^Result/i);
    expect(await screen.findByText(/A result is required to complete an action/i)).toBeInTheDocument();
    expect(result).toHaveFocus();
    expect(server.calls.some((call) => call.method === "PATCH")).toBe(false);

    // Filling it in and saving is the whole repair, and the row then completes.
    await user.type(result, "Network team confirmed the subnet is allowed.");
    await user.click(screen.getByRole("button", { name: "Save action" }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    await user.click(within(screen.getByTestId("actions-taken")).getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    expect(await within(screen.getByTestId("actions-taken")).findByText(/Completed/)).toBeInTheDocument();
  });

  it("UI-ACTION-05 / AC-05: completing an Action with a result sends the version and re-renders the row", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, { actions: [makeAction({ result: "Battery replaced.", version: 3 })] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Complete" }));

    await waitFor(() => expect(server.calls.some((c) => c.method === "PATCH")).toBe(true));
    const sent = server.calls.find((c) => c.method === "PATCH")!.body!;
    expect(sent).toMatchObject({ version: 3, status: "COMPLETED" });
    expect(await within(section).findByText(/Completed/)).toBeInTheDocument();
    // A finished Action offers no further control (BR-05).
    expect(within(section).queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
  });

  it("UI-ACTION-10 / FR-04: cancelling asks first and says the Action stays in the log", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, { actions: [makeAction({ version: 2 })] });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Cancel action" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/stays in the log and cannot be reopened/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel action" }));

    await waitFor(() => expect(server.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(server.calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ version: 2, status: "CANCELLED" });
    expect(await within(section).findByText(/Cancelled/)).toBeInTheDocument();
  });

  it("UI-ACTION-09 / BR-27, ui-spec §2.3: a stale write shows the conflict with Reload and does not resubmit", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF, {
      actions: [makeAction({ result: "Battery replaced.", version: 1 })],
      actionWrite: (method) =>
        method === "PATCH"
          ? refused(409, "STALE_UPDATE", "This changed after you opened it. Reload to see the current version.")
          : undefined,
    });
    renderDetail(STAFF);

    const section = await panel();
    await user.click(within(section).getByRole("button", { name: "Complete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/changed after you opened it/i);
    const patches = server.calls.filter((c) => c.method === "PATCH").length;
    await user.click(within(alert).getByRole("button", { name: "Reload" }));
    // Reload re-reads; it never silently sends the write again (BR-27).
    await waitFor(() => expect(server.calls.filter((c) => c.method === "PATCH")).toHaveLength(patches));
    expect(server.calls.filter((c) => c.method === "GET" && c.url.includes("/actions"))).not.toHaveLength(1);
  });
});

describe("What a Requester gets", () => {
  it("UI-ACTION-07 / FR-06, AC-07: every Action is visible and no write control is rendered at all", async () => {
    mockServer(REQUESTER, {
      actions: [makeAction({ description: "Collected the laptop and ran the battery report." })],
    });
    renderDetail(REQUESTER);

    const section = await panel();
    expect(within(section).getByText("Collected the laptop and ran the battery report.")).toBeInTheDocument();

    for (const name of ["Add Action", "Edit", "Complete", "Cancel action"]) {
      expect(within(section).queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("UI-ACTION-07 / BR-04: the Requester's screen never asks for the staff assignee list", async () => {
    const server = mockServer(REQUESTER, { actions: [makeAction()] });
    renderDetail(REQUESTER);

    await panel();
    await waitFor(() => expect(server.calls.some((c) => c.url.includes("/actions"))).toBe(true));
    expect(server.calls.some((call) => call.url.includes("/assignees"))).toBe(false);
  });
});
