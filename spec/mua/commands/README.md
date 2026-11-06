# Command conformance cases

Language-neutral cases for the front of a Command: reading what a Character typed, parsing it against the World's Verbs and binding its nouns within their Reach (ADR 0024). Every Host's parser and binder must pass them. Actions are not tested here; the Step cases in [`../steps/`](../steps/README.md) test them.

Each `*.json` file names the EDL World its cases run in. The World includes the Base Verbs with `include "mua-scripts:edl/base.edl"`, and the runner points the `mua-scripts` root at `packages/mua-scripts`.

```json
{
  "edl": "house.edl",
  "actor": "ada",
  "cases": [
    {
      "name": "take a thing",
      "input": "take the lamp",
      "expect": { "commands": [{ "verb": "take", "target": "lamp" }] }
    },
    {
      "name": "take nothing",
      "input": "take",
      "expect": { "reply": "What do you want to take?" }
    }
  ]
}
```

- **`edl`**: the World, relative to this directory. A Host builds it, then makes the exits its rooms declare.
- **`actor`**: the Definition name of the Character who types.
- **`input`**: one line, or a list of lines typed in turn. Each line sees what the ones before it left: the last input `again` repeats, what `it` refers to, and a "which do you mean?" question waiting for a reply. Only the last line's result is checked.
- **`expect`**: one of:
  - `commands`: the bound Commands, in order. Each has a `verb` (the handler) and, when present, `target` and `indirect` (Definition names), `direction` and `text`. A key left out must be absent.
  - `reply`: the message the Character is given instead: an incomplete prompt, a "which do you mean?" question, or why the line couldn't be read.
