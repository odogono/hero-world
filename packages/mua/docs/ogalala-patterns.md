# Patterns from Ogalala for MUA

MUA borrows ideas from Ogalala, a Java MUD engine written in 1998–99. Its source is at
`/Users/alex/work/odgn/ogalala`. This note lists the Ogalala patterns worth bringing
into MUA, how each one maps onto Hero World's terms (see `GLOSSARY.md`), and which
Ogalala habits to leave behind.

Source paths below are relative to the Ogalala repo. `mua/` there is Ogalala's own
engine package, not this one.

> **About the Ogalala `docs/` folder.** Those five docs were generated recently and
> are wrong in places. Trust the source over the docs:
>
> - `docs/vocabulary.md` gives the adverb rule backwards. The code parses
>   `verb + adverb > newVerb` (`mua/parser/Parser.java:1814`).
> - `FactoryAction.java` doesn't exist. Factories are in
>   `mua/action/CoreCommands.java:555`.
> - The docs leave out the room and indirect-object dispatch
>   (`container_<verb>` / `arg_<verb>`, see §2.2).
> - They also leave out non-action property values (strings, booleans) and the
>   features that were never finished: the `(world)` scope, binding a second
>   argument, and `then`.

---

## 1. Concept map

| Ogalala                                                                        | Hero World / MUA                                              | Notes                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Atom` (type)                                                                  | **Atom**                                                      | A named template. Ogalala lets atoms have several parents.                                                                               |
| `Thing` (an atom with a container)                                             | **Entity**                                                    | In Ogalala a Thing _is_ an atom and can be inherited from. In Hero World only atoms can be extended.                                     |
| Parents, searched deepest-first (`Atom.java:60`)                               | **Lineage**                                                   | Ogalala sorts parents by depth and then height. EDL uses rightmost-base-wins.                                                            |
| `getProperty` climbing the ancestors (`Atom.java:504`)                         | **Message Path** (NorthTalk) and component inheritance in EDL | Ogalala resolves data _and_ behaviour through the same lookup.                                                                           |
| `Action.pass()` → `getPrecursorAtom` (`Atom.java:571`)                         | Passing an unhandled message further up the Message Path      | It works like a "super" call.                                                                                                            |
| `Container` / `getContents`                                                    | **Location** / **Elements** (`location.in`)                   | MUA still uses `contained.in` and `player.location` (see §5).                                                                            |
| `Event { actor, id, current, target, args }` (`Event.java`)                    | `commandEvent` entity, NorthTalk message                      | `current` is the bound object. `target` is the object being searched for the handler; it changes when the event is redirected or passed. |
| `world.callEvent` (synchronous) vs `postEvent` (queued) (`World.java:447-515`) | A direct function call vs creating an event entity            | MUA has only the queued kind for now.                                                                                                    |
| `Timer` plus world time (`Timer.java`)                                         | Scheduled events in odgn-ecs                                  | See §2.11.                                                                                                                               |
| `Watcher` chain on a Thing (`Watcher.java`)                                    | Currently `outputEvent.wsId`                                  | See §2.9.                                                                                                                                |
| ODL, compiled to `!` scripts                                                   | EDL                                                           | Ogalala's `exits { … }` block is worth copying (§2.10).                                                                                  |
| `!Verb` script lines                                                           | `commands/registry.ts` + the `switch` in `parser.ts`          | See §2.5.                                                                                                                                |
| Limbo, Admin, Root atoms                                                       | (none yet)                                                    | See §2.12.                                                                                                                               |

---

## 2. Patterns worth bringing over

### 2.1 Verbs are properties on the object that was acted on

This is the core idea of Ogalala. The parser never runs game logic directly. It
turns input into a _property id_ plus a bound object, then looks that property
up on the object through its ancestors (`World.callEvent`, `World.java:515`).
The value it finds decides what happens:

| Property value                                 | Result                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| An `Action` (`open = !OpenDoor`)               | The action runs. Its return value means "handled".                       |
| A string (`open = "You can't open {-t name}"`) | The string is formatted and sent to the actor. Counts as handled.        |
| A boolean or int (`on_enter = true`)           | Used as the result. This is how a guard always allows or always refuses. |
| Missing                                        | Not handled.                                                             |

Behaviour atoms can _install defaults on a base atom_. For example,
`openable` writes `$thing.open = "You can't open {-t name}"`
(`mua/odl/behaviours.odl:11`), so every thing gets a sensible refusal and only
openables override it.

**For MUA.** NorthTalk's Message Path already does the behaviour half. The
missing half is the cheap data-only case. Let a component carry plain refusal or
response strings (for example a `responses { open: "It won't budge." }`
component). Have the action dispatcher check, in order:

1. a script handler on the Receiver's Message Path
2. a response string in the Receiver's components or Lineage
3. the built-in TS action

That way most world content needs no script at all.

### 2.2 Three dispatch stages: room, then indirect object, then direct object

For every bound command (`EventProcessor.java:91-140`), Ogalala offers the event
to these, in order, and the first one that handles it wins:

1. **The room**, as `container_<verb>`. The room can intercept any command
   inside it. For example, Nile's atrium overrides `go` with `container_go =
