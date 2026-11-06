# mua Step cases

Language-neutral cases for what a Command does, Actions and all (ADR 0024). `packages/mua_world` runs them in `test/steps_conformance_test.exs`, and the TypeScript Host will run the same files (#216). The command cases in [`../commands/`](../commands/README.md) test only the front of a Command. These test the whole Step: what the typer is told, what everyone hears and where things end up.

```json
{
  "edl": "house.edl",
  "starting_room": "hall",
  "cases": [
    {
      "name": "takes and drops, and others see it",
      "join": ["ada", "bob"],
      "steps": [
        {
          "as": "ada",
          "type": "take lamp",
          "told": ["Taken."],
          "heard": { "bob": ["ada takes the lamp."] }
        },
        { "where": { "lamp": "ada" } }
      ]
    }
  ]
}
```

- **`edl`**: the World, relative to this directory. It includes the Base Verbs with `include "mua-scripts:edl/base.edl"`, and its Scripts are relative to it, in `scripts/`.
- **`starting_room`**: the Definition name of the room new Characters enter.
- **`join`**: the Characters, made in order, each with its own Account, then entered. A Character is named by its join name, which is also its label in the case. What joining tells anyone isn't checked.
- **`steps`**, in order, each one of:
  - **`{"as": name, "type": line, "told"?: [...], "heard"?: {...}}`**: the Character types a line. `told` is what the Command replies, one entry per message, word for word.
  - **`{"advance": seconds, "heard"?: {...}}`**: runs the World on, one tick per second of World time.
  - **`{"where": {thing: place}}`**: what holds each thing. Both are labels: a Character's join name, or anything else's Definition name.
- **`heard`**: the lines each Character was sent since the last step, by label. It leaves out the typer's echo of what it was `told`. A Character not listed must have heard nothing.

To write a case, give its steps without `told` or `heard` and run the Elixir runner with `MUA_STEPS_RECORD=1`. It prints what each step gave. Check every line before copying it in: a case pins what the World does now.
