# Pilot: a behaviour written as a NorthTalk Script

Locks and keys exist twice: built in (`src/server/mua-world/actions/locks.ts`)
and as a Script (`src/server/mua-world/behaviours/lockable.talk`). The same
tests (`__test__/locks.test.ts`) run against both, through `locks.edl` and
`locks-scripted.edl`, and both pass every case.

## What worked

- **Everything the built-in does:** refusing to open while locked, locking and
  unlocking with a named key, finding a fitting key the actor carries and
  saying which, every refusal, and telling the room. 113 lines of Script
  against 91 of TypeScript.
- **The hooks are enough.** The Script handles the command as its target
  (receivers, #21), reads and writes `lockable` (ecs-talk), finds carried keys
  (`ask world to find actor, "key"`), reads the key from the command
  (`ask mua to command`, #51) and tells the room but the actor
  (`tell mua to announce`, #51).
- **No timing cost a player sees:** the reply comes within the tick (#23).
- **Text is pleasant:** backtick strings interpolate
  (`` `The ${nameOf(the target)} is locked.` ``).

## Rough edges

1. **No message templates.** The Script writes its own text, so a thing's
   `messages { msg: { unlock: ... } }` override doesn't apply, and the
   `{the target}` defaults are duplicated. A `mua` operation that renders a
   template for the current command would fix both.
2. **Shared helpers are copied.** `nameOf`, `actorName` and `fits` live in the
   Script. Every behaviour would need the same ones. NorthTalk Libraries
   (stateless shared code) would hold them; ecs-talk doesn't load Libraries
   yet.
3. **Lock and unlock duplicate each other.** The key-finding and reporting
   parts use `ask` and `tell`, so the pilot keeps them in each Handler. A
   function calling immediate operations may well be allowed; it wasn't tried.
4. **A Script can't add to a built-in reply.** `examine` saying "It is closed
   and locked." stays in TypeScript, reading the same component: a Script
   either replaces a reply or passes.
5. **Verbs stay in TypeScript.** `lock X with Y` is parser data.
6. **Gotchas met:** `"\n"` is not an escape in a double-quoted string (use
   `` `\n` ``); fire-and-forget operations need `tell`, not `ask`; `exit` and
   `add` are reserved words.

## Recommendation

Keep the built-in for now; it is shorter, typed, and gets templates. Writing
behaviours as Scripts is viable once (1) and (2) are addressed: a template
operation in `mua`, and Library loading in ecs-talk for shared helpers. With
those, a behaviour catalogue in NorthTalk would be about as short as the
TypeScript and editable by world authors.
