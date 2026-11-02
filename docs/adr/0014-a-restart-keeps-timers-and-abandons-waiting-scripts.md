# A restart keeps timers and abandons waiting Scripts

When the Elixir server restarts, timers resume from the saved World and Scripts that were waiting are abandoned. Timers are already World data, so they recover with the World without a separate mechanism. A waiting Script keeps the steps it has already committed; nothing after them runs, the original command is not restarted, and the affected Character is told.

Restoring waiting Scripts from their saved positions was the alternative. NorthTalk saves exclude the external ECS database and cannot be taken during a live Scope or Segment, so a recovery point consistent with the World would be the hardest part of the integration. Authored content does not yet depend on Scripts that wait across long periods, so the cost was not justified for the alpha.

## Consequences

- No committed effect repeats after a restart, because abandoned Scripts commit nothing further. ADR 0012's commit-before-success guarantee is unchanged.
- If the browser lost a reply, the command's outcome stays unconfirmed unless the server can establish it (ADR 0013).
- Content that needs a long wait should use a timer, not a waiting Script.
- Each start loads every Script fresh, so Script Variables are reset. State that must survive a restart belongs in components.
- Restoring waiting Scripts can be added later if content needs it; that would require coordinating NorthTalk saves with the World.
