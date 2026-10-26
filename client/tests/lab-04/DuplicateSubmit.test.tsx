import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { STAFF, mockServer, renderDetail } from "../support/ticketServer.js";

// tests.md UI-DUP-01, UI-DUP-02; specification.md FR-23, BR-31, AC-24.
//
// BR-31 names four records a repeated submission must not duplicate: an Action,
// a Comment, a Note and a Ticket. Three were already covered - `UI-CREATE-07`
// for the Ticket since Lab 2, `UI-ACTION-06` for the Action since Issue #47 -
// and the two threads were not, although they share one composer and so share
// one guard. Issue #51 found the gap by listing the four records in BR-31
// against the suites rather than by reading the component, which looks correct
// either way.
//
// The shape of each case is `UI-ACTION-06`'s: hold the POST in flight, press
// again, then count what reached the server. Asserting the button is disabled
// is not the same claim - a disabled button still fires if the handler lets it.

/** The in-flight POST, released by the returned function. */
function holdPosts() {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") await held;
    return realFetch(input, init);
  }) as typeof fetch;
  return release;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("A repeated submission creates one record", () => {
  it("UI-DUP-01 / FR-23, BR-31, AC-24: a double-clicked public comment posts once", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF);
    const release = holdPosts();
    renderDetail(STAFF);

    const thread = await screen.findByTestId("public-comments");
    await user.type(within(thread).getByLabelText("Add a public comment"), "The replacement part is on order.");
    await user.click(within(thread).getByRole("button", { name: "Post Comment" }));

    // The control reports the request and refuses the second press.
    const busy = await within(thread).findByRole("button", { name: "Posting…" });
    expect(busy).toBeDisabled();
    await user.click(busy).catch(() => undefined);

    release();
    await waitFor(() => {
      expect(server.calls.filter((call) => call.method === "POST" && call.url.endsWith("/comments"))).toHaveLength(1);
    });
  });

  it("UI-DUP-02 / FR-23, BR-31, AC-24: a double-clicked internal note is added once", async () => {
    const user = userEvent.setup();
    const server = mockServer(STAFF);
    const release = holdPosts();
    renderDetail(STAFF);

    const thread = await screen.findByTestId("internal-notes");
    await user.type(within(thread).getByLabelText("Add an internal note"), "Supplier quoted four working days.");
    await user.click(within(thread).getByRole("button", { name: "Add Internal Note" }));

    const busy = await within(thread).findByRole("button", { name: "Adding…" });
    expect(busy).toBeDisabled();
    await user.click(busy).catch(() => undefined);

    release();
    await waitFor(() => {
      expect(server.calls.filter((call) => call.method === "POST" && call.url.endsWith("/notes"))).toHaveLength(1);
    });
  });

  it("UI-DUP-01, UI-DUP-02 / FR-24: once the post lands the composer is usable again, and empty", async () => {
    // The success case for the same rule. A guard that never lifts would pass
    // both cases above and leave the thread unusable after one comment, which
    // is the failure Issue #47 shipped past 38 green tests by testing only
    // refusals.
    const user = userEvent.setup();
    const server = mockServer(STAFF);
    renderDetail(STAFF);

    const thread = await screen.findByTestId("public-comments");
    const box = within(thread).getByLabelText("Add a public comment");
    await user.type(box, "First comment.");
    await user.click(within(thread).getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(within(thread).getByText("First comment.")).toBeInTheDocument());
    expect(box).toHaveValue("");

    await user.type(box, "Second comment.");
    await user.click(within(thread).getByRole("button", { name: "Post Comment" }));
    await waitFor(() => {
      expect(server.calls.filter((call) => call.method === "POST" && call.url.endsWith("/comments"))).toHaveLength(2);
    });
    expect(within(thread).getByText("Second comment.")).toBeInTheDocument();
  });
});
