# A Script's timers belong to the entity its Run was delivered to

NorthTalk scopes a durable timer (`tell timer to schedule`) to the Script that set it, but in ecs-talk one atom's Script serves every entity built from that atom, so two guards sharing a Script would overwrite each other's `"patrol"` timer. A timer instead belongs to the Receiver of the Host Delivery that started the setting Run, found through `Call.delivery` (odgn-talk ADR 0125): names are scoped to that entity and the Script, and the message is delivered back to it. A Run started by a Script's own `send` has no Delivery, so it can't set a timer.

## Considered Options

- **Scope by Script, as the spec says:** simplest, but makes timers useless for anything shared by several entities, which is most behaviours.
- **An explicit owner on a `world` operation** (`schedule thing, name, …`): unambiguous, but non-standard, so Scripts couldn't use the `timer` Capability.
