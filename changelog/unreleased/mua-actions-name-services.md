---
type: feat
scope: mua
breaking: true
---

A World's EDL now declares which Service Script carries out each Action, and the Service Scripts themselves, so a World can add a Verb with its own Service without changing either Host. A Verb's form names its Action with `action:` instead of `handler:`, and every Action a form asks for must be declared in an `actions` component (`{}` for one only Receivers carry out). A World that asks for an undeclared Action or Service won't start or migrate.
