# Accounts are Entities in the World

An Account is an Entity in the World database, and it owns its Character through a component, so creating a Character or changing who owns one commits in the same Step as the Character itself (ADR 0012, 0015). The mapping from a Google identity to an Account's Entity is in the World database too, in a table of mua's own (`mua_identities`), and the World process writes it in the same Step that makes the Account, so neither can exist without the other. Only the admission allowlist stays outside the World, in Phoenix's configuration (ADR 0010).

The alternative was to keep Accounts entirely outside the World, in Phoenix's own store. Ownership would then live in a second database, and a crash between the two writes could leave a Character with no owner, or an Account pointing at a Character that was never committed. Keeping Accounts in the World also lets Scripts and Migrations see ownership, and the glossary already treats the Account as part of the game.

## Consequences

- The World process is the only writer of Accounts, like every other Entity. Phoenix asks it to create or look up an Account rather than writing one itself.
- Phoenix never opens the World database: it signs an identity in through the World process (`MuaWorld.sign_in`). An earlier version of this ADR kept the mapping in Phoenix's own store; it moved into the World so an Account and its mapping commit together.
- The Google identity mapping refers to an Account's Entity id, so that id must never change. A Migration (ADR 0005) never renumbers Entities, and an Account is made during play with no Definition name, so a Migration leaves it alone.
