import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

// tests.md API-ERR-01; api-spec.md §1 ("Error envelope ... used for every
// non-2xx response") and §6.
// These two cases are the ones Express answers on its own — an unmatched path
// and a body express.json() cannot parse — so without explicit handlers they
// return an HTML error page and quietly break the contract every other
// endpoint keeps.

describe("Error envelope coverage (API-ERR-01)", () => {
  it("answers an unmatched path with the JSON envelope, not Express's HTML page", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(typeof response.body.error.message).toBe("string");
  });

  it("answers a malformed JSON body with the JSON envelope", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set("X-Requester-Id", "1")
      .set("Content-Type", "application/json")
      .send("{ not valid json ");

    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("never leaks internal detail through either handler (api-spec.md §6)", async () => {
    const notFound = await request(app).get("/api/nope");
    const badBody = await request(app)
      .post("/api/tickets")
      .set("X-Requester-Id", "1")
      .set("Content-Type", "application/json")
      .send("{{{");

    for (const response of [notFound, badBody]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/at \w+ \(/); // no stack frames
      expect(serialized).not.toMatch(/node_modules/);
      expect(serialized).not.toMatch(/prisma/i);
    }
  });
});
