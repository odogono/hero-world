# Systems schedule, and Scripts decide

mua uses Systems, but a System doesn't carry behaviour. It selects entities by query at its own interval of World time and gives each one a Delivery, which the entity's Scripts handle. An `npc_heartbeat` System, for example, delivers `heartbeat` to every NPC every 45 s, and each NPC's Scripts decide what to do. This replaces each NPC rescheduling its own timer, which costs one timer and one reschedule per NPC, while behaviour stays authored in NorthTalk and inherited through Lineage.

A System may change an entity's own internal state directly, such as hunger falling or a torch burning down. This is bookkeeping. Anything with a witness or a possible Veto is an action, and goes through commands as ADR 0003 requires, or through a Delivery to the entity's Scripts.

## Consequences

- Each run of a System is one Step (ADR 0015): it commits once and is ordered by the single writer. Intervals count World time, so Systems pause while the server is down, as timers do.
- A slow System is fixed by batching inside it, not by splitting its run across several commits.
- Systems are needed in Elixir, so they join the parity scope (ADR 0019). Events stay TypeScript-only.
