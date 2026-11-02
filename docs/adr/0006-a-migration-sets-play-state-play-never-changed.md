# A migration sets Play state that play never changed

ADR 0005 never overwrote Play state, so EDL edits to it never reached a built world: moving a thing's `location` in the EDL left it where it was, with nothing reported (#77). The world now saves each Play state component of a named entity as the EDL set it, when the EDL is executed and after each migration. A migration sets a Play state component to the EDL's new value only if the world still holds the value the EDL last set, meaning play never changed it. Otherwise the component is left alone and listed in the plan's `kept`.

## Considered options

- **Flag fields, not components** (`container.isClosed` but not `capacity`). Not taken: it fixes components that mix authored and played fields, but not a `location` the EDL moves.
- **Migrate from the previous EDL** instead of saving values. Rejected: the caller has to find the old EDL, and `!set` and atoms would have to be resolved twice.
- **Only report the differences.** Kept as the fallback, as `kept`.

## Consequences

- A world built before values were saved has none, so it keeps all its Play state as in ADR 0005 and reports the differences. After its next migration it has them.
- A component is compared whole: a door opened in play also keeps the EDL from changing its other fields.
- Values that play changes and then changes back count as untouched.
