import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";

// tests.md API-REF-01, api-spec.md §3.
// Reference data is public: neither endpoint requires X-Requester-Id.
// Requires a migrated + seeded test database (see README §Testing).

describe("Reference data endpoints (API-REF-01)", () => {
  it("GET /api/categories returns only active Categories in { id, name } shape", async () => {
    const response = await request(app).get("/api/categories");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(4);

    for (const row of response.body.data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    }
  });

  it("GET /api/related-systems returns the seeded active systems in { id, name } shape", async () => {
    const response = await request(app).get("/api/related-systems");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    // specification.md §7 seeds >= 6 Related Systems plus "Other / Not Listed"
    expect(response.body.data.length).toBeGreaterThanOrEqual(6);

    const names = (response.body.data as { name: string }[]).map((r) => r.name);
    expect(names).toContain("Other / Not Listed");

    for (const row of response.body.data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    }
  });

  it("excludes inactive rows from both endpoints", async () => {
    const prisma = getPrisma();
    const system = await prisma.relatedSystem.findFirst({ where: { isActive: true } });
    const category = await prisma.category.findFirst({ where: { isActive: true } });
    if (!system || !category) throw new Error("Seed data missing — run npm run prisma:seed");

    await prisma.relatedSystem.update({ where: { id: system.id }, data: { isActive: false } });
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });

    try {
      const systems = await request(app).get("/api/related-systems");
      const categories = await request(app).get("/api/categories");

      expect((systems.body.data as { id: number }[]).map((r) => r.id)).not.toContain(system.id);
      expect((categories.body.data as { id: number }[]).map((r) => r.id)).not.toContain(category.id);
    } finally {
      await prisma.relatedSystem.update({ where: { id: system.id }, data: { isActive: true } });
      await prisma.category.update({ where: { id: category.id }, data: { isActive: true } });
    }
  });
});
