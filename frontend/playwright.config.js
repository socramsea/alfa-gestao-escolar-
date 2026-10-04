import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0, timeout: 60000,
  outputDir: process.env.E2E_ARTIFACTS || '/tmp/alfa-e2e-artifacts',
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL, headless: true,
    screenshot: 'off', trace: 'off', video: 'off',
    launchOptions: { executablePath: process.env.E2E_BROWSER_EXECUTABLE || undefined, chromiumSandbox: true } }
});
