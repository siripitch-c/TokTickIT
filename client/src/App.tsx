import { useState } from "react";
import { checkSystem, Category } from "./api.js";

// UI states you must handle for Issue 4: idle, loading, success, error.
type UiState = "idle" | "loading" | "success" | "error";

export default function App() {
  const [state, setState] = useState<UiState>("idle");
  const [categories, setCategories] = useState<Category[]>([]);
  void categories;

  async function handleCheck() {
    setState("loading");

    try {
      const response = await fetch("http://localhost:3000/api/health");
      if (!response.ok) throw new Error("Server error");
      
      const data = await response.json();
      if (data.status === "ok") {
        setState("success");
      }
    } catch (err) {
      setState("error");
    }
  }

  return (
    <div className="container py-5" style={{ maxWidth: 640 }}>
      <h1 className="h3 mb-4">
        TokTickIT <span className="text-success">IT Service Desk</span>
      </h1>

      <button className="btn btn-success" onClick={handleCheck} disabled={state === "loading"}>
        {state === "loading" ? "Loading…" : "Check System"}
      </button>

      {state === "success" && (
        <div className="mt-4">
          <p className="mb-1">System Status: Online</p>
        </div>
      )}

      {state === "error" && (
        <div className="mt-4 text-danger">
          <p className="mb-1">System Status: Offline</p>
          <p>Unable to connect to TokTickIT API</p>
        </div>
      )}
    </div>
  );
}
