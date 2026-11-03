# Running the alpha

What an operator does with the release image ([README](../README.md#the-release-image)): watching it, backing it up, changing its content or release, and restoring it. The World is one SQLite database, `/data/world.db` in the image, and only the World process writes it while it runs ([ADR 0015](../../../docs/adr/0015-the-world-process-drives-northtalk-and-commits-once-per-step.md)).

## Watching it

- **`GET /health`** answers `200 {"status": "ok", "world_time": …, "in_play": …}` while the World answers, and `503 {"status": "unavailable"}` while it doesn't, as during a restart. Point a monitor at it.
- **Logs** (`docker logs mua`) are one line per event, tagged `event=…`:

| Event | Level | Means |
| --- | --- | --- |
| `world_started` | info | The World was `built` from its EDL (first start) or `resumed`, at what World time, and how many waiting commands a restart abandoned (ADR 0014). After a crash, this line is the recovery. |
| `world_not_started` | error | The World won't start, for example because the EDL changed and the World needs a Migration. The server stops after a few attempts: fix the cause (here, run the maintenance procedure), then start it again. |
| `commit_failed` | error | A Step's commit failed. The World stops and restarts from its last commit; nobody was told of the lost Step (ADR 0012). |
| `slow_step` | warning | A Step took longer than `slow_step_ms` (500 ms). |
| `backup` / `backup_failed` | info / error | An online backup finished, or didn't. |

- **Telemetry:** the World emits `[:mua_world, :start]`, `[:mua_world, :step, :stop]` (with `duration`), `[:mua_world, :commit, :error]` and `[:mua_world, :backup]` for anything that wants numbers rather than lines.

## Backing it up

While it runs:

```sh
docker exec mua bin/mua_server rpc 'MuaServer.Release.backup()'
```

The World writes the copy between Steps with SQLite's `VACUUM INTO`, so it holds every committed Step and nothing half-done, and play carries on. By default it goes to `/data/backups/world-<time>.db`; pass a path to choose another. Copy backups off the machine; a backup on the World's own volume doesn't survive losing the volume.

## Changing the content or the release

A World built from one EDL won't start on another until it is migrated ([ADR 0005](../../../docs/adr/0005-a-changed-edl-migrates-a-world-keeping-play-state.md)), so a release that changes the EDL needs the maintenance procedure. Brief downtime is expected.

```sh
docker build -t mua:next .
CONTAINER=mua IMAGE=mua:next ENV_FILE=mua.env packages/mua_server/rel/maintain.sh
```

[`rel/maintain.sh`](../rel/maintain.sh):

1. Stops the container.
2. Backs the World up (`/data/backups/…`), then prints what the Migration to `IMAGE`'s EDL would change, changing nothing.
3. Asks before applying it.
4. Migrates, then starts the old container again. If `IMAGE` is a new image, it prints the command to replace the container instead.

If anything fails, the World stays stopped and the backup stays where it was written. The same steps by hand, with the World stopped:

```sh
docker run --rm --volumes-from mua --env-file mua.env mua:next bin/mua_server eval 'MuaServer.Release.maintain(dry_run: true)'
docker run --rm --volumes-from mua --env-file mua.env mua:next bin/mua_server eval 'MuaServer.Release.migrate()'
```

Pass `prune: true` to `migrate` to move things gone from the EDL to Limbo; without it they are only listed. A Migration keeps Characters, inventories, World time, timers and any component changed during play (ADR 0008).

A release that doesn't change the EDL needs no Migration: stop, back up, replace the container, start.

## Restoring

Restore into a clean instance, never over a World:

```sh
docker volume create mua-restored
docker run --rm -v mua-restored:/data -v "$PWD/backups:/backups" --env-file mua.env mua \
  bin/mua_server eval 'MuaServer.Release.restore("/backups/world-<time>.db")'
docker run -d --name mua-restored -p 4001:4000 -v mua-restored:/data --env-file mua.env mua
```

The backup's integrity is checked first. The restored World resumes with its Characters, inventories, World time and timers as they were at the backup. Check them by signing in, then swap it in for the old container.
