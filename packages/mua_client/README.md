# mua_client

The browser client for mua: Preact and TypeScript, built and tested with Bun ([ADR 0009](../../docs/adr/0009-mua-runs-entirely-on-elixir-with-edl-and-northtalk.md), amended in #104). It plays one Character over [`mua_server`](../mua_server)'s Channel, as [its protocol](../mua_server/docs/protocol.md) describes, and Phoenix serves it from one origin.

## Developing

```sh
bun install                      # at the repository root
bun run dev                      # here: builds into ../mua_server/priv/static, rebuilding on change

# beside it, in packages/mua_server
MUA_ALLOWLIST=you@example.com mix phx.server
```

Then open http://localhost:4000. A development build also shows an email form that signs in through the server's dev-only route; `bun run build` makes a release build without it.

```sh
bun run test   # unit tests
bun run e2e    # browser checks: starts the real server on each fixture World
```

The browser checks need Elixir as well, and Chromium for Playwright (`bunx playwright install chromium`).

## The screen

A transcript, a prompt at the bottom and a slim header: somewhere between an Infocom game and a chat app. Room and inventory views come from `look` and `inventory`.

- **No buffered commands:** the prompt takes input only while this Connection controls the Character, so nothing typed offline turns into a later action.
- **Unconfirmed commands:** a command sent just before the Connection drops may or may not have run. It is marked unconfirmed and never sent again (ADR 0013).
- **Gaps:** after a drop, the transcript marks where output may have been missed.
- **Action chips:** the commands from the latest `state` sit as chips above the prompt. Clicking one sends it as if typed.
- **Choices:** "Which do you mean?" lists its options by number. Clicking one in the latest list sends its number. An older list can't be clicked, since its numbers would mean nothing now. If the thing chosen has gone, the World says so rather than picking another.

| Path                                     | Contents                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/transcript.ts`](src/transcript.ts) | The transcript, as plain data.                                                                                                                                      |
| [`src/connection.ts`](src/connection.ts) | The socket and Channel.                                                                                                                                             |
| [`src/store.ts`](src/store.ts)           | The signals the screens read.                                                                                                                                       |
| [`src/App.tsx`](src/App.tsx)             | Sign-in, the name form, then play.                                                                                                                                  |
| [`e2e/`](e2e/)                           | Two players in two browsers, against the real server: the first playable milestone on `plaza.edl`, and doors, containers, choices, chips and an NPC on `manor.edl`. |
