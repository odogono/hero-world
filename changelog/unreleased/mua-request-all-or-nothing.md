---
type: fix
scope: mua
---

A place reset whose Script fails now changes nothing, and the place's own Scripts are no longer told it reset. An admin line that replies `{refused: text}` now leaves no change and shows `!! refused: text`, where it used to keep its changes and show the map.
