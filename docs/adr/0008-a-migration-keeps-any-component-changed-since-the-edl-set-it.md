# A Migration keeps any component changed since the EDL set it

ADR 0005 set static components to exactly what the EDL says, so a live edit to one was overwritten without notice by the next Migration. Live edits include an admin changing a description at the prompt and a Script changing `exits`. ADR 0006 already saved each Play state component as the EDL set it and changed it only where the world still held that value. That rule now covers every component. The EDL value of each component a named entity gets is saved. A Migration changes a component only where the world still holds that value; otherwise it leaves the component alone and lists it in the plan's `kept`. This amends ADR 0005 and ADR 0006.

## Considered options

- **Lose the edit and report it.** Rejected: the author has to redo the edit in the EDL after the fact.
- **A separate "edited live" mark.** Rejected: comparing with the saved EDL value finds the same components without every write path having to set a mark.
- **Write live edits back to the EDL file.** Rejected for now: hard to place an edit correctly in an EDL built from atoms.

## Consequences

- The Play state flag decides only whether a component the EDL stops setting is removed (static ones are; Play state ones are not), and what a world without saved values keeps (its Play state, as in ADR 0006).
- Changing a static component in play now holds back later EDL edits to that component until someone resolves what `kept` lists.
