---
type: feat
scope: mua
---

Players log in with a password. A new player chooses one after giving their name; a returning player is asked for it, and three wrong tries close the connection. Passwords are kept hashed (bcrypt). A player from an older world without one chooses one at their next login. Clients may still send name and password together, and the TUI keeps passwords out of its command history.
