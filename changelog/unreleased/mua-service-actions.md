---
type: feat
breaking: true
scope: mua
---

Every Action is now a Service Script in `mua-scripts/scripts/services/`: `thing` (examine, take, drop, inventory, read), `open` (open, close), `speech` (say, say to) and `help`, beside `room`, `exit` and `lock`. `MuaWorld.Actions` and `MuaWorld.Messages` are gone. Scripts fill in message templates with the `messages` Library, and the default templates are World data in `base.edl`. A thing's fixed `responses` now answer only when it extends the Base EDL's `responsive` atom. `mua act` also takes a command already bound, such as `{verb: "move", direction: "east"}`. The `mua message` Capability function is gone; `notice` takes an optional text, and `verbs` lists the Verbs for `help`.
