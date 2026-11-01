---
type: feat
scope: mua
---

Add a world clock and timers. Game time advances with each tick and is kept on the system actor. A `timers { every: { chime: 10 reset: 300 } }` component sends a message to an entity on a schedule, and `reset` resets the place. A Script's `wait` runs on world time.
