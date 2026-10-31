# Hero World

Game worlds described in EDL, stored in an ECS, and driven by NorthTalk Scripts.

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

## Behaviour

**Handle**:
The Host Object that stands for one entity inside a Script Group.
_Avoid_: proxy, wrapper

**Message Path**:
The route an unhandled message climbs, from an entity through its Lineage's atoms.
_Avoid_: inheritance chain, delegation
