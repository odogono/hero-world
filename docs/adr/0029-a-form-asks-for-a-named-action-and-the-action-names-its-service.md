# A form asks for a named Action, and the Action names its Service

ADR 0024 made Verbs World data, but which Service Script carries out each Action stayed in a table in each Host (`@services` and `@with_text` in `dispatch.ex`, and their twin in `dispatch.ts`), along with the list of Service Scripts to load. Adding a Builder Verb meant editing both Hosts (#307). Now each Verb form asks for an Action by name. An `actions` table in EDL gives each Action the Service that carries it out and the roles it is given (`target` and `actor` by default, with the same role names Vetoes use). A `services` table in EDL declares each Service Script by name and source. The Service gets the Action's name as its message. When the form's pattern has a `text` slot, the rest of the line follows the roles. After the Action succeeds, Receivers are asked `after<Action>`. `look` and `move` are ordinary Actions: `look` is given `room` and `actor`, and `move` is given `exit`, `actor`, `from` and `to`. The Host keeps only role resolution and the refusals that come from it. A World that redeclares an Action or a Service by name replaces it. Building or migrating a World fails if a form asks for an undeclared Action, an Action names an undeclared Service, or a Veto asks an undeclared `service:<name>`.

## Considered Options

- **Name the Service on each form.** Rejected: every form that asks for the same Action repeats the Service, including any form a World adds.
- **Name the Service on the Verb.** Rejected: one Verb's forms ask for different Actions carried out by different Services (`look` asks for `look` from `room` and `examine` from `thing`).
- **Keep `look` and `move` in the Host.** Rejected: the only difference is which roles they pass, and roles are already World data for Vetoes.

## Consequences

- A form's key is `action:`, not `handler:`.
- `exit.talk` answers `move`, not `traverse`. The `beforeTraverse` Veto keeps its name.
- An Action may name no Service, when only the Receivers carry it out, such as Porthleven's `smell`. It is still declared, so a mistyped Action name stops the build.
- A Service's `src` is under a named root (`mua-scripts:scripts/services/thing.talk`) or relative to the World's main EDL file, as a Picture's is. Each Host resolves it, so neither EDL library learns about `services`. A bare path in an included file is therefore relative to the main EDL file, not to the included file.
- A World checks its Actions and Services each time it starts or migrates, as it checks its Pictures.
- The Libraries the Hosts load are still a list in Host code (#330).
