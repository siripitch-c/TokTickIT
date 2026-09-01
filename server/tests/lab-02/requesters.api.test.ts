import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";

// specification.md BR-05/BR-35, api-spec.md §3, tests.md API-REQ-01..03.
// Requires a migrated + seeded test database (see README §Testing).

describe("GET /api/requesters", () => {
  it("API-REQ-01: returns only active Requesters, wrapped as { data: [...] }", async () => {
    const response = await request(app).get("/api/requesters");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(4);

    // email must never appear in this public list response (api-spec.md §3)
    for (const r of response.body.data as { id: number; name: string }[]) {
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("name");
      expect(r).not.toHaveProperty("email");
      expect(r).not.toHaveProperty("isActive");
    }
  });

  it("API-REQ-02: with zero active Requesters, returns data: [] (not an error)", async () => {
    const prisma = getPrisma();
    // deactivate every requester for this test, then restore afterward
    const all = await prisma.requester.findMany({ where: { isActive: true } });
    await prisma.requester.updateMany({ data: { isActive: false } });

    try {
      const response = await request(app).get("/api/requesters");
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    } finally {
      await prisma.requester.updateMany({
        where: { id: { in: all.map((r) => r.id) } },
        data: { isActive: true },
      });
    }
  });

  it("API-REQ-03: an inactive Requester is excluded, even if their Tickets still exist in the DB", async () => {
    const prisma = getPrisma();
    const inactive = await prisma.requester.findFirst({ where: { isActive: false } });
    expect(inactive).not.toBeNull();

    const response = await request(app).get("/api/requesters");
    const ids = response.body.data.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(inactive!.id);
  });
});