!AtriumGo`.
2. **The first argument**, as `arg_<verb>`. The indirect object gets a say: a
   bag can refuse `put X in bag`, and a key can react to `unlock door with key`.
3. **The object itself**, as `<verb>`.

If none of them handles it, the actor sees "You can't do that."

**For MUA.** This is a small, clean way to get "rooms with rules" (no magic in
this room, a dark room, a guard who blocks the exit) without touching each
item's code. It maps directly onto sending `roomVerb` / `argVerb` / `verb`
messages to three Receivers in turn.

### 2.3 Use explicit results instead of one boolean

Ogalala's actions return a single `boolean`. That boolean is overloaded, and
it's the worst part of the design:

- `SimpleAction` always returns `true`, even when the action failed
  (`mua/action/OpenableLockable.java:137`).
- Any string property counts as handled.
- Inside an action, `false` from a sub-event means _veto_.
- At parser level, `false` means _try the next handler_.

**For MUA.** Keep the pipeline and give each outcome its own result type:

```ts
type ActionOutcome =
  | { kind: 'done'; effects: Effect[] } // handled, world changed
  | { kind: 'refused'; message: string } // handled, nothing changed
  | { kind: 'pass' }; // not mine: try the next handler
```

MUA's current `ActionResult` (just `message` plus an optional `broadcast`) is a
good place to grow this from.

### 2.4 Action skeleton: hooks in a fixed order

`SimpleAction` and `CheckedAction` (`mua/action/OpenableLockable.java:137-260`)
are template methods. The hooks run in this order:

```
init → beforeTest → test → (successfulTest → afterTest | failedTest)
     → tryAction → (successAction | failedAction)
```

`Go` (`mua/action/ExitCommands.java:280`) is a good example of a fixed movement
order:

1. `beforeGo`
2. send `on_exit` to the old room (it may veto)
3. check `is_closed` on the exit
4. `onGo`
5. send `on_enter` to the new room (it may veto)
6. move
7. send the departure and arrival messages
8. `afterGo`
9. send `look` to the actor

**For MUA.** You don't need classes for this. A data shape like
`{ check, perform, describe }` per verb, with veto messages between `check` and
`perform`, gives the same structure. Spell out the movement order once, in
`move.ts`, and send the veto messages through scripts.

### 2.5 Veto and lifecycle messages

These are sub-events that other objects can answer with `false` to block an
action. Root sets every one of them to `true`, so they are opt-in.

- `on_add` / `on_remove`: sent to the holder when something enters or leaves it.
  `Get` aborts if the holder refuses
  (`if (!world.callEvent(actor, ON_ADD, …)) return;`).
- `on_exit` / `on_enter`: sent to rooms during movement.

Lifecycle events (`World.java:55-60`, `717-830`):

- `on_create`, then `on_start` when the world is running
- `on_stop`, then `on_destroy` when an entity is deleted
- `on_reset`, which propagates through a `dependents` list (`World.resetAtom`).
  This is how a room resets the items in it.

Lifecycle handlers chain upwards with `pass()`.

**For MUA.** These map onto NorthTalk messages sent by the move, create and
delete helpers. `on_reset` plus `dependents` is a cheap way to respawn areas.

### 2.6 Verb templates that list every form of a verb

One `!Verb` line declares all the forms of a verb
(`mua/scripts/verbs`; grammar in `mua/parser/VerbTemplate.java`):

```
!Verb (Guest) "look,l,peer" "none(see)>look" "current(see)>examine" \
              "at current(see)>examine" "direction(see)>look_far"
