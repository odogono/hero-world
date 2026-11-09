import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

// The real server and World, on a fresh database each run: one server per
// fixture World, each with its own project
const run = join(tmpdir(), `mua-e2e-${Date.now()}`);

const worlds = [
  {
    edl: 'plaza.edl',
    name: 'plaza',
    port: 4100,
    start: 'plaza',
    test: /\/(journey|mirror|offline)\.spec\.ts$/
  },
  { edl: 'manor.edl', name: 'manor', port: 4101, start: 'hall', test: /manor/ }
];

const url = (port: number) => `http://localhost:${port}`;

export default defineConfig({
  fullyParallel: false,
  projects: worlds.map(world => ({
    name: world.name,
    testMatch: world.test,
    use: { baseURL: url(world.port) }
  })),
  reporter: process.env.CI ? 'github' : 'list',
  retries: 0,
  testDir: 'e2e',
  timeout: 60_000,
  webServer: worlds.map(world => ({
    command: 'mix phx.server',
    cwd: resolve(import.meta.dirname, '../mua_server'),
    env: {
      DATABASE_PATH: join(run, world.name, 'world.db'),
      MIX_ENV: 'dev',
      MUA_ADMINS: 'ada@example.com',
      MUA_ALLOWLIST: 'ada@example.com,bob@example.com',
      MUA_EDL: resolve(import.meta.dirname, 'e2e/fixtures', world.edl),
      MUA_STARTING_ROOM: world.start,
      PORT: String(world.port)
    },
    reuseExistingServer: false,
    timeout: 180_000,
    url: `${url(world.port)}/`
  })),
  workers: 1
});
