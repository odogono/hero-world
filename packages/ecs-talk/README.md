# ecs-talk

A [NorthTalk](https://github.com/odogono/odgn-talk) Host Adapter for an `odgn-ecs` World.

```ts
const talk = createEcsTalk(world);
talk.loadAtomScript('person', source);
gameLoop.addSystem('talk', talk.system); // systems, then the Pump, then flush
```

- **`entity` Object Kind:** each registered component is an optional property. Reading one gives its map, or Nothing when the entity doesn't have it. `set` replaces the whole component and validates it, so an invalid value fails the Run.
- **Handles:** `talk.handle(eid)` makes the entity's Host Object. Once an entity is deleted, its Handle reads as Nothing. The next Pump after the deletion is flushed drops the Handle.
- **Message Path:** an entity's parent is its rightmost base atom that has a Script, and each scripted atom's parent is found the same way. If no base has a Script, the search continues up through the bases.
- **Elements:** the entities whose `location.in` is this entity, in id order, each named by `meta.props.id`.
- **`world` Capability:** `find place, component` returns a list of Handles; `moveTo thing, place` and `show actor, text` are Host Commands. `show` publishes a `talk:show { actor, text }` event.

In an atom's Script, `me` is its Owner (the atom's own Host Object), and `the target` is the Receiver (the entity the message was delivered to). The Receiver stays the same while the message climbs the path. Write `set the stats of the target to {…}`, not `… of me`.
