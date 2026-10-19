import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:43123",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "rm -rf .wrangler/state && npm run build && npm run db:migrate && node scripts/create-admin.mjs --phone 13800000000 --password Admin1234 --name 管理员 --role admin --force && npm run start",
    url: "http://127.0.0.1:43123/api/health",
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
