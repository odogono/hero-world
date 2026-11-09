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

Joining brings the Character into play, or resumes control of it, and takes over from any other Connection.

### From the client

| Event     | Payload                                                                      | Reply                                                                    |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `command` | `{text, ref?}`: up to 500 characters; `ref` is text or a number, echoed back | `ok {ref}` once the command's Step has committed; `error {ref?, reason}` |
| `logout`  | `{}`                                                                         | `ok`; the Character goes to Limbo at once and the Channel closes         |

A `command` reply of `error {reason: "replaced"}` means another Connection controls the Character.

A `command` whose text starts with `;` is a line of NorthTalk for an admin, one whose email is on `MUA_ADMINS` (#91). It runs as one Step and changes nothing unless it completes. Its result comes back as `output` to that admin only, `=> value` or `!! ` and why. Anyone else is told "You can't do that."

### From the server

| Event     | Payload                                                                  | When                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `output`  | `{lines}`                                                                | Each line the Character is told, only after the World commits the change behind it (ADR 0012).                                                                                                                                                     |
| `state`   | `{room: {name, description, exits, items, players}, inventory, actions}` | On joining, and after each command. `actions` are commands the Character could type next.                                                                                                                                                          |
| `prompt`  | `{text, options}`                                                        | After a command, while the Character must choose: "Which do you mean?". The next command answers it, by an option's number (from 1) or words that pick one. A choice whose thing has gone is refused, never swapped for another.                   |
| `status`  | `{status}`                                                               | `connected` on joining; `replaced` when another Connection takes over, just before this one closes; `limbo` on logging out.                                                                                                                        |
| `mirror`  | `{character, place, components: {name: [row]}}`                          | On joining. Only what the Character perceives: its place, the Elements there it can see, and what it carries, as rows in the shared layout (ADR 0019), each with its `eid`.                                                                        |
| `changes` | `{place, gone, put, remove}`                                             | After each Step that changed what the Character perceives. `gone`: eids to drop entirely; `put`: rows to add or replace; `remove`: `{name: [eid]}` components to drop. A client that missed one rejoins for a fresh `mirror`; nothing is replayed. |

## Connections and recovery

- **One controlling Connection:** a new join takes over. The old Connection is sent `status: replaced` and closed, and can't command. Its closing moves nothing in the World.
- **Grace:** when the controlling Connection drops, the Character stays in play for 30 seconds (`grace_ms`). Rejoining within it resumes control; after it, the Character goes to Limbo. After a restart, every Character still in play gets the same grace.
- **No resubmission:** the server never runs a command again. A client whose Connection dropped before a `command` reply can't know whether it ran, so it marks it unconfirmed and rejoins for a fresh `state` (ADR 0013).
