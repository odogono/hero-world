/* eslint-disable no-console -- a command-line script reports on stdout */
/**
 * The alpha under dozens of players (#132): drives simulated players over
 * real Phoenix Channels against a release image, then checks what it
 * measured. See `docs/alpha-capacity.md` for the workload and the results.
 *
 *   docker build -t mua .
 *   bun run load                      # 50 players for 4 minutes
 *   bun run load --players 100 --seconds 120 --think 500
 *
 * It starts a scratch container from the image on a fresh volume, makes the
 * players with `MuaServer.Release.load_players`, plays, then kills the
 * container and starts it again to check every acknowledged change
 * survived. It exits non-zero if a check fails.
 */
import { parseArgs } from 'node:util';

import { Socket, type Channel } from 'phoenix';

const { values: args } = parseArgs({
  options: {
    image: { default: 'mua', type: 'string' },
    keep: { default: false, type: 'boolean' },
    out: { type: 'string' },
    players: { default: '50', type: 'string' },
    port: { default: '4400', type: 'string' },
    seconds: { default: '240', type: 'string' },
    think: { default: '2000', type: 'string' }
  }
});

const players = Number(args.players);
const seconds = Number(args.seconds);
const think = Number(args.think);
const port = Number(args.port);
const base = `http://localhost:${port}`;
const name = `mua-load-${process.pid}`;

// The gardener potters every 45 seconds of World time (gardener.talk)
const POTTER_S = 45;
const REPLY_TIMEOUT_MS = 10_000;

type View = {
  actions: string[];
  inventory: string[];
  room: { exits: string[]; items: string[]; name: string; players: string[] };
};
type Sample = { ms: number; verb: string };

// ---------------------------------------------------------------------------
// The container
// ---------------------------------------------------------------------------

const docker = async (...cmd: string[]) => {
  const proc = Bun.spawn(['docker', ...cmd], {
    stderr: 'pipe',
    stdout: 'pipe'
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);
  if (code !== 0) {
    throw new Error(`docker ${cmd[0]} failed: ${err.trim() || out.trim()}`);
  }
  return out;
};

const start = () =>
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `${port}:4000`,
    '-v',
    `${name}:/data`,
    ...[
      'PHX_HOST=localhost',
      'PHX_SCHEME=http',
      `PHX_URL_PORT=${port}`,
      `SECRET_KEY_BASE=${crypto.randomUUID()}${crypto.randomUUID()}${crypto.randomUUID()}`,
      'GOOGLE_CLIENT_ID=load',
      'GOOGLE_CLIENT_SECRET=load',
      'MUA_STARTING_ROOM=west_of_house',
      'MUA_LOAD_TEST=true'
    ].flatMap(e => ['-e', e]),
    args.image
  );

const health = async () => {
  try {
    const res = await fetch(`${base}/health`);
    return res.ok
      ? ((await res.json()) as { in_play: number; world_time: number })
      : undefined;
  } catch {
    return undefined;
  }
};

const healthy = async (within_ms = 120_000) => {
  const until = Date.now() + within_ms;
  while (Date.now() < until) {
    const h = await health();
    if (h) {
      return h;
    }
    await Bun.sleep(500);
  }
  throw new Error(`the server wasn't healthy within ${within_ms} ms`);
};

const cleanup = async () => {
  if (args.keep) {
    console.log(`kept container and volume ${name}`);
    return;
  }
  await docker('rm', '-f', name).catch(() => {});
  await docker('volume', 'rm', name).catch(() => {});
};

// ---------------------------------------------------------------------------
// A simulated player
// ---------------------------------------------------------------------------

const SAYINGS = ['hello', 'anyone here?', 'nice garden', 'where is the key?'];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const jitter = (ms: number) => ms * (0.5 + Math.random());

class Player {
  socket!: Socket;
  channel!: Channel;
  view?: View;
  acked = 0;
  errors: string[] = [];
  heard: { at: number; text: string }[] = [];

  constructor(
    readonly character: number,
    readonly token: string
  ) {}

