# mua Step cases

Language-neutral cases for what a Command does, Actions and all (ADR 0024). `packages/mua_world` runs them in `test/steps_conformance_test.exs`, and the TypeScript Host runs the same files in `packages/mua-world/src/__test__/steps.test.ts`. The command cases in [`../commands/`](../commands/README.md) test only the front of a Command. These test the whole Step: what the typer is told, what everyone hears and where things end up.

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
- **`join`**: the Characters, made in order, each with its own Account, then entered. A Character is named by its join name, which is also its label in the case. An entry `{"name": name, "builder": {...}}` makes a Builder, its Account given a `builder` component with those permissions and limits, each left out at its default. What joining tells anyone isn't checked.
- **`steps`**, in order, each one of:
  - **`{"as": name, "type": line, "told"?: [...], "heard"?: {...}}`**: the Character types a line. `told` is what the Command replies, one entry per message, word for word. A place's Picture is `{"picture": src}`, by the `src` its `picture` gives, since its URL changes with the file (ADR 0027). A line that offers Suggestions is `{"text": line, "suggestions": [...]}`.
  - **`{"as": name, "place": composition, "label"?: label, ...}`**: the Character's Composer Places a thing from this Composition (ADR 0028). `label` names the new thing in later steps.
  - **`{"as": name, "save": label, "patch": {"put"?: {...}, "remove"?: [...]}, ...}`**: the Composer Saves an edit to the thing.
  - **`{"as": name, "store": label, ...}`** and **`{"as": name, "destroy": label, ...}`**: the Composer stores or destroys the thing, as against typing `store` or `destroy`.
  - **`{"as": name, "close": true, ...}`**: the Composer closes whatever it has open.

    Each of these Composer steps takes `told`, what the Character was sent, and `heard`. `refused` is the World's refusal, word for word; a step without one must not be refused. `placed` is `[placed, max_placed]`, the Account's count after the step, when the Host replies with it.

  - **`{"advance": seconds, "heard"?: {...}}`**: runs the World on, one tick per second of World time.
  - **`{"where": {thing: place}}`**: what holds each thing. Both are labels: a Character's join name, a placed thing's `label`, or anything else's Definition name.
  - **`{"mirror": name, "place": label, "sees": {...}}`**: the Character's mirror snapshot (`MuaWorld.mirror/3`, ADR 0019): its place, and each entity it perceives with the fields of its shown components. Entities and the ids in `location.in` and `portal.door` are labels. An exit with no Definition name is its place's label and its direction, as `"hall north"`.
- **`heard`**: the lines each Character was sent since the last step, by label. It leaves out the typer's echo of what it was `told`. A Character not listed must have heard nothing.

To write a case, give its steps without `told`, `heard`, `refused` or `placed` and run the Elixir runner with `MUA_STEPS_RECORD=1`. It prints what each step gave. Check every line before copying it in: a case pins what the World does now.
