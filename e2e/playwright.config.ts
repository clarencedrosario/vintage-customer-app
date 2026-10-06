import { defineConfig, devices } from "@playwright/test";

// ADVOKATE browser E2E — PENDING EXECUTION (no browser tooling in the
// authoring environment). Run inside an environment that supports
// Chromium (see e2e/README.md). E2E_BASE_URL must point at a running
// deployment of this app; nothing here starts or stops servers.

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // OTP inboxes and seeded data are shared per run
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
