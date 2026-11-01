# Scripts ask for the command they handle instead of receiving it

A Script handling a command gets `role, actor` and asks for the rest with `ask mua to command` (verb, target, second object, text, direction), rather than receiving the command as a third Handler argument. NorthTalk matches a Handler only when the argument count is exact, so adding an argument would have silently stopped every existing `on take role, actor` from matching. mua records which command each Delivery belongs to, and the Capability looks it up through `Call.delivery`, so any Script on the Message Path, including veto Decisions, can ask.

## Consequences

- A Run that doesn't come from a command (a timer, a lifecycle message) gets Nothing from `ask mua to command`.
- Changing what a command handler receives later would again mean touching every Script's Handler heads.
