---
type: feat
scope: mua
---

Add "Play offline" to the browser client. It plays a Local World, the main World in a Web Worker in this browser, with no sign-in, and a reload plays on where it left off. The client build includes the Worker, and the server now makes every page cross-origin isolated (COOP and COEP), as the Worker's sqlite-wasm storage needs.
