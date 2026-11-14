# The Composer asks the build Service directly

ADR 0024 gives the Host the front of a Command and gives the Script everything that is a game rule. A Builder's Place and Save, and the Composer's own store and destroy, are never typed, so they are not Commands. The Host sends each one straight to the `build` Service Script, with no Receivers, no Vetoes and no `after<Verb>`. The Script holds every Builder rule and its wording: permissions, limits, the count of placed things, whether the thing is open in the actor's Composer, and whether it is within Reach. The Host only answers facts the Script asks for through Capabilities, including whether a thing is within an actor's Reach.

## Considered Options

- **Treat Composer requests as Commands.** Rejected: they would need a Verb, nouns to bind and a typed form they don't have, just so a room could Veto building. If a room is to forbid building, `build.talk` checks it.
- **Keep the Composer and Reach checks in the Host.** Rejected: both Hosts held the same rule with identical wording, and no conformance case covered it (#306).

## Consequences

- No Veto or Receiver ever sees a Place or a Save. A World that wants to limit building does it through the `build` Service, not through `before…` Vetoes.
- A typed `store` or `destroy` gets Reach from noun binding. The Composer's store and destroy get it from the Script, which also requires the thing to be open in the Composer. Both run the same Script body, so they reply in the same words.
- Step cases pin Composer requests with their own step kinds, run by both Hosts.
- Errors in a malformed request, and the Host's report of a Script that failed, are not Builder refusals. They stay in each Host.
