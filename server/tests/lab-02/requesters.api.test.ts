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

  it("API-REQ-03 / BR-36: an inactive Requester's existing Tickets remain in the database and are excluded from /api/requesters", async () => {
    const prisma = getPrisma();

    const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
    const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });

    // A fresh, temporarily-active Requester, so this test doesn't depend on
    // (or disturb) the permanently-inactive seeded Requester.
    const requester = await prisma.requester.create({
      data: {
        name: "Temp BR-36 Requester",
        email: `br36-${Date.now()}@example.edu`,
        isActive: true,
      },
    });

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-TEST-${Date.now()}`,
        requesterId: requester.id,
        categoryId: category.id,
        relatedSystemId: relatedSystem.id,
        summary: "BR-36 regression check",
        description: "Created directly via Prisma to verify inactive-Requester behavior.",
        requestedPriority: "LOW",
      },
    });

    try {
      // The Requester becomes inactive AFTER the Ticket already exists.
      await prisma.requester.update({ where: { id: requester.id }, data: { isActive: false } });

      const response = await request(app).get("/api/requesters");
      const ids = response.body.data.map((r: { id: number }) => r.id);
      expect(ids).not.toContain(requester.id);

      const stillThere = await prisma.ticket.findUnique({ where: { id: ticket.id } });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.requesterId).toBe(requester.id);
    } finally {
      await prisma.ticket.delete({ where: { id: ticket.id } });
      await prisma.requester.delete({ where: { id: requester.id } });
    }
  });
});