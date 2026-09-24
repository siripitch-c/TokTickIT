// Where the running application is. Shared by playwright.config.ts and the
// specs, so a different port is set once, through the environment.
export const CLIENT_URL = process.env.E2E_CLIENT_URL ?? "http://localhost:5173";
export const SERVER_URL = process.env.E2E_SERVER_URL ?? "http://localhost:3000";
