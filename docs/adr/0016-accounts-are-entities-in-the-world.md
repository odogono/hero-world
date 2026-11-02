# Accounts are Entities in the World

An Account is an Entity in the World database, and it owns its Character through a component, so creating a Character or changing who owns one commits in the same Step as the Character itself (ADR 0012, 0015). The Phoenix side (#97) keeps only what sign-in needs outside the World: the mapping from a Google identity to an Account's Entity, and the admission allowlist (ADR 0010).

The alternative was to keep Accounts entirely outside the World, in Phoenix's own store. Ownership would then live in a second database, and a crash between the two writes could leave a Character with no owner, or an Account pointing at a Character that was never committed. Keeping Accounts in the World also lets Scripts and Migrations see ownership, and the glossary already treats the Account as part of the game.

## Consequences

- The World process is the only writer of Accounts, like every other Entity. Phoenix asks it to create or look up an Account rather than writing one itself.
- The Google identity mapping refers to an Account's Entity id, so that id must never change. A Migration (ADR 0005) never renumbers Entities, and an Account is made during play with no Definition name, so a Migration leaves it alone.