!Verb "close,shut" "current(see){!is_closed}>close" \
                   "current{!is_closed} with thing>close_with"
!Verb "sell" "current to thing for numeric>sell_to_for"
```

Each template has these parts:

- **Argument kinds:** `none | current | thing | direction | string | numeric |
communicative`.
  - `current` is the object the command is dispatched to.
  - `thing` is just an argument. When a template has no `current`, the command
    is dispatched to root.
- **Prepositions:** up to two (`with`, `to`, `for`, `in`, …). Any unrecognised
  word in a template is added to the vocabulary as a preposition.
- **Scope modifiers:** `(see)`, `(touch)`, `(inv)`, `(room)` (§2.8).
- **Property preferences:** `{is_closed}` / `{!is_closed}`. These only apply
  when _several_ objects match, so they act as a disambiguation preference, not
  a hard filter (`mua/parser/NounPhrase.java:200`). With two doors, one open and
  one shut, `open door` picks the shut one. A single open door still binds, and
  its own handler says "It's already open."
- **`>handler`:** the property id to dispatch.
- **Privilege `(Guest|User|…)`:** actors below the level get the same "I don't
  know how to …" message, so admin verbs stay hidden.

Templates are chosen by preposition signature. The first declared template
wins.

**For MUA.** This would replace the hand-written `switch` in
`commands/parser.ts` with data. A TS version could look like:

```ts
defineVerb({
  names: ['open'],
  forms: [
    {
      pattern: 'obj',
      scope: 'see',
      prefer: { 'container.isClosed': true },
      handler: 'open'
    },
    { pattern: 'obj with thing:inv', handler: 'openWith' }
  ]
});
```

It could also live in EDL or a `.verbs` file so verb data stays with the world.

### 2.7 Nouns resolved through the Lineage

This is the most reusable idea in the parser. A noun word maps to a placeholder
atom, and anything that inherits from that atom answers to the word
(`mua/scripts/compiled/nouns.atom`, `generic_objects.atom:37`):

```
!atom noun_box noun
!noun box noun_box
!atom box container portable openable noun_box
```

Matching is just `target.isDescendantOf(nounAtom)` (`NounPhrase.java:415`). This
gives you several things for free:

- Synonyms: several words point at one noun atom.
- Class nouns: `weapon` matches every sword.
- Multiple nouns per object.

The vocabulary also keeps a map from atom to words
(`Vocabulary.getAtomNouns`), so the game can name an object using the player's
own vocabulary.

Adjectives map a word to a property, and match when the property is at least 50
(`NounPhrase.java:439`). That makes "red" a matter of degree.

**For MUA.** Hero World keeps the Lineage after loading, so the same trick
works. Either add a `noun { words: [...] }` component, which entities inherit
like any other component, or use `noun_*` atoms in the Lineage. Matching
`get box` then becomes "Elements in scope whose Lineage includes the atom
behind the word _box_".

### 2.8 Scoped binding, with errors that name the scope

The template's scope picks the set of candidate objects
(`mua/parser/BinderEnumeration.java:316`):

| Scope   | Candidates                                                                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inv`   | The actor's own Elements (`ContentsEnumeration`).                                                                                                                                                                                                                |
| `see`   | `VisibleEnumeration` (`mua/atom/VisibleEnumeration.java`). It looks into containers unless they are `is_closed`, but does look into `is_transparent` ones. It also applies item `visibility` against container `concealment` and the viewer's `detection_skill`. |
| `touch` | `GettableEnumeration`. Like `see`, but never reaches into transparent containers.                                                                                                                                                                                |

The nested forms resolve recursively:

- `get key in box` binds `box` first, then searches its Elements. A shut box
  stops the search and prints its `is_closed_msg`.
- `get all except sword` subtracts one bound set from another.

Bind errors are phrased by scope (`NounPhrase.java:227-275`), for example "You
cannot see a key in the Library" or "You do not have a key in your possession".

Binding produces **one event per matched object**. That's how `get all`,
`drop 3 coins` and `get box and key` work without the actions knowing about
plurals. Words like "all", "every" and "everything" set the count to a sentinel
value meaning infinity.

**For MUA.** Build the scope sets as ECS queries over `location.in` (these are
cheap to add to `queries/room.ts`). Then expand a command into N `commandEvent`
entities. The action system is already one entity per command, so this fits
naturally.

