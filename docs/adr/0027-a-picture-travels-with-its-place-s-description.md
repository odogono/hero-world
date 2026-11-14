# A Picture travels with its place's description

A place's Picture reaches the browser as part of the output that describes the place: when a Character arrives and when it looks. The transcript shows it as a line of its own, just before the description. It does not reach the browser through the View or the Mirror, the usual way component data gets to a client. A Picture belongs where the description is printed, so it is shown exactly as often as the description and stays in the transcript beside it. Both Hosts run the same Scripts, so a Local World shows Pictures as the server does with no extra parity work. A Character only ever gets the description of a place it is in, so Perception holds.

We considered showing the Picture of the Character's current place in a fixed band above the transcript, read from the View and the Mirror. That shows only one Picture at a time and drops them from the transcript's record of where the player has been.

## Consequences

- A Script that describes a place decides whether its Picture goes with it. A place described without its Picture shows none.
- The client never works out a Picture from the components it holds. A Picture is never in the Mirror, so a Preview World's Inspector does not show it.
- The Host checks at Build and Migration that every Picture's file exists, and serves each file under a URL that includes a hash of its content.
