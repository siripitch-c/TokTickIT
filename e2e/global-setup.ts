import { resetE2eData } from "./support/helpers.js";

// Lab 3, Issue #34 — every run starts from the same accounts: whatever an
// interrupted run left behind is removed, and the fixture accounts are made
// again. Unlike the teardown, a failure here stops the run. A suite that starts
// without its accounts, or without the Administrator E2E-10 needs, would only
// report the same missing precondition many times over, and less clearly.
export default function globalSetup(): void {
  resetE2eData();
}
