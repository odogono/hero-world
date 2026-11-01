# Pilot: a behaviour written as a NorthTalk Script

Locks and keys exist twice: built in (`src/server/mua-world/actions/locks.ts`)
and as a Script (`src/server/mua-world/behaviours/lockable.talk`). The same
tests (`__test__/locks.test.ts`) run against both, through `locks.edl` and
`locks-scripted.edl`, and both pass every case.

## What worked

- **Everything the built-in does:** refusing to open while locked, locking and
  unlocking with a named key, finding a fitting key the actor carries and
  saying which, every refusal, telling the room, and a thing's own
  `messages`. 78 lines of Script, comments included, against 91 of
  TypeScript (the first version was 113).
- **The hooks are enough.** The Script handles the command as its target
  (receivers, #21), reads and writes `lockable` (ecs-talk), finds carried keys
  (`ask world to find actor, "key"`), reads the key from the command
  (`ask mua to command`, #51) and tells the room but the actor
  (`tell mua to announce`, #51).
- **No timing cost a player sees:** the reply comes within the tick (#23).
- **Text is pleasant:** backtick strings interpolate
  (`` `The ${nameOf(the target)} is locked.` ``).

## Rough edges, and what has been done about them

1. **Message templates** — _done._ `ask mua to message handler, kind,
indirect` renders the built-in message for the command, from the thing's
   `messages` or the defaults, so a Script's text and a thing's overrides
   match the built-in's.
2. **Shared helpers** — _done._ ecs-talk registers NorthTalk Libraries
   (`talk.addLibrary`), and mua loads `behaviours/lib/things.talk` as the
   `things` Library: `use nameOf, actorName, fits from things`.
3. **Lock and unlock duplicated each other** — _done._ Both call one local
   Handler, `turnKey`, which keeps `the target`.
4. **A Script can't add to a built-in reply.** `examine` saying "It is closed
   and locked." stays in TypeScript, reading the same component: a Script
   either replaces a reply or passes. Still open.
5. **Verbs stay in TypeScript.** `lock X with Y` is parser data. Still open.
6. **Gotchas met:** `"\n"` is not an escape in a double-quoted string (use
   `` `\n` ``); fire-and-forget operations need `tell`, not `ask`; `exit` and
   `add` are reserved words.

## Recommendation

With (1) to (3) done, a behaviour as a Script is shorter than the TypeScript,
uses the same messages, and can be edited by world authors. New behaviours
can reasonably be written as Scripts, with TypeScript kept for what Scripts
can't yet do: adding to a built-in reply, and new verbs.
