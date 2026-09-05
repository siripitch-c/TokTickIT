import { execSync } from "node:child_process";

// Issue #17 — the end-to-end suite creates real tickets in the real database.
// This hands them back afterwards, so running the suite is not a slow way of
// filling My Tickets with noise. The work itself lives in the server package,
// where Prisma and DATABASE_URL are already configured.
export default function globalTeardown(): void {
  try {
    // One command string rather than a program plus an argument array: npm is
    // a .cmd shim on Windows, which Node refuses to spawn directly, and
    // spawning it through `shell: true` with separate arguments warns
    // (DEP0190) on every run. execSync goes through the shell by design.
    execSync("npm run e2e:cleanup --prefix server", { stdio: "inherit" });
  } catch (error) {
    // A cleanup that fails must not turn a passing run red; the tickets are
    // still identifiable by their [e2e] marker and the command can be re-run.
    console.error("e2e cleanup did not complete; [e2e] tickets may remain.", error);
  }
}
