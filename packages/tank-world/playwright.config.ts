import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173'
  },
  webServer: [
    {
      command: 'bun run start:server',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 60_000
    },
    {
      command: 'VITE_WS_URL=ws://127.0.0.1:3001/ws bun run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000
    }
  ]
});
