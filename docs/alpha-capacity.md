# Alpha capacity

How the alpha release holds up under dozens of players (#132), what to watch, and where it stops coping. Measured on 2026-11-03 against the release image (`docker build -t mua .`), using `main.edl`.

## Running it

```sh
docker build -t mua .
cd packages/mua_client
bun run load                                   # 50 players, 4 minutes, ~2 s between commands
bun run load --players 150 --seconds 110 --think 1000 --out result.json
```

[`load/load.ts`](../packages/mua_client/load/load.ts) starts a scratch container from the image on a new volume (`--image`, default `mua`; port `--port`, default 4400). It sets `MUA_LOAD_TEST=true`, which is the only way `MuaServer.Release.load_players/1` will make the players. That command skips the allowlist, so never set the variable on the alpha. The script plays, prints a JSON report, deletes the container and its volume (`--keep` leaves them), and exits non-zero if any check fails.

## The workload

Each simulated player has its own WebSocket and joins its Character's Channel, as the browser client does (`phoenix` package). It then repeats: wait a random 0.5× to 1.5× `--think`, send one `command`, and wait for the reply. Commands are mostly what the player's `state.actions` offers, which means moving through exits, taking what is in view, and examining or dropping what it carries. The rest are 15% `say …`, 5% `look`, 5% `open mailbox`, and 10% `take leaflet` / `take key`. There are very few takeable things, so most takes fail inside the game. Those still count as acknowledged Steps.

All players start West of House and spread over the house and the garden. Hollis the gardener (an NPC) runs on his 45-second `potter` timer, and the garden rooms' 600-second `reset` timers keep running. Player 1 walks to the Garden Path and stays there to watch Hollis.

### Checks

- **Latency:** from `push` to the `ok` reply, which arrives after the command's Step has committed. Measured per command and per verb as p50, p95, p99 and max. A reply that takes more than 10 s counts as a failure.
- **Persistence:** after play, the script notes each Character's room and inventory from its last `state`. Then it runs `docker kill` (a crash, not a clean stop), starts the container again, rejoins every Character and compares. Every Character must match.
- **Timers:** the gap between Hollis's moves as the watcher sees them must be 45 ± 5 s. Also, World time from `/health`, sampled every 5 s, must advance at the wall-clock rate ± 2%. This check only runs on runs of 100 s or longer.
- **Recovery:** the time from `docker start` to `/health` returning `200`.

## Results

Apple M5 host with Docker Desktop (10 CPUs, 8 GB for the VM). Client and server ran on the same machine.

| Players | Think   | Cmds/s   | p50       | p95       | p99       | Max        | Failed         | Persisted | Timers                    |
| ------- | ------- | -------- | --------- | --------- | --------- | ---------- | -------------- | --------- | ------------------------- |
| **50**  | **2 s** | **24.6** | **11 ms** | **27 ms** | **41 ms** | **164 ms** | **0**          | **50/50** | **45.1 s ×4, rate 1.001** |
| 100     | 2 s     | 47.6     | 14 ms     | 179 ms    | 822 ms    | 1.3 s      | 0              | 100/100   | 45.1 s, rate 1.006        |
| 100     | 1 s     | 80.2     | 80 ms     | 753 ms    | 1.0 s     | 1.8 s      | 0              | 100/100   | 44.4 s, rate 1.007        |
| 150     | 2 s     | 62.7     | 147 ms    | 994 ms    | 2.1 s     | 3.6 s      | 0              | 150/150   | 45.0 s, rate 1.012        |
| 200     | 0.5 s   | 66.6     | 2.2 s     | 3.2 s     | 7.6 s     | 10 s       | 71 timeouts    | 200/200   | 47.8 s, rate 1.027        |
| 400     | 2 s     | 0.7      | 8.7 s     | 9.9 s     | 14.8 s    | 14.8 s     | 3,542 timeouts | 400/400   | not seen                  |

Recovery after the kill took 1.0 to 1.5 s in every run. No acknowledged change was ever lost, including on the overloaded runs.

The 50-player alpha workload (the bold row) passes with plenty of room to spare.

## Operational thresholds

Set alerts on these, from the logs (`docs/operations.md`) and `/health`:

| Signal                               | Healthy                     | Act when                                                     |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------ |
| `slow_step` warnings (Step ≥ 500 ms) | none                        | any sustained run of them: the World is near saturation      |
| Command p95 (if measured)            | < 100 ms                    | > 500 ms                                                     |
| `/health` response                   | < 100 ms, `200`             | a `503`, or slow responses: the World's mailbox is backed up |
| `/health` `world_time`               | advances at wall-clock rate | falls behind by more than 2%: timers will run late           |
| `in_play`                            | ≤ 100                       | over 100 with active players                                 |
| `commit_failed`                      | never                       | any                                                          |

## Known capacity limits

- **One World process runs every Step.** It handled about 60–80 commands/s on this host. Below that, latency stays in tens of milliseconds. Above it, latency grows with the queue. So 100 players typing every 2 s is the comfortable ceiling, and 150 still works but is sluggish (p95 ≈ 1 s).
- **No load shedding.** If commands arrive faster than the World can run them, they queue in its mailbox. The Channel gives up after 10 s, but the World still runs the abandoned calls, so the backlog never drains. At 400 players, joining alone took longer than the client timeouts, and almost nothing was acknowledged for the whole run. Nothing persisted was lost, but the server effectively stopped responding until the load went away. Before the alpha grows past about 100 players, it needs admission control or a queue bound (refuse with `busy` instead of queueing).
- **Shared rooms cost more.** Every command pushes a fresh `state` to its player, and `say` and movement reach everyone in the room. The workload crowds players into 10 rooms, which makes this worse than real play would be.
- **Timers share the queue.** Hollis's timer stayed within a second of its schedule up to 150 players. At 200 players it ran almost 3 s late, and World time ran 2.7% fast (it catches up in jumps once ticks get through). At 400 players his moves never reached a watcher at all.
- **Not measured:** a separate client host, TLS through `tailscale serve`, a host smaller than the M5, or sessions longer than 4 minutes, where the database grows. Re-run `bun run load` on `almere` (#134) before inviting players.
