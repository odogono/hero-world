# EDL files include base EDL by named root

The Base Verbs move into `packages/mua-scripts/` (ADR 0024), so each World needs a way to pick them up. EDL gains an `include`. A World's `main.edl` names what it includes, for example `include "mua-scripts:edl/base.edl"`. The Host resolves a named root such as `mua-scripts:` from configuration (`MUA_SCRIPTS_DIR`), and resolves a plain path from the directory of the including file. Included entities enter the World at migration exactly as if written inline. A file included twice is loaded once. A World that declares an entity label the base already uses fails to migrate, and a World overrides Base Verbs only through Verb precedence, where World forms are tried first.

## Considered Options

- **The Host migrates base EDL before every World.** Rejected: what a World contains would depend on Host behaviour rather than on its own EDL.
- **The Host reads base EDL as a read-only vocabulary.** Rejected: Verbs are World data, and keeping them outside the store breaks the existing override precedence.

## Consequences

- Both EDL implementations must support `include` and named roots before a Local World can load the Base Verbs.
- Every World's EDL, including test fixtures, must include the base explicitly.
