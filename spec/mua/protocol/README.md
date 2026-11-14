# mua protocol cases

Language-neutral cases for how a Connection treats the _form_ of each message it receives, before the World sees it. `packages/mua_server` runs them against the `character:<id>` Channel in `test/protocol_conformance_test.exs`. `packages/mua-local` runs them against a Local World's host in `src/__test__/protocol.test.ts`. What the World then does with a message is for the [Step cases](../steps/README.md).

```json
{
  "cases": [
    {
      "name": "a place without a composition is refused",
      "send": "place",
      "payload": {},
      "reply": { "error": "a place needs a composition" }
    }
  ]
}
```

Each case joins a fresh Character in the main World, then sends one message:

- **`send`**: the message's kind: `command`, `place`, `edit`, `store`, `destroy` or `stop_editing`.
- **`payload`**: what it carries, as the client would send it.
- **`reply`**, one of:
  - **`{"error": reason}`**: its form is refused, with this `reason` word for word.
  - **`"accepted"`**: its form passed. The reply is `ok`, or the World's refusal, which echoes the message's `ref` and isn't a reason any case gives for a form. A case that expects the World to refuse it gives a `ref`. On the server a fresh Account isn't a Builder, while a Local World's always is, so what the World says can differ.

A Local World also replies `not_joined` to a message sent before `join`. No case covers it, since a Channel can't receive a message before it is joined.