### 2.9 Input rewrites

`Parser.lookUpWords` (`Parser.java:942`) normalises input before parsing:

- A direction typed on its own becomes `go <dir>`. MUA already does this.
- Input starting with a quoted string becomes `say "<string>"`.
- Input starting with a noun that isn't a verb becomes `say to <noun> …`, so
  `bob hello` means "say hello to bob".
- After a communicative verb, everything else is kept as one string.
- `again` / `g` repeats the last command.
- A trailing `\` continues the command on the next line.
- **Raw verbs** (`!rawverb !DIG _dig !ModDig`) skip the parser entirely and
  send the remaining words as arguments. This suits admin commands.

### 2.10 Messages as data, with a template syntax

Messages are stored as properties, following a suffix convention:

| Suffix        | Recipient                                                |
| ------------- | -------------------------------------------------------- |
| `X_msg`       | the actor                                                |
| `X_omsg`      | everyone else in the room (`container.output(s, actor)`) |
| `X_smsg`      | the subject or victim (weapons)                          |
| `receive_msg` | the recipient of a give                                  |

Defaults live on behaviour atoms (`open_msg`, `already_open_msg`,
`wrong_key_msg`, …), so content authors override text without writing code.

The template syntax (`mua/OutputFormatter.java:10-33`) is
`{[-opts ]atom.field}`:

- **Options:** `-a` adds an indefinite article, `-t` a definite article, `-p` a
  possessive, and `-u` / `-l` set the case of the first letter.
- **Special atoms:** `actor`/`me`, `current`, `container`/`here`, `arg`.
  `current` is the default.
- Expansion is recursive, so a description can contain `{direction}`.
- `{0}`, `{1}` are positional values.

Example: `"{-u -t actor.name} opens {-t name}."`.

Output packets are structured: `OutPkt` has a type and fields, so `look` sends
`things`, `mobiles` and `exits` lists. The client lays these out, and only the
fallback path renders plain text.

**For MUA.**

- Add a small formatter for `{-t name}`-style templates on top of
  `described.name`, plus the `_msg` / `_omsg` convention in a `messages`
  component or in behaviour atoms.
- Send structured output (`{ type: 'look', room, items, exits }`). The TUI's
  `message-parser.ts` currently recovers colours from text, so structure would
  remove that guesswork.
- **Avoid Ogalala's late formatting.** It formats at delivery time against the
  current event (`mua/atom/Thing.java:~90`). `Stand` had to pre-format its
  messages because moving the actor changed what `{here}` meant
  (`mua/action/CoreCommands.java:422`). Format when the action runs.

### 2.11 Output goes to the body, and watchers route it

Output is sent to a _Thing_, not to a connection. Each Thing has a chain of
`Watcher`s (`mua/Watcher.java`, `mua/atom/Thing.java:157`):

- At most one **lead** watcher, which controls the Thing. For a player, that's
  their connection.
- Any number of others: NPC brains, loggers, an admin snooping.

Watchers are transient and never stored, so a body exists in the world even
when nobody is connected to it. Possession and puppeting, NPC brains and
link-dead players all come for free.

**For MUA.**

- Address `outputEvent` to an entity (`to: EntityId`) instead of a `wsId`. Let
  `outputSystem` resolve the entity to its connection(s) through
  `player.connectedId`.
- An NPC brain then becomes "another subscriber to this entity's output".
- `outputSystem` currently sends room broadcasts by querying `player.location`.
  Room output should instead fan out to the room's Elements and then to each
  one's watchers.
- **Do better than Ogalala on one point.** Its NPCs re-parse the _rendered text_
  to react (`mua/action/NPCActions.java:552`). Give watchers the structured
  event as well as the text.

### 2.12 Exits: two linked halves, per-side messages, a shorthand for building them

- An exit is a pair of things linked by `destination` and `other_side`
  (`World.addExit`, `World.java:836`).
- Doors set `is_closed` / `is_locked` on **both** halves at once
  (`ExitCommands.java:617-687`).
- Departure text comes from the exit's `exit_omsg`, falling back to the room's.
  Arrival text comes from the other half's `enter_omsg`
  (`ExitCommands.java:344`).
- Direction constants are bit flags arranged so that swapping the two bytes
  gives the opposite direction: `NORTH = 0x0001`, `SOUTH = 0x0100`
  (`mua/atom/ExitTable.java:20`). Group masks like `DIR_NDIR` (north, northeast
  and northwest) come for free.
- An exit without a destination prints a string. MUA's `portal.msg` already
  does this.
- ODL declares exits in a compact block that builds both halves:

  ```
  exits {
      junction_with_pall_mall_room w = outside_the_traveller_room
      travellers_foyer_room e,in (lockable_door) = travellers_porter_room
  }
  $travellers_foyer_room.e.is_locked = true
  ```

**For MUA.** `main.edl` currently spells out every one-way portal by hand: 10
entity blocks for 4 rooms. An `exits` block (or an EDL `!exit` command)
that builds both halves, links them with an `otherSide` field, and takes an
optional atom (`(door)`) would make maps much cheaper to author. Add a
`reverseDir()` helper rather than relying on bit tricks.

### 2.13 Places nest inside each other; Limbo, Admin and Root

- Rooms are located in **places**, which nest:
  `game world > continent > country > region > place > room`
  (`apps/nileServer/odlcore/world_hierarchy.odl`, `_where = $…`). The chain is
  used for "where am I", NPC scripts chosen by enclosing place, and anything
  heard across an area.
- **Limbo** holds things that are out of the world: new clones, replaced items,
  storage.
- **Admin** is the actor behind system events such as lifecycle messages and
  resets.
- **Root** is the default receiver for verbs that have no `current`, and where
  global defaults live.
- **Freeze:** after the world script loads, `!FREEZE ALL` locks the inheritance
  structure.

**For MUA.** Locations can be chained already (`location.in` all the way up).
Add Limbo and a system actor entity early, because both clean up spawning and
teardown. MUA's `findRoomByMetaId` lookups could become "the enclosing place of
type X".

### 2.14 Timers and world time

- **World time** is the number of seconds the world has been _running_. It's
  saved, and it pauses while the server is down (`mua/Timer.java:12`).
- Timed events are ordinary events with a due time, held in a saved queue
  (`world.timerEvent(actor, id, current, secs)`).
- Repeating behaviours re-arm themselves when they fire: `ticker` with
  `on_tick` / `tick_time`, NPC walkers with `walk_interval`, and clockers with
  cron-like `clock_scripts`.
- `transformer` swaps an object for a `transform_template` after a delay.

**For MUA.** odgn-ecs already stores and schedules events. Base game timers on
a world clock that is saved and only advances while the game loop runs, not on
wall-clock time. Use it for doors that close themselves, respawns and NPC
wandering.

### 2.15 NPCs use the player command path

NPCs act by issuing ordinary commands: `world.parseCommand(cmd, npc)`. Their
behaviour scripts are lists of commands combined with a few operators:

- `ALL`, `RANDOM`
- `IF{p}`, `CASE{p}`, `INC{p}`, `LOOP{p}`
- `NOP`, `END`

These are in `mua/action/NPCActions.java`. Walker scripts are keyed by the
current room, then each enclosing place, then `unknown`.

**For MUA.** Let an NPC brain create `inputEvent` or `commandEvent` entities
with its own `playerId`. NPCs then follow exactly the same rules as players,
which is the real value of this pattern. The combinators are a reasonable
first version before writing NorthTalk-driven brains.

### 2.16 Behaviour catalogue (a gameplay backlog)

These behaviour atoms come from `mua/odl/behaviours.odl`. Each is a mixin of
properties plus action bindings, which in MUA would become components plus an
atom with a Script.

| Behaviour                                                   | How it works                                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openable`                                                  | `open`/`close`, `is_closed`, the matching `_msg`/`_omsg`/`already_*` messages.                                                                                                                            |
| `lockable` + `key`                                          | A key fits if it inherits from the lock's `key` atom and has a matching `key_code`. `key_code` 0 is a master key. `open_with` chains `unlock` then `open`.                                                |
| `door` / `lockable_door`                                    | An exit plus openable, synced across both halves.                                                                                                                                                         |
| `membership_exit`, `disallow_item_exit`                     | `go` checks a `required_item`, or refuses carried items.                                                                                                                                                  |
| `factory`                                                   | `get` makes a copy of `factory_template` and decrements `factory_count`. The last item replaces the factory itself.                                                                                       |
| `ticker`, `transformer`                                     | Repeating timer; delayed swap to a template.                                                                                                                                                              |
| `switchable` + `illuminatable`                              | A switch sends `on_changestate` to each atom in its `listeners`. A light adds its `light_emitted` to the room's `ambient_light`. Nothing ever _read_ `ambient_light`, so finish that loop if you copy it. |
| `seat`                                                      | Sitting means being _moved into_ the seat (`SitOn extends PutIn`). `stand` is defined on root and checks whether your Location is a seat, so posture comes from containment for free.                     |
| `eatable`, `readable`, `writeable`, `wearable`, `smellable` | Simple single-verb behaviours with message properties.                                                                                                                                                    |
| containers: `container_on` / `_under` / `_behind`           | One container concept plus a `position` field, giving "on the table" and "under the rug".                                                                                                                 |

