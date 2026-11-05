# mua-scripts

The game rules every mua World shares, as data: no code of either Host lives here (ADR 0024). Both Hosts, the Elixir server and a Local World's TypeScript Worker, load it.

- `edl/base.edl`: the Base Verbs. A World's EDL includes it with `include "mua-scripts:edl/base.edl"` (ADR 0025).
- `scripts/services/`: the Service Scripts, which belong to no entity and carry out an Action for every World.
- `scripts/lib/`: the Libraries those Scripts use.

The Elixir Host finds this directory from `MUA_SCRIPTS_DIR`, and defaults to its place in the repository. The release image copies it to `/app/mua-scripts`.
