# ecs-talk

A [NorthTalk](https://github.com/odogono/odgn-talk) Host Adapter for an `odgn-ecs` World.

```ts
const talk = createEcsTalk(world);
talk.loadAtomScript('person', source);
gameLoop.addSystem('talk', talk.system); // systems, then the Pump, then flush
```

- **`entity` Object Kind:** each registered component is an optional property. Reading one gives its map, or Nothing when the entity doesn't have it. `set` replaces the whole component and validates it, so an invalid value fails the Run.
- **Handles:** `talk.handle(eid)` makes the entity's Host Object the first time it is needed, with its parent already set, so a Script that reaches an entity inside a Run can send to it in that Run ([odgn-talk ADR 0152](https://github.com/odogono/odgn-talk/blob/main/docs/adr/0152-a-host-object-may-be-given-its-parent-when-it-is-made.md)). Once an entity is deleted, its Handle reads as Nothing. The next Pump after the deletion is flushed drops the Handle.
- **Message Path:** an entity's parent is its rightmost base atom that has a Script, and each scripted atom's parent is found the same way. If no base has a Script, the search continues up through the bases.
- **Elements:** the entities whose `location.in` is this entity, in id order, each named by `meta.props.id`.
- **`world` Capability:** `find place, component` returns a list of Handles, and `resolve id` turns an entity id, such as an `s.entityId()` field, into its Handle (Nothing if there is no such entity). `moveTo thing, place` and `show actor, text` are Host Commands. `show` publishes a `talk:show { actor, text }` event.
- **Decisions:** `talk.decide(eid, message, ...args)` asks the entity's Message Path, and its `decided` promise settles with the Verdict after the Pump.

In an atom's Script, `me` is its Owner (the atom's own Host Object), and `the target` is the Receiver (the entity the message was delivered to). The Receiver stays the same while the message climbs the path. Write `set the stats of the target to {…}`, not `… of me`.
