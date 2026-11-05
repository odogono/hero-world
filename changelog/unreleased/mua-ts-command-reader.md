---
type: feat
scope: mua
---

A new TypeScript package, `mua-world`, reads Commands the same way the Elixir Host does: `again`, `it`, the `bob hello` shorthand, "which do you mean?" replies, parsing against a World's Verbs and binding nouns within their Reach. It also makes a World's exits. It passes every case in `spec/mua/commands/`, which now also cover `all`, `except`, `and`, `X in Y` and closed containers. This is the first step towards playing a Local World in the browser.
