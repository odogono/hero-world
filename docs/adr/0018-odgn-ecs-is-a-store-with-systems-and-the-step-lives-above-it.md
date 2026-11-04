# odgn_ecs is a store with Systems, and the Step lives above it

`odgn_ecs` is a store of entities, components, queries and transactions, plus Systems, as the TypeScript ecs already has. It still has no processes and keeps no clock. A System is a query, an interval and a function. The caller asks which Systems are due at a World time it supplies, and runs them inside its own Step. The engine (Step, Delivery, World time and timers) belongs to a layer above the store, so that another NorthTalk-driven game can reuse it without mua's commands. Until that layer has a second consumer, it may stay inside mua, as #152 left it.

## Considered Options

- **Move the whole engine into `odgn_ecs`**, including the Step and World time. Rejected: it would tie the store to one execution model and to NorthTalk.
- **Keep Systems out of `odgn_ecs`.** Rejected: Systems are a core ECS idea, the TypeScript ecs already has them, and parity is simpler when both libraries have the same shape.

## Consequences

- Features that consumers keep writing by hand on top of the store belong in it: query results with component data, a small fixed set of `where` operators with `order_by` and `limit`, and indexed Reference columns. Scheduling, queues and Delivery do not.
- Two execution models may sit above the store: Steps driven by Deliveries (mua's), and Systems. When a game uses both, each run of a System is a Step input like a command or a due timer, so it commits once and is ordered by the single writer (ADR 0011, ADR 0012).
- Change tracking, meaning which components a transaction changed, is a store capability, because a client mirror needs it whatever drives the World.
