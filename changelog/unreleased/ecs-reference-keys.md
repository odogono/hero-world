---
type: feat
scope: ecs
---

A Reference in the Elixir ECS can only hold an entity that exists. Deleting an entity that something still refers to is refused, unless the Reference says to empty itself or to delete its holder too. In mua, a Character's last target and return room empty themselves, and a timer is deleted with the entity it belongs to. An existing World gets the new keys the next time it starts, and won't start if it holds a Reference to a missing entity.
