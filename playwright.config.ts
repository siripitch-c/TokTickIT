import { defineConfig, devices } from "@playwright/test";
import { CLIENT_URL, SERVER_URL } from "./e2e/support/environment.js";

// docs/lab-02/tests.md §2 (Lab 2 E2E-01..07, VIS-01..03; Issue #17) and
// docs/lab-03/tests.md §2.11, §2.12 and §6 (Lab 3 E2E-01..12, VIS-01..03; Issue #34).

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  // One PostgreSQL database backs every spec, exactly as the API tests do
  // (server/vitest.config.ts turns off file parallelism for the same reason):
  // two workers creating and searching tickets at once would make the list,
  // no-results and attachment-limit assertions depend on timing — and in Lab 3
  // the Administrator safety rules depend on who else is an Administrator.
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: CLIENT_URL,
    // The desktop width is the default; the visual specs and the 375px flows
    // set their own viewport where the test is about a smaller one.
    viewport: { width: 1440, height: 900 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  // reuseExistingServer stays on even outside CI: the servers are normally
  // already running in the developer's own terminal, and starting a second
  // pair would fail on the port rather than help. When nothing is listening,
  // Playwright starts both and shuts them down with the run.
  webServer: [
    {
      command: "npm run dev --prefix server",
      url: `${SERVER_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev --prefix client",
      url: CLIENT_URL,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
