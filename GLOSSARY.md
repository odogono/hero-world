# Hero World

Game worlds described in EDL, stored in an ECS, and driven by NorthTalk Scripts.

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

## World data

**Entity**:
A thing that exists in a World and carries components.
_Avoid_: object, instance

**Atom**:
A named template of components that entities and other atoms extend. It is never itself an entity, and only atoms can be extended.
_Avoid_: prototype, class, archetype

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

**Starting room**:
Where a Character enters the World when it has nowhere valid to return to.
_Avoid_: home, spawn

**World time**:
The World's clock, which advances while the server runs, even with no Players connected, and pauses while it is down. Timers count against it.
_Avoid_: game time, wall-clock time

**Limbo**:
The place that holds what is out of play: stored things, and Characters whose Players have left until they return.
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
