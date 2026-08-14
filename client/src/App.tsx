import { useState } from "react";
import { Category } from "./api.js";

// UI states you must handle for Issue 4: idle, loading, success, error.
type UiState = "idle" | "loading" | "success" | "error";

export default function App() {
  const [state, setState] = useState<UiState>("idle");
  const [categories, setCategories] = useState<Category[]>([]);

  async function handleCheck() {
    setState("loading");

    try {
      // 1. เช็กสถานะของ Backend ก่อน
      const healthRes = await fetch("http://localhost:3000/api/health");
      if (!healthRes.ok) throw new Error("Server error");
      
      const healthData = await healthRes.json();
      
      if (healthData.status === "ok") {
        // 2. ดึงข้อมูล Categories หาก Backend ออนไลน์
        const catRes = await fetch("http://localhost:3000/api/categories");
        if (!catRes.ok) throw new Error("Failed to fetch categories");
        
        const catData = await catRes.json();
        
        // 3. บันทึกข้อมูลลง State และเปลี่ยนสถานะเป็น Success
        setCategories(catData);
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

      {/* แสดงผลเมื่อการดึงข้อมูลสำเร็จ */}
      {state === "success" && (
        <div className="mt-4">
          <p className="mb-3 text-success font-weight-bold">System Status: Online</p>
          
          <h2 className="h5 mb-3">IT Request Categories:</h2>
          <ul className="list-group">
            {categories.map((category) => (
              <li key={category.id} className="list-group-item">
                {category.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* แสดงผลเมื่อเกิดข้อผิดพลาด */}
      {state === "error" && (
        <div className="mt-4 text-danger">
          <p className="mb-1">System Status: Offline</p>
          <p>Unable to connect to TokTickIT API or failed to load categories.</p>
        </div>
      )}
    </div>
  );
}