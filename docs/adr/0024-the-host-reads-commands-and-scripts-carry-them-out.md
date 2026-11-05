# The Host reads Commands and Scripts carry them out

ADR 0021 kept commands in the Host and ADR 0023 moved them into Scripts. This draws the line between them. Each Host keeps the front of a Command: reading what was typed (`again`, `it`, the `bob hello` shorthand, the "which do you mean?" reply), parsing it against the Verbs, and binding its nouns within their Reach. It also keeps the order a Command is asked in: Receivers, then Vetoes, then the Action, then `after<Verb>`. Everything that is a game rule moves out of the Host. Verbs, including directions and which `before…` Vetoes each Verb raises, become EDL data. Every Action becomes a Service Script. Lifecycle follows ADR 0020: Systems decide when entities are due, and Scripts decide what a reset does.

## Considered Options

- **Parse in NorthTalk.** Rejected: there would be only one parser, but NorthTalk handles strings poorly, it would add cost to every Command, and the parser rarely changes.
- **Port the Actions to TypeScript.** Rejected for the reason given in ADR 0021: Actions change most often, and two copies drift.

## Consequences

- The parser and binder are written twice, in Elixir and TypeScript, and kept the same by shared cases in `spec/mua/commands/`.
- When an Action needs something Scripts can't do yet, the Host adds a Capability function rather than keeping that Action in its own code.
- The duplicate lock logic in `actions.ex` and `lockable.talk` collapses into a single Script.
- The Service Scripts and the base EDL Verbs move out of `mua_world/priv` into `packages/mua-scripts/`, a data-only package both Hosts load.
- An NPC acting from a Script gives a Command already bound, so it never goes through the parser.
- An entity's fixed `responses` are answered by a base Script reached through its Lineage, so the Host asks only Message Paths.
- Message templates and `messages` overrides stay World data. Scripts fill them in, and the Host formats no text. That covers Actions: the front end's own replies, such as "Which do you mean: …?" or `Unknown command: "…"`, stay in each Host, worded the same, and the command cases check them word for word.
- Command conformance cases test only the front end: an EDL fixture, a Character, and a typed line, mapped to a bound Command, an incomplete prompt, or a "which do you mean?" question. Actions are tested through Step cases.
