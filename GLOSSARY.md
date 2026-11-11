# Hero World

Game worlds described in EDL, the text format a World is declared in, stored in an ECS, and driven by NorthTalk Scripts.

## Players

**Player**:
A person playing the game through their Account and its Character.
_Avoid_: user, character (for the person)

**Account**:
A person's game identity, which owns their playable Characters and carries their permission to enter the game.
_Avoid_: character, player entity

**Character**:
An Entity a person plays through, owned by an Account and known in the World by its chosen name.
_Avoid_: account, login

**Connection**:
A browser's link through which a Player controls their Character. A Character has at most one controlling Connection; a new one takes over from the old.
_Avoid_: session, socket

**Allowlist**:
The Google identities admitted to the game while it is invite-only. Signing in proves who someone is; the Allowlist decides whether they may enter.
_Avoid_: whitelist, invite list

**Admin**:
An Account allowed to change the World live from the browser, beyond what play allows.
_Avoid_: operator, superuser, wizard

**Builder**:
An Account allowed to place new things in the World as it plays, or change things already placed, as far as its permissions and limits allow. Its permissions say whether it may place, and whether it may change only what it made or anything placed; its limits, how many it may place and how big a container it may make. An Admin makes an Account a Builder, and can stop it building; what it placed stays.
_Avoid_: creator, author, owner

**Composer**:
The place in the browser where a Builder shapes a thing, either a new one to place or a placed one to change.
_Avoid_: builder panel, editor, build panel

