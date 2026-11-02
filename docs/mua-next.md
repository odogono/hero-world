# Mua: Elixir server and Preact browser

Agreed roadmap from the design interview. The destination, player-facing guarantees and delivery sequence are settled. Implementation has not started; the first integration proof will determine the detailed engineering design.

## Implementation tickets

Published in `odogono/hero-world` with native blocking relationships. Tickets 95 and 91 are `ready-for-human` because they need design decisions; the rest are `ready-for-agent`. Ticket 95 also needs upstream changes in `odogono/odgn-talk`.

| Ticket | Blocked by |
| --- | --- |
| [95: Decide NorthTalk embedding surfaces and the Elixir World process model](https://github.com/odogono/hero-world/issues/95) | None |
| [102: Prove an Elixir World with a minimal Host Adapter](https://github.com/odogono/hero-world/issues/102) | 95 |
| [96: Port ECS and EDL to reusable Elixir libraries](https://github.com/odogono/hero-world/issues/96) | 102 |
| [103: Port Mua gameplay to Elixir](https://github.com/odogono/hero-world/issues/103) | 96 |
| [97: Phoenix sign-in, sessions and the browser protocol](https://github.com/odogono/hero-world/issues/97) | 102 |
| [104: Build the Preact browser client](https://github.com/odogono/hero-world/issues/104) | 97, 103 |
| [98: Bring scripted interactions and NPCs to the browser](https://github.com/odogono/hero-world/issues/98) | 104 |
| [99: Make sessions and reconnects reliable](https://github.com/odogono/hero-world/issues/99) | 104 |
| [100: Update authored content without losing play](https://github.com/odogono/hero-world/issues/100) | 103 |
| [91: Run NorthTalk at an admin prompt](https://github.com/odogono/hero-world/issues/91) | 104, 100 |
| [101: Deploy and validate the invite-only alpha](https://github.com/odogono/hero-world/issues/101) | 98, 99, 100, 91 |

The Phoenix work (97) runs in parallel with the ECS/EDL and gameplay ports (96, 103) because it only needs the proof's tiny World.

## TypeScript backlog

- #85 (extract the ECS into its own repo) is closed: the Elixir libraries stay here.
- #84 and #89 are parked; they only improve TypeScript code that will be retired.
- #90 is still worth finishing in TypeScript: it pins down ADR 0008's kept-component behaviour, and its tests become acceptance cases for #100.

## Settled direction

- The entire server runs on Elixir, with no Bun runtime dependency (ADR 0009).
- Port ECS and EDL support and integrate the existing NorthTalk embedding facilities. Preserve authored content and agreed gameplay semantics.
- Keep ECS and EDL as reusable libraries with idiomatic Elixir interfaces. Complete general embedding features upstream in NorthTalk; implement the ECS Host Adapter in Hero World.
- Existing save files do not need importing. The new World must persist and retain content Migration guarantees, including preservation of live edits (ADR 0008).
- Use Google sign-in instead of passwords (ADR 0010).
- Separate Account from Character, with one Character per Account initially and a chosen public Character name. The first deployment admits only explicitly allowlisted identities.
- Start with one persistent shared World on one server node, targeting dozens of simultaneous players. One authority orders World changes; distributing a World is deferred pending measurement (ADR 0011).
- Retain SQLite for World storage initially (ADR 0009).
- Build a Preact browser client centred on typed commands, with supplementary room, inventory and available-action panels.
- Use Phoenix for HTTP, Google sign-in integration, browser sessions and WebSocket Channels. ECS and gameplay remain independent of Phoenix (ADR 0013).
- Keep the Elixir libraries/server and Preact client in this repository with independent build and CI paths. Use Mix for Elixir and Node-based tooling for Preact. Building, testing and deploying the new application must not require Bun. Keep the TypeScript implementation temporarily as reference. Parity means the adapted fixture and behaviour tests pass in Elixir and the first playable milestone passes; then delete the TypeScript `mua` package. `odgn-ecs` stays while tank-world uses it.
- Admins edit the live World by typing NorthTalk at a prompt in the browser (#91); this is part of the alpha.

## Session and recovery guarantees

- A Character has one controlling connection. A new connection replaces the old one, revokes its command authority and tells it that the Character is connected elsewhere. Taking over does not cause departure and arrival in the World.
- Unexpected disconnection leaves the Character in the World for 30 seconds, subject to normal World rules. Reconnection during that interval resumes control. After the interval, the Character enters Limbo; explicit logout enters Limbo immediately.
- Returning from Limbo restores the previous room, falling back to the World's configured starting room if it is unavailable. Require a valid starting room at startup and validate it during content Migration.
- World time advances while the server runs, including when no players are connected. It pauses during server downtime; restart does not replay elapsed downtime as missed NPC activity.
- Each World change is durably committed before its success is published (ADR 0012). This applies to committed steps, not an entire long-running Script. Delivery can still be interrupted after commit.
- A restart keeps timers, which are World data, and abandons Scripts that were waiting (ADR 0014). An abandoned Script keeps its committed steps, runs nothing further and is not restarted, and the affected Character is told. A command whose reply was lost remains unconfirmed to the browser unless the server can establish its outcome. Restoring waiting Scripts is deferred until content needs it.
- Reconnect automatically and fetch a fresh room, inventory and available-action view. Retain the browser's existing transcript through brief interruptions and mark gaps; complete replay and durable cross-device or reload history are deferred.
- Never automatically resubmit gameplay commands whose outcomes are uncertain. Mark them unconfirmed and refresh state; durable command receipts and safe automatic retries are deferred (ADR 0013).

## Initial deployment

One application instance runs on a server with persistent local storage and HTTPS. Keep SQLite backups and test restoration. Brief maintenance downtime is acceptable: stop the World for releases and EDL Migrations. Rolling deployments and live Migrations are deferred. Select a hosting provider once the release requirements are known.

## First playable milestone

Two browser players can sign in, meet, talk, move, interact with the same item, disconnect and return. World state survives a server restart. Competing attempts to take the same item produce one consistent outcome.

## Delivery sequence

### 1. Prove the Elixir World and NorthTalk integration (95, 102)

First decide, with a human in the loop, the upstream NorthTalk surfaces (Host Objects, properties, collections, Decisions) and the World's process model and transaction boundaries (95). Then create a tiny Elixir World that exercises entity access from NorthTalk, a Veto, a committed change, a timer and a forced restart (102). Implement only the ECS surface needed for this example. Demonstrate that callbacks can access the World without circular waits, that published success survives a restart, that timers resume from the World, and that a Script waiting at the restart is abandoned without repeating committed effects. Establish the independent Mix build and test path here, and a minimal command entry point the Phoenix work can drive.

Exit condition: executable tests establish these behaviours, and the process model and transaction boundaries are recorded before the port expands. If the embedding cannot meet the accepted guarantees, resolve that limitation here rather than weakening them silently.

### 2. Port the reusable ECS and EDL libraries (96)

Implement entity/component storage and queries, committed changes and rollback, EDL parsing and resolution, Atoms and Lineage, Definition names, and Build/Migration semantics. Use current fixture worlds and behaviour tests as acceptance cases, adapting them to Elixir rather than translating TypeScript APIs mechanically.

Exit condition: existing authored fixtures build correctly; migrations preserve player changes and live edits under ADRs 0006–0008; rollback and restart behaviour agree with the integration proof. Importing existing save files is not required.

### 3. Port Mua gameplay and lifecycle (103, then 100 and 91)

Implement command parsing, scope binding, dispatch, Vetoes, Service Scripts, NPC commands, output routing, timers and the World clock. Add Account/Character ownership and the gameplay side of entering, leaving, Limbo and returning. Keep Phoenix concerns outside these modules.

Exit condition: two simulated Characters can meet, talk, move and compete for one item with a consistent result. Script behaviour, time, disconnect lifecycle and persistence meet the accepted rules. Returning to a missing room uses the configured starting room, and startup/Migration rejects an invalid starting-room configuration.

### 4. Add Phoenix identity, sessions and the browser protocol (97, then 99)

This starts after stage 1 and runs alongside stages 2 and 3, developed against the proof's tiny World.

Integrate Google sign-in, allowlist admission, Account/Character binding, and authenticated Channels. Specify and validate command, output, prompt, snapshot and connection-status messages. Implement single-connection takeover, the 30-second grace period and reconnect snapshots. Ensure replacement of a connection cannot let a stale connection issue commands or move the active Character to Limbo when it closes.

Exit condition: authenticated clients exercise admission, takeover and reconnect; an interrupted command is not automatically resubmitted. State-confirming output is sent only after its change is durable.

### 5. Build the Preact browser client (104, then 98)

Build sign-in and Character entry, command input and transcript, room and inventory panels, and available actions. Use an independent Node-based build and test path. Show connection status, transcript gaps and unconfirmed command outcomes. Recover views from fresh server state after reconnect. Prevent transport buffering from silently turning offline commands into later gameplay actions.

Exit condition: two real browser clients complete the first playable milestone, including refresh, connection loss, takeover and server restart.

### 6. Package and validate the invite-only alpha (101)

Add Elixir and browser CI checks, reproducible release packaging, HTTPS deployment, persistent storage, backups and a tested restore procedure. Provide a documented stop/back-up/migrate/start maintenance procedure. Measure the representative World with dozens of simulated players and observe command latency, persistence and timer behaviour before inviting players.

Exit condition: the deployed release passes the multiplayer journey and recovery checks, restores from backup, and has measured capacity for the intended alpha. Choose hosting and concrete operational thresholds at this stage.

## Engineering decisions to resolve during delivery

Detailed library interfaces, process ownership, schema, snapshot strategy and wire formats are engineering outputs of the stages above. They are not assumed to be settled by this roadmap. Record consequential choices when the integration evidence is available.

## Integration findings

Source inspection of the local NorthTalk checkout found an existing `impl/elixir` package, `:north_talk`, embedding the Zig WASI reactor through Wasmex without Bun. It supplies manual driving, capabilities, segment transaction hooks and save/restore. Its README and implementation currently exclude Host Objects, properties and collections, and its public API does not expose Decisions. Mua's existing entity handles and vetoes depend on these features. Reactor v0.18.0, which the Elixir package now pins, already supports all of them, so the gap is in the Elixir wrapper only; it is requested in odogono/odgn-talk#1970. ADR 0015 records the process model and transaction boundary that follow from how the owner runs callbacks.

The current Mua HTTP authentication plugin verifies Google tokens, but gameplay WebSockets still use passwords and have no Google identity-to-player binding. The new browser sign-in and game session flow therefore requires integration work.

NorthTalk's Elixir callbacks and Segment hooks run in monitored Tasks while the Instance Owner waits for immediate results. The World authority must not block waiting for Script execution while a callback waits on that same authority. Group saves exclude the external ECS database, cannot be taken during a live Scope or Segment participant, and require callback bindings to be restored. This is why ADR 0014 recovers timers from the World and abandons waiting Scripts instead of restoring NorthTalk saves alongside the database.

The repository currently has no Elixir/Phoenix project, Preact browser app or deployment configuration. Its workspace and CI run Bun/TypeScript checks. Elixir validation, browser builds and production release packaging must be added as part of the new implementation.

These are source-inspection findings, not runtime validation.
