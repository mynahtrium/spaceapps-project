import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./web/tests",
  testMatch: /.*\.spec\.js/,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8123",
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command: "node scripts/server.mjs 8123",
    url: "http://127.0.0.1:8123/web/",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
