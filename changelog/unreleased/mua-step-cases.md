---
type: feat
scope: mua
---

Add mua Step cases in `spec/mua/steps/`, which `MuaWorld` runs. Each case joins Characters, types Commands and advances time. It checks what each Command tells the typer, what every Character hears, and where things end up. The cases cover looking, taking, containers, doors and locks, speech, Vetoes, NPCs and Script timers. The TypeScript Host will run the same files.
