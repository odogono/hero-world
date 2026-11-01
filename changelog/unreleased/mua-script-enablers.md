---
type: feat
scope: mua
---

Behaviour Scripts can render built-in messages with `ask mua to message handler, kind, indirect`, and share helpers through the `things` Library (`use nameOf, actorName, fits from things`). ecs-talk registers NorthTalk Libraries with `talk.addLibrary`. `lockable.talk` uses both, and now honours a thing's `messages`.
