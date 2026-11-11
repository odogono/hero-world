# The browser protocol

A browser plays one Character over a Phoenix Channel. The messages don't depend on which commands exist: a command is text, and what comes back is lines of text and a view of the World. `MuaServer.Protocol` checks and builds them.

## Signing in

`GET /` serves the browser client ([`packages/mua_client`](../../mua_client)), built into `priv/static`.

| Request                      | Does                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/google`           | Redirects to Google.                                                                                                            |
| `GET /auth/google/callback`  | Signs the identity in if its verified email is on `MUA_ALLOWLIST`, then redirects to `/`; `403` otherwise.                      |
| `POST /auth/dev {email}`     | The same, by email alone. Only in development and tests; never compiled into a release.                                         |
| `DELETE /auth`               | Signs out.                                                                                                                      |
| `GET /api/session`           | `{account, characters: [{id, name, in_play}], socket_token}`, or `401`.                                                         |
| `POST /api/character {name}` | Makes the Account's Character: `201 {id, name}`. `409` if it has one already; `422 {error}` for `name_taken` or `invalid_name`. |

The session is an HttpOnly, SameSite=Lax cookie, which keeps it off cross-site POSTs.

## The Channel

Connect the socket at `/socket` with `{token: socket_token}`, then join `character:<id>`. Joining is refused with `{reason}`: `not_owner` for another Account's Character, `no_such_character` for a topic that names none.

Joining brings the Character into play, or resumes control of it, and takes over from any other Connection. The join's reply is `{builder}`: for a Builder's Account, `{placed, max_placed, max_capacity}`, how many things it has placed, how many it may, and the largest container `capacity` it may make; otherwise `null`.

### From the client

| Event          | Payload                                                                      | Reply                                                                                |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `command`      | `{text, ref?}`: up to 500 characters; `ref` is text or a number, echoed back | `ok {ref}` once the command's Step has committed; `error {ref?, reason}`             |
| `place`        | `{composition, ref?}`: a map of component names to their data                | `ok {ref, eid, placed, max_placed}` once the thing is placed; `error {ref?, reason}` |
| `logout`       | `{}`                                                                         | `ok`; the Character goes to Limbo at once and the Channel closes                     |
| `edit`         | `{eid, patch, ref?}`: the thing the `edit` Verb opened, and what to change   | `ok {ref, eid}` once the edit is saved; `error {ref?, reason}`                       |
| `stop_editing` | `{}`                                                                         | `ok`; the thing the `edit` Verb opened is closed without saving                      |

A `command` reply of `error {reason: "replaced"}` means another Connection controls the Character.

A `command` reply of `error {reason: "busy"}` means the World is too far behind to take it (#139). The command did nothing, and the client shows it as not sent; it may be sent again.

A `place` puts a new thing a Builder composed in the room their Character stands in, as one Step (#258). The World's `build` Service Script ([`mua-scripts/scripts/services/build.talk`](../../mua-scripts/scripts/services/build.talk)) decides, and refuses, with the `reason` to show, unless:

- the Account is a Builder (it has a `builder` component) and has placed fewer than its `max_placed`;
- the composition holds only the components a builder may compose, those whose definitions are marked `buildable` (`described`, `noun`, `item`, `container` and `readable`), each a map of that component's properties, with values its columns take;
- `described` has a `name` of at most 40 characters, and any `description` is at most 500;
- a `container`'s `capacity`, or its default if left out, is at most the Builder's `max_capacity`.

A refused `place` writes nothing. A placed thing records its Maker, the Account, in `made_by`, which no `mirror` or `changes` carries. The Builder is told `You make the satchel.`, and everyone else in the room that they made it.

```json
{
  "composition": {
    "described": { "name": "Satchel", "description": "A leather satchel." },
    "item": {},
    "container": { "capacity": 5, "is_closed": true }
  },
  "ref": 7
}
```

A Builder edits a thing it placed in two steps (#274). The `edit` Verb (`edit satchel`) opens a placed thing within reach; the server then pushes `compose` with the thing's composition as it stands. Saving sends `edit` with a patch: the components to add or change, with only the properties that changed, and the components to remove. Properties left out keep their values, so an edit doesn't undo what play changed meanwhile, such as someone closing the satchel.

```json
{
  "eid": 42,
  "patch": {
    "put": {
      "described": { "description": "A battered satchel." },
      "readable": { "text": "Property of ada." }
    },
    "remove": ["container"]
  },
  "ref": 8
}
```

The `build` Service Script decides, as for a `place`, and refuses with the `reason` to show, unless:

- the thing is the one the `edit` Verb opened, and is still in the room or carried;
- the Account is a Builder whose `edit` permission covers it: `own` for things it made, `any` for any placed thing, never `none`;
- the thing as edited keeps to the rules of a `place`, with its Maker's `max_capacity`, whoever edits;
- it strands nothing: a container that holds things keeps `container` and room for them, and a thing a Character carries keeps `item`.

A refused edit writes nothing, and the thing stays open. A saved one closes it, and the room is told the Builder reshaped it. An edit never changes a thing's Maker, location or Home, nor uses up its Maker's `max_placed`.

An Admin makes an Account a Builder at the `;` prompt, and stops it building there; what it placed stays:

```
;change the account of the player of actor, "builder", {}
;remove the account of the player of actor, "builder"
```

For another player in the room, `element "bob" of here` stands for their Character. `{max_placed: 10, max_capacity: 5}` sets other limits than the defaults (50 and 20). `builder` also holds the Account's permissions: `place` (`true` or `false`, default `true`) and `edit` (`"none"`, `"own"` or `"any"`, default `"own"`). An Admin who will edit others' things gives themselves `{edit: "any"}`.

A `command` whose text starts with `;` is a line of NorthTalk for an admin, one whose email is on `MUA_ADMINS` (#91). It runs as one Step and changes nothing unless it completes. Its result comes back as `output` to that admin only, `=> value` or `!! ` and why. Anyone else is told "You can't do that."

### From the server

| Event     | Payload                                                                  | When                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `output`  | `{lines}`                                                                | Each line the Character is told, only after the World commits the change behind it (ADR 0012).                                                                                                                                                     |
| `state`   | `{room: {name, description, exits, items, players}, inventory, actions}` | On joining, and after each command. `actions` are commands the Character could type next.                                                                                                                                                          |
| `prompt`  | `{text, options}`                                                        | After a command, while the Character must choose: "Which do you mean?". The next command answers it, by an option's number (from 1) or words that pick one. A choice whose thing has gone is refused, never swapped for another.                   |
| `status`  | `{status}`                                                               | `connected` on joining; `replaced` when another Connection takes over, just before this one closes; `limbo` on logging out.                                                                                                                        |
| `compose` | `{eid, composition}`                                                     | After the `edit` Verb opens a placed thing, and again on rejoining while it is open: its buildable components as they stand, for the composer.                                                                                                     |
| `mirror`  | `{character, place, components: {name: [row]}}`                          | On joining. Only what the Character perceives: its place, the Elements there it can see, and what it carries, as rows in the shared layout (ADR 0019), each with its `eid`.                                                                        |
| `changes` | `{place, gone, put, remove}`                                             | After each Step that changed what the Character perceives. `gone`: eids to drop entirely; `put`: rows to add or replace; `remove`: `{name: [eid]}` components to drop. A client that missed one rejoins for a fresh `mirror`; nothing is replayed. |

## Connections and recovery

- **One controlling Connection:** a new join takes over. The old Connection is sent `status: replaced` and closed, and can't command. Its closing moves nothing in the World.
- **Grace:** when the controlling Connection drops, the Character stays in play for 30 seconds (`grace_ms`). Rejoining within it resumes control; after it, the Character goes to Limbo. After a restart, every Character still in play gets the same grace.
- **No resubmission:** the server never runs a command again. A client whose Connection dropped before a `command` reply can't know whether it ran, so it marks it unconfirmed and rejoins for a fresh `state` (ADR 0013).