  join() {
    this.socket = new Socket(`ws://localhost:${port}/socket`, {
      params: { token: this.token },
      reconnectAfterMs: () => 60_000
    });
    this.socket.connect();
    this.channel = this.socket.channel(`character:${this.character}`);
    this.channel.on('state', (view: View) => {
      this.view = view;
    });
    this.channel.on('output', ({ lines }: { lines: string[] }) => {
      const at = Date.now();
      for (const text of lines) {
        this.heard.push({ at, text });
      }
    });
    return new Promise<void>((resolve, reject) => {
      this.channel
        .join(REPLY_TIMEOUT_MS)
        .receive('ok', () => resolve())
        .receive('error', ({ reason }: { reason: string }) =>
          reject(new Error(reason))
        )
        .receive('timeout', () => reject(new Error('join timed out')));
    });
  }

  /** Sends a command; resolves with its latency once acknowledged */
  command(text: string) {
    const sent = performance.now();
    return new Promise<number | undefined>(resolve => {
      this.channel
        .push('command', { text }, REPLY_TIMEOUT_MS)
        .receive('ok', () => {
          this.acked++;
          resolve(performance.now() - sent);
        })
        .receive('error', ({ reason }: { reason: string }) => {
          this.errors.push(`${text}: ${reason}`);
          resolve(undefined);
        })
        .receive('timeout', () => {
          this.errors.push(`${text}: timeout`);
          resolve(undefined);
        });
    });
  }

  /** What a player might type next: mostly what the view offers */
  next() {
    const actions = this.view?.actions ?? [];
    const roll = Math.random();
    if (roll < 0.15) {
      return `say ${pick(SAYINGS)}`;
    }
    if (roll < 0.2) {
      return 'look';
    }
    if (roll < 0.25) {
      return 'open mailbox';
    }
    // the few takeable things are in the mailbox and the well's bucket,
    // which the view doesn't offer
    if (roll < 0.35) {
      return pick(['take leaflet', 'take key']);
    }
    return actions.length > 0 ? pick(actions) : 'look';
  }

  /** What must survive a restart: where the Character is and what it carries */
  saved() {
    return this.view
      ? JSON.stringify({
          inventory: [...this.view.inventory].sort(),
          room: this.view.room.name
        })
      : undefined;
  }

  leave() {
    this.socket.disconnect();
  }
}

