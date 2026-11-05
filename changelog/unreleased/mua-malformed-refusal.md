---
type: fix
scope: mua
---

A Script that answers a command with a map other than `{refused: text}`, such as `{refuse: "No."}`, now gets "Something went wrong." and a log line. It used to count as acting, so `after<Verb>` was sent.
