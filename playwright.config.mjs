import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: [
    { command: "PORT=3101 corepack pnpm --filter @robot-rebound/server exec tsx src/index.ts", url: "http://127.0.0.1:3101/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "VITE_PORT=4173 VITE_DEV_SERVER_TARGET=http://127.0.0.1:3101 corepack pnpm --filter @robot-rebound/client exec vite --host 127.0.0.1", url: "http://127.0.0.1:4173", reuseExistingServer: false, timeout: 60_000 }
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
