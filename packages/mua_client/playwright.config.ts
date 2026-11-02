import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

// The real server and World, on a fresh database each run
const PORT = 4100;
const db = join(tmpdir(), `mua-e2e-${Date.now()}`, 'world.db');

export default defineConfig({
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  retries: 0,
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: 'mix phx.server',
    cwd: resolve(import.meta.dirname, '../mua_server'),
    env: {
      MIX_ENV: 'dev',
      MUA_ALLOWLIST: 'ada@example.com,bob@example.com',
      MUA_DB: db,
      MUA_EDL: resolve(import.meta.dirname, 'e2e/fixtures/plaza.edl'),
      MUA_STARTING_ROOM: 'plaza',
      PORT: String(PORT)
    },
    reuseExistingServer: false,
    timeout: 180_000,
    url: `http://localhost:${PORT}/`
  }
});
