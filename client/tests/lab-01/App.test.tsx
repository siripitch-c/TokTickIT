import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import App from "../../src/App.js";

global.fetch = vi.fn();

describe("App", () => {

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders the TokTickIT heading", () => {
    render(<App />);
    expect(screen.getByText(/TokTickIT/i)).toBeInTheDocument();
  });

  it("shows Online and the seeded categories on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/api/health")) {
        return Promise.resolve({ ok: true, json: async () => ({ status: "ok" }) });
      }
      if (url.includes("/api/categories")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 1, name: "Account and Access" },
            { id: 2, name: "Hardware" },
            { id: 3, name: "Software" },
            { id: 4, name: "Network" }
          ]
        });
      }
    });

    render(<App />);
    
    const button = screen.getByRole("button", { name: /Check System/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/System Status: Online/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Account and Access")).toBeInTheDocument();
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("Software")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
  });

  it("shows an Offline error message when the API is unavailable", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Failed to fetch"));

    render(<App />);
    
    const button = screen.getByRole("button", { name: /Check System/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/System Status: Offline/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Unable to connect to TokTickIT API/i)).toBeInTheDocument();
  });
});