const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) {
    return Number.NaN;
  }
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ]!;
};

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const run = async () => {
  console.log(`starting ${name} from image ${args.image} on port ${port}`);
  await start();
  await healthy();

  const made = await docker(
    'exec',
    name,
    'bin/mua_server',
    'rpc',
    `MuaServer.Release.load_players(${players})`
  );
  const line = made
    .trim()
    .split('\n')
    .findLast(l => l.startsWith('['));
  const roster = JSON.parse(line ?? '[]') as {
    character: number;
    token: string;
  }[];
  const bots = roster.map(p => new Player(p.character, p.token));
  await Promise.all(bots.map(b => b.join()));
  console.log(
    `${bots.length} players joined; playing for ${seconds} s, ~${think} ms between commands`
  );

  const samples: Sample[] = [];
  const clock: { wall: number; world: number }[] = [];
  const until = Date.now() + seconds * 1000;
  let running = true;

  const play = async (bot: Player, script: string[] = []) => {
    await Bun.sleep(Math.random() * think);
    while (running && Date.now() < until) {
      const text = script.shift() ?? bot.next();
      const ms = await bot.command(text);
      if (ms !== undefined) {
        samples.push({ ms, verb: text.split(' ')[0]! });
      }
      await Bun.sleep(jitter(think));
    }
  };

  // The first player walks to the Garden Path and stays, watching the
  // gardener come and go on his timer
  const [watcher, ...rest] = bots;
  const watch = async () => {
    for (const dir of ['north', 'east', 'east']) {
      await watcher!.command(dir);
    }
    while (running && Date.now() < until) {
      const ms = await watcher!.command('look');
      if (ms !== undefined) {
        samples.push({ ms, verb: 'look' });
      }
      await Bun.sleep(jitter(think));
    }
  };

  const sampler = (async () => {
    while (running && Date.now() < until) {
      const h = await health();
      if (h) {
        clock.push({ wall: Date.now(), world: h.world_time });
      }
      await Bun.sleep(5000);
    }
  })();

  const t0 = Date.now();
  await Promise.all([watch(), ...rest.map(b => play(b)), sampler]);
  running = false;
  const elapsed = (Date.now() - t0) / 1000;

  // let the last `state` pushes arrive, then note what must persist
  await Bun.sleep(2000);
  const before = new Map(bots.map(b => [b.character, b.saved()]));
  for (const b of bots) {
    b.leave();
  }

  // a crash, not a clean stop: acknowledged means committed
  console.log('killing the server and starting it again');
  await docker('kill', name);
  await docker('start', name);
  const restarted = Date.now();
  await healthy();
  const recovery_s = (Date.now() - restarted) / 1000;

  const after = bots.map(b => new Player(b.character, b.token));
  await Promise.all(after.map(b => b.join()));
  // each rejoin is followed by a `state`; a Character seen in neither run
  // can't be checked
  const seen = Date.now() + 30_000;
  while (after.some(b => !b.view) && Date.now() < seen) {
    await Bun.sleep(250);
  }
  const checkable = after.filter(b => b.saved() && before.get(b.character));
  const lost = checkable
    .filter(b => b.saved() !== before.get(b.character))
    .map(b => ({
      after: b.saved(),
      before: before.get(b.character),
      character: b.character
    }));
  for (const b of after) {
    b.leave();
  }

  // the gardener's moves, as the watcher saw them
  const moves = watcher!.heard
    .filter(h => /^Hollis (arrives|goes)/.test(h.text))
    .map(h => h.at);
  const intervals = moves.slice(1).map((at, i) => (at - moves[i]!) / 1000);
  const first = clock[0];
  const last = clock.at(-1);
  const rate =
    first && last && last.wall > first.wall
      ? (last.world - first.world) / (last.wall - first.wall)
      : Number.NaN;

  const all = samples.map(s => s.ms);
  const verbs = Object.groupBy(samples, s => s.verb);
  const errors = bots.flatMap(b => b.errors);
  const acked = bots.reduce((n, b) => n + b.acked, 0);

  // the watcher needs a couple of the gardener's moves to time
  const timersChecked = elapsed >= 2 * POTTER_S + 10;
  const timersOk =
    !timersChecked ||
    (intervals.length > 0 &&
      intervals.every(s => Math.abs(s - POTTER_S) <= 5) &&
      Math.abs(rate - 1) < 0.02);
  const report = {
    acked,
    by_verb: Object.fromEntries(
      Object.entries(verbs).map(([verb, s]) => {
        const ms = s!.map(x => x.ms);
        return [
          verb,
          { n: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95) }
        ];
      })
    ),
    commands_per_s: acked / elapsed,
    error_examples: errors.slice(0, 10),
    errors: errors.length,
    latency_ms: {
      max: Math.max(...all),
      p50: percentile(all, 50),
      p95: percentile(all, 95),
      p99: percentile(all, 99)
    },
    persistence: {
      checked: checkable.length,
      lost,
      unchecked: after.length - checkable.length
    },
    players: bots.length,
    recovery_s,
    seconds: elapsed,
    think_ms: think,
    timers: {
      checked: timersChecked,
      gardener_intervals_s: intervals,
      world_time_rate: rate
    }
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.out) {
    await Bun.write(args.out, JSON.stringify(report, null, 2));
  }

  const failed = [
    lost.length > 0 && `${lost.length} Characters lost acknowledged changes`,
    checkable.length < after.length &&
      `${after.length - checkable.length} Characters couldn't be checked`,
    errors.length > 0 && `${errors.length} commands failed`,
    !timersOk && 'timers ran off schedule'
  ].filter(Boolean);
  console.log(failed.length === 0 ? 'PASS' : `FAIL: ${failed.join('; ')}`);
  return failed.length === 0;
};

let ok = false;
try {
  ok = await run();
} catch (error) {
  console.error(error);
} finally {
  await cleanup();
}
process.exit(ok ? 0 : 1);
