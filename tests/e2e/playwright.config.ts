import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @church-platform/web dev",
      url: "http://localhost:3000",
      timeout: 120_000,
      reuseExistingServer: true,
      env: { NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      command: "pnpm --filter @church-platform/admin dev",
      url: "http://localhost:3002",
      timeout: 120_000,
      reuseExistingServer: true,
      env: { NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      command:
        "pnpm --filter @church-platform/api build && pnpm --filter @church-platform/api start",
      url: "http://localhost:3001/api/v1/health",
      timeout: 120_000,
      reuseExistingServer: true,
      env: {
        DATABASE_URL: "postgresql://127.0.0.1:5432/church_platform_e2e",
        BETTER_AUTH_SECRET: "e2e-only-secret-that-is-at-least-32-characters",
        BETTER_AUTH_URL: "http://localhost:3001",
        PORT: "3001",
      },
    },
  ],
});
