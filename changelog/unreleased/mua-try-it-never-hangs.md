---
type: fix
scope: mua
---

Try it no longer hangs when the browser's mirror of the World fails: the Composer says it couldn't read where you stand and asks you to reconnect. The Preview World and the mirror now share one way of asking their Workers for something, and every request settles, even when a Worker dies.
