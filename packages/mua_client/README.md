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
- **Playing offline:** "Play offline" on the sign-in page plays a Local World ([ADR 0023](../../docs/adr/0023-a-local-world-runs-in-a-worker.md), [`mua-local`](../mua-local)): the main World in a Web Worker in this browser, with no sign-in. It speaks the Channel's messages, so play looks the same. The World and its Character are kept in this browser's storage and play on after a reload. The profile menu's **Save world** downloads the World as `mua-world.db`, and **Load world…** plays a saved file in its place, in this browser or another. The build puts the Worker in `priv/static/local`, and the server makes every page cross-origin isolated, as sqlite-wasm's storage needs.
- **Building:** a Builder ([#149](https://github.com/odogono/hero-world/issues/149)) has a **Compose** button beside the command box. It opens the Composer beside the transcript, or in its place on a narrow screen, where "Back to play" returns. A new thing starts with a name to fill in; each component is a card, from those the World marks buildable, saying what it lets the thing do, with readable labels and its component and field names. A noun's words follow the name until edited. **Try it** builds a private Preview World of where the Character stands, from its mirror ([`mua-local`](../mua-local)), with the composition in it: commands run there, each change says whether it happened to the new thing, to you or to something you can see, a command that reaches beyond the mirror says so, and Reset starts it again. **Place** asks first, then the World checks it all and puts it in the room; the panel shows how many of the Builder's quota are placed, and the World's reason when it refuses. A Builder's limits come on joining, so an Account made a Builder while playing sees Compose after a reload.
- **Editing a placed thing:** the line that made a thing offers `edit the satchel` as a Suggestion, a Command to send in one click, as any line's Suggestions do ([#275](https://github.com/odogono/hero-world/issues/275)). The `edit` Verb opens the thing in the Composer with its components as they stand. **Save** sends only what changed, so play the edit didn't touch (someone closing it) stays; the World's reason shows when it refuses, and the edit stays open. Try it puts the edited thing where the real one is, carried or not. An edit arriving over unsaved changes asks before discarding them; closing without saving closes the thing in the World too. **Store** puts the thing away and **Destroy**, after asking, unmakes it, as the `store` and `destroy` Verbs do ([#284](https://github.com/odogono/hero-world/issues/284)). Either closes the Composer; a refusal, such as "empty it first", shows there and leaves it open. If someone else stores or destroys the thing meanwhile, the Composer closes.
- **Choices:** "Which do you mean?" lists its options by number. Clicking one in the latest list sends its number. An older list can't be clicked, since its numbers would mean nothing now. If the thing chosen has gone, the World says so rather than picking another.

| Path                                     | Contents                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/transcript.ts`](src/transcript.ts) | The transcript, as plain data.                                                                                                                                                                           |
| [`src/connection.ts`](src/connection.ts) | The socket and Channel, or a Local World's Worker.                                                                                                                                                       |
| [`src/offline.ts`](src/offline.ts)       | Playing offline: the local Character's name.                                                                                                                                                             |
| [`src/store.ts`](src/store.ts)           | The signals the screens read.                                                                                                                                                                            |
| [`src/App.tsx`](src/App.tsx)             | Sign-in, the name form, then play.                                                                                                                                                                       |
| [`src/composer/`](src/composer/)         | The Composer: the composition and its cards, Try it, Place and Save.                                                                                                                                     |
| [`e2e/`](e2e/)                           | Two players in two browsers, against the real server: the first playable milestone, offline play and building a satchel on `plaza.edl`, and doors, containers, choices, chips and an NPC on `manor.edl`. |
