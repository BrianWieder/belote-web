import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 3 : undefined,
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev -- --port 5173',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm start',
      port: 3001,
      cwd: '../server',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
