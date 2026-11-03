---
type: fix
scope: mua
---

The almere deploy wizard writes its env file without quotes, so the server starts instead of reading quoted values such as a starting room of `'west_of_house'`.
