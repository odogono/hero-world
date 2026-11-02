# Mua runs entirely on Elixir, retaining EDL and NorthTalk

The target Mua server runs entirely on Elixir: it owns connections, identity, the authoritative World and gameplay execution. ECS and EDL support will be ported to Elixir, and NorthTalk will use its existing embedding facilities. An Elixir gateway around a Bun simulation does not satisfy this decision; the server must have no Bun runtime dependency.

EDL and NorthTalk remain the world-authoring model, preserving their agreed observable gameplay semantics. This keeps the authored worlds and behaviours useful across the runtime change instead of combining the port with a redesign of the authoring languages.

ECS and EDL remain reusable libraries, with Mua as their first Elixir consumer. Preserve their domain semantics and separation while allowing idiomatic Elixir interfaces. General embedding features missing from NorthTalk belong upstream in NorthTalk; Hero World owns the ECS-specific Host Adapter, including entity lookup, component access, Lineage and world operations.

The Elixir ECS retains SQLite for World storage initially. The existing query and EDL record implementation depends deeply on SQLite, and retaining it avoids a simultaneous database redesign. Its single-writer model fits the initial World authority in ADR 0011; this does not require preserving the current table layout or TypeScript interfaces.

## Consequences

- Existing authored content and behaviour tests provide acceptance cases for the port.
- The transition may start with a freshly built World; importing existing SQLite saves is not required. Persistence and the agreed content Migration semantics remain requirements for the new server, including the protections for live edits in ADR 0008.
- The browser client will use Preact, with typed commands central and room, inventory and available-action panels as supplements.
- The Elixir libraries/server and browser client stay in this repository with independent build and CI paths: Mix for Elixir and Node-based tooling for Preact. Building, testing and deploying the new application must not require Bun. The TypeScript implementation remains temporarily as reference and can be retired after demonstrated parity.
- The Elixir ECS interface, SQLite integration and NorthTalk host adapter still need detailed design decisions. Initial World ownership is recorded in ADR 0011. This ADR records the destination, not a completed implementation.
