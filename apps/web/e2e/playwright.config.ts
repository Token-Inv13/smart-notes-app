import { defineConfig } from "@playwright/test";

const isCI = process.env.CI === "true";
const baseURL = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000";

if (isCI && !process.env.E2E_BASE_URL?.trim()) {
  throw new Error("Missing E2E_BASE_URL. Example: https://app.tachesnotes.com");
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "./playwright-report" }],
  ],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "./test-results",
});
