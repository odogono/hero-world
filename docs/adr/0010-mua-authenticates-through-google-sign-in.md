# Mua authenticates through Google sign-in

The Elixir Mua server will authenticate players through Google sign-in rather than application-managed passwords. The existing gameplay password registration and login flow will not be carried into the new server; credential verification belongs to Google.

A Google identity belongs to a game Account, which owns one playable Character initially. Account and Character remain separate concepts so that identity and access are independent of the entity played in the World, and multiple Characters can be considered later. The Character has a chosen public name; Google name and email are not its public identity.

The first deployment is an invite-only alpha: Google sign-in establishes identity and an explicit allowlist grants admission. Public registration is deferred. The accepted single-connection takeover and disconnect-grace rules are recorded in `docs/mua-next.md`.
