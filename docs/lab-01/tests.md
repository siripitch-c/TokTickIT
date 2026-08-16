# Lab 1 — Test Plan and Evidence

All test files live under server/tests/lab-01/ and client/tests/lab-01/.

| # | Tool | Test | Result |
|---|------|------|--------|
| 1 | Supertest | GET /api/health returns 200, status=ok | Pass |
| 2 | Supertest | GET /api/categories returns 4 seeded categories in id order | Pass |
| 3 | Vitest | Heading renders | Pass |
| 4 | Vitest | Success state shows Online + category list | Pass |
| 5 | Vitest | Error state shows Offline + message | Pass |

### Terminal Output Evidence

**Server Output:**
> toktickit-server@1.0.0 test
> vitest run


 RUN  v2.1.9 E:/CPE334/tocktickit/server

 ✓ tests/lab-01/categories.test.ts (1)
 ✓ tests/lab-01/health.test.ts (1)

 Test Files  2 passed (2)
      Tests  2 passed (2)
   Start at  16:01:23
   Duration  879ms (transform 67ms, setup 0ms, collect 508ms, tests 234ms, environment 0ms, prepare 232ms)

**Client Output:**
> toktickit-client@1.0.0 test
> vitest run


 RUN  v2.1.9 E:/CPE334/tocktickit/client

 ✓ tests/lab-01/App.test.tsx (3)
   ✓ App (3)
     ✓ renders the TokTickIT heading
     ✓ shows Online and the seeded categories on success
     ✓ shows an Offline error message when the API is unavailable

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  16:01:34
   Duration  1.28s (transform 42ms, setup 103ms, collect 108ms, tests 69ms, environment 601ms, prepare 125ms)