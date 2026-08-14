import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

// Issue 4 — write this test yourself, using health.test.ts as the pattern.
// Requires the DB to be migrated and seeded first.
// It should assert: GET /api/categories returns 200 and the four seeded
// category names in id order.
describe("GET /api/categories", () => {
  it("returns the four seeded categories in id order", async () => {

    const response = await request(app).get("/api/categories");
    
    expect(response.status).toBe(200);
    
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(4);

    const categoryNames = response.body.map((category: { id: number, name: string }) => category.name);
    
    expect(categoryNames).toEqual([
      "Account and Access",
      "Hardware",
      "Software",
      "Network"
    ]);
  });
});