---

## 3. Mistakes to avoid

- **One boolean for everything.** It mixes up handled, refused, veto and
  fall-through (see §2.3).
- **Control flow through exceptions.** The parser exits its pipeline by
  throwing `ParserPipelineException`, and `catch (Exception)` hides real bugs:
  adverbs that map to undefined verbs throw a null-pointer exception that is
  silently discarded.
- **A static global vocabulary** (`Parser.java:61`).
- **Unfinished features:**
  - The `(world)` scope.
  - Binding a second argument (`BinderEnumeration.java:74` is always false).
  - `then` as a sentence separator. It's also a stopword, and the stopword
    check runs first.
  - Disambiguation. The parser never asks "which key?" and silently takes the
    first match.
  - Ordinals ("second key") and the pronoun "them".
- **Every non-`(see)` object must be `portable`,** so `eat`, `burn` and `lock`
  all needed workarounds. Keep the "can it be picked up" check inside `take`.
- **Hard-coded text** in actions, for example `"the door opens ..."` sent to
  the other room. Put every message in data.
- **Delivery-time formatting** (§2.10).
- **NPCs reacting to rendered text** (§2.11).
- **Off-by-one bugs in output and capacity:**
  - `Container.output(out, m1, m2)` calls `nextElement()` twice per loop, so it
    skips every other recipient (`mua/atom/Container.java:103`).
  - `fits` compares against `size` instead of `capacity`.
  - The combat-ready check is inverted, so combat never ran.
