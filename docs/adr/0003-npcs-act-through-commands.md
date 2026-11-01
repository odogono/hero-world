# NPCs act by issuing commands, like players

An NPC's Script makes it do things with `tell mua to act the target, "east"`: the text is parsed, bound and dispatched through exactly the pipeline a player's input takes (receivers, vetoes, the built-in action, messages, `after` replies). We chose this over giving Scripts direct operations (`moveTo`, setting components) so that NPCs obey the same rules as players: a sentry can veto them, rooms announce their comings and goings, and new behaviours and world verbs apply to them for free.

## Consequences

- An NPC's command runs on a later tick than the Script that asked for it.
- An NPC can't answer "which do you mean?", so an ambiguous object means its first match, and a command it can't carry out is dropped.
- `ecs-talk`'s direct `world` operations still exist; using them skips the rules on purpose.
