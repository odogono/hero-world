import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ],
  reporter: 'html',
  retries: process.env.CI ? 2 : 0,
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry'
  },

  webServer: [
    {
      command: 'bun run dev:server',
      port: 3001,
      reuseExistingServer: !process.env.CI
    },
    {
      command: 'bun run dev',
      port: 5173,
      reuseExistingServer: !process.env.CI
    }
  ],

  workers: process.env.CI ? 1 : undefined
});