- **Duplicate source:** `mua/action/CheckedAction.java` is a stale copy of
  `OpenableLockable.java`.

---

## 4. Suggested order for MUA

1. **Data-driven verbs** (§2.6). Replace the parser `switch` with verb
   definitions (names, forms, scope, handler). Add `again`, `say`, and the
   noun-first rewrite.
2. **Scoped binding with noun matching through the Lineage** (§2.7, §2.8),
   expanding to one `commandEvent` per bound object. Add a disambiguation
   prompt; Ogalala never had one.
3. **Three dispatch stages plus an explicit `ActionOutcome`** (§2.2, §2.3).
   Each stage tries a script on the Message Path, then a response string, then
   the built-in action.
4. **Messages as data** with `{-t name}` templates and `_msg` / `_omsg` (§2.10).
   Send structured `look` output to the TUI.
5. **Output addressed to entities** (§2.11) so NPCs, puppeting and link-dead
   players all work.
6. **An `exits` shorthand in EDL** with linked halves and door sync (§2.12).
7. **Veto and lifecycle messages**, then **Limbo and a system actor** (§2.5,
   §2.13).
8. **A saved world clock and timers** (§2.14), then NPC brains that issue
   commands (§2.15).
9. Work through the behaviour catalogue (§2.16): openable, then lockable and
   key, then door, then container positions and seats.

## 5. Gaps between MUA and Hero World (resolved)

These came up while comparing the codebases and have since been fixed:

- **Location component.** MUA now uses the shared `location { in }` from
  `ecs-talk` (`locationComponent`) instead of its own `contained { in }` and
  `player.location`, so NorthTalk scripts can see MUA rooms and items.
- **Extending an entity.** `item` in `edl/main.edl` is now an `atom`. Under the
  rule that only atoms may be extended (`GLOSSARY.md`), the old `entity item`
  stopped the world from loading.
- **Dead config.** The unused `look: "!LookRoom"` strings, left over from
  Ogalala's `!Action` binding, have been removed.