**Maker**:
The Account that placed a thing. The World keeps it with the thing, and shows it only through its Signature.
_Avoid_: owner (which is a Script's), creator, author

**Signature**:
The one Character that speaks for an Account wherever it is shown as a Maker, the same on everything it made.
_Avoid_: byline, author name

**Store**:
To take a placed thing out of play by moving it to Limbo, from where it can be brought back. A stored thing still counts against its Maker's limit.
_Avoid_: soft delete, recycle, trash

**Destroy**:
To remove a placed thing for good, taking away every component it has, so nothing of it is left and it no longer counts against its Maker's limit.
_Avoid_: delete, recycle, store (for this)

## World data

**World**:
The complete, persistent state of one game: its entities and their components. It has one writer at a time.
_Avoid_: store, database (for the concept), scene

**Local World**:
A World played solo in the browser, with its own local Account. It never syncs with a server's World, and its file is its save.
_Avoid_: offline world, save game

**Preview World**:
A private, disposable World for trying something out, which is never saved and never reaches another World.
_Avoid_: sandbox, test world, scratch world

**Entity**:
A thing that exists in a World and carries components. It is nothing but its id.
_Avoid_: object, instance

**Component Definition**:
The named schema for one kind of component. Its name is its identity.
_Avoid_: cdef, CDef, def (outside EDL syntax), component type

**Component**:
One entity's data for one Component Definition.
_Avoid_: attribute, property bag

**Reference**:
A component property whose value is another entity, such as a Location.
_Avoid_: link, pointer, foreign key (for the concept)

**Atom**:
A named template of components that entities and other atoms extend. It is never itself an entity, and only atoms can be extended.
_Avoid_: prototype, class, archetype, recipe

**Recipe**:
A saved set of components and their values that a player creates new entities from. An entity made from one keeps no tie to it, so changing a Recipe changes only what is made after.
_Avoid_: atom (for this), template, blueprint

**Lineage**:
The ordered list of atoms an entity or atom was built from, kept after loading.
_Avoid_: ancestry, extends chain

**Location**:
The entity another entity is in.
_Avoid_: parent, container (as a relation)

**Elements**:
The entities whose Location is a given entity. Named ones can be looked up by name, and all of them are counted and indexed.
_Avoid_: contents, children

**Home**:
Where a thing starts, so that a reset can put it back. Characters and exits have none.
_Avoid_: starting room, origin

**Perception**:
What a Character can currently know about the World: its place, the Elements there that it can see, and what it carries. Nothing outside it reaches that Character's Player.
_Avoid_: view, visibility, scope

**Starting room**:
Where a Character enters the World when it has nowhere valid to return to.
_Avoid_: home, spawn

**World time**:
The World's clock, which advances while the server runs, even with no Players connected, and pauses while it is down. Timers count against it.
_Avoid_: game time, wall-clock time

**Step**:
One input to the World, such as a command, a due timer or a run of a System, and the Script work it causes, ending in one commit. Output that confirms it is published only after that commit.
_Avoid_: tick, transaction, turn

**Frame**:
One fixed-length advance of World time in a free-running game loop, running every due System and ending in one commit. It is the arcade counterpart of a Step, never a name for one.
_Avoid_: tick, update

**Waiting input**:
An input the World has accepted but not yet run as a Step. It is kept in the World, so it survives a restart.
_Avoid_: pending command, queue entry

**Limbo**:
The place that holds what is out of play: stored things, and Characters not in play, whether their Players have left or they have yet to enter for the first time.
_Avoid_: void, storage room

**System actor**:
The entity that acts when no player did, such as for resets and lifecycle messages.
_Avoid_: admin, root

**Definition name**:
The name an entity was given in the EDL, which ties it to that definition for as long as it exists. Entities made during play have none.
_Avoid_: id, key, slug

**Play state**:
Components that play changes, such as whether a door is open or where a movable thing is. A Migration changes them only where play has left them as the EDL last set them.
_Avoid_: runtime data, dynamic components

**Migration**:
Bringing an existing world up to date with a changed EDL while keeping its players, Play state and time. A Build is the Migration of an empty world.
_Avoid_: rebuild, reset, sync

**Build**:
The first Migration of a world: from empty to what the EDL describes.
_Avoid_: execute, load (for EDL)

## Behaviour

**System**:
Logic that runs at its own interval of World time over every entity matching its query. In mua, a System chooses which entities to give a Delivery and leaves the behaviour to their Scripts.
_Avoid_: processor, handler

**Event**:
An entity that a System consumes once, possibly at a scheduled World time. It is the Systems' counterpart of a Delivery, never a name for one.
_Avoid_: signal, message (for this)

**NPC**:
An entity that acts by issuing commands as a player does, driven by its Scripts.
_Avoid_: mob, bot, monster

**Veto**:
A refusal, by an entity asked before an action changes the world, that stops the action.
_Avoid_: block, cancel

**Handle**:
The Host Object that stands for one entity inside a Script Group.
_Avoid_: proxy, wrapper

**Owner**:
The Host Object an atom's Script owns; `me` in that Script. It stands for the atom, never an entity.
_Avoid_: me (when you mean the entity), self

**Receiver**:
The entity a message was delivered to; `the target` in every Script on its Message Path. It stays the same as the message climbs.
_Avoid_: me, sender

**Message Path**:
The route an unhandled message climbs, from an entity through the atoms in its Lineage that have Scripts, linearized rightmost first with a shared ancestor after every atom built on it. Atoms without a Script are skipped.
_Avoid_: inheritance chain, delegation

**Delivery**:
One message handed to an entity's Message Path from outside Scripts, such as a command's question, a due timer or a lifecycle message, together with the Script work it causes. A Step holds one or more Deliveries.
_Avoid_: dispatch, event

**Host**:
A program that runs a World and its Scripts: the server in Elixir, or a Local World's Worker in TypeScript. Every Host plays a World the same way.
_Avoid_: runtime, backend

**Script**:
NorthTalk code attached to an atom or entity that decides how it behaves.
_Avoid_: behaviour (for the code), handler

**Service Script**:
A Script that belongs to no entity and carries out an Action for every World.
_Avoid_: built-in, system script

## Commands

**Command**:
One thing a Character or NPC asks to do, a Verb with its bound entities and text, as read from what they typed.
_Avoid_: action, input, order

**Verb**:
A named kind of Command, with the forms it can be typed in and the Reach of each noun. Verbs are World data, never Host code.
_Avoid_: command (for the kind)

**Action**:
The change a Command makes to the World once nothing has Vetoed it, carried out by a Service Script.
_Avoid_: built-in, effect

**Reach**:
The part of a Character's Perception that a Verb's noun can name: here, carried, or the room. It never extends past Perception.
_Avoid_: scope, range

**Suggestion**:
A Command the World offers a player to send with one click, which they could equally type.
_Avoid_: action chip, action (for this), shortcut

**Base Verbs**:
The Verbs, Directions, Aliases and articles every World starts with, included from shared EDL.
_Avoid_: built-in verbs, default verbs

**Direction**:
A named way out of a room, such as north or up, paired with its opposite.
_Avoid_: exit (for the word)

**Alias**:
A short word that stands for a Direction or Verb name, such as `n` for north.
_Avoid_: abbreviation, shortcut
