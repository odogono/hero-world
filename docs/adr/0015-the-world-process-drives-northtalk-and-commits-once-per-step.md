# The World process drives NorthTalk and commits once per step

One World process owns the SQLite write connection and the World's NorthTalk instance, which it runs in manual mode by calling `pump` itself. Commands from Phoenix and due timers enter through this process one at a time. Script callbacks use the write connection directly, through their Capability's binding, and never send messages to the World process.

NorthTalk's Elixir owner runs one exchange at a time. During an immediate callback it waits for the callback's Task, for up to the Capability's timeout. The World process is blocked inside `pump` for that whole time, so there is only ever one writer and no wait cycle. The alternative was for callbacks to message the World process. The World process could then no longer call `pump` and wait for the result: it would have to drive NorthTalk asynchronously and juggle replies, and under load it would be exposed to the 5 s callback timeout.

Each Segment is a SQLite `SAVEPOINT`, rolled back when the Segment rolls back and released when it commits. Each step ends with one `COMMIT`. Output produced during the step is held until that commit, and output from a Segment that rolls back is dropped. The committed step in ADR 0012 is therefore one step. A crash during a step loses only changes that no player was told about. A commit per Segment was the alternative: it means more disk syncs and output published in smaller pieces, without being any safer.

## Consequences

- Component properties are read-only to Scripts for now. The NorthTalk spec makes property writes final, but a write inside a savepoint would be rolled back. Scripts change the World through Segment-bound Operations such as `change` and `moveTo`. mua's Scripts already work this way.
- `clock` and `timer` are hero-world Capabilities that keep timers in World data (ADR 0014), not standard NorthTalk Capabilities.
- Nothing else may write to the World's SQLite database while the World runs. Reads that need a consistent view also go through the World process.
- The Elixir Host Object, property, Element and Decision surfaces this needs are requested upstream in odogono/odgn-talk#1970.
