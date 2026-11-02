defmodule OdgnEdl.Plan do
  @moduledoc """
  What a Migration does, or would do on a dry run.

    * `atoms` - atoms `added`, `changed` (their bases) and `removed`.
    * `created` - Definition names new in the EDL, whose entities are made.
    * `updated` - entities already in the World that change: each with the
      components it is given (`added`), set again (`changed`) and loses
      (`removed`), and its `lineage` `%{from, to}` when its bases change.
    * `kept` - components the EDL sets differently, left as they are because
      play changed them since the EDL last set them (or, for Play state, the
      World doesn't know what the EDL last set).
    * `renamed` - entities whose Definition name changed (`entity b was a`),
      keeping their id and state.
    * `gone` - entities whose Definition name is gone from the EDL. They are
      taken out of play only by the `:prune` option, and then `pruned` is true.
    * `missing` - entities deleted during play, which the EDL doesn't bring back.
  """

  defstruct atoms: %{added: [], changed: [], removed: []},
            created: [],
            updated: [],
            kept: [],
            renamed: [],
            gone: [],
            missing: [],
            pruned: false

  @type entry :: %{eid: OdgnEcs.eid(), name: String.t()}
  @type t :: %__MODULE__{
          atoms: %{added: [String.t()], changed: [String.t()], removed: [String.t()]},
          created: [String.t()],
          updated: [map()],
          kept: [%{components: [String.t()], eid: OdgnEcs.eid(), name: String.t()}],
          renamed: [%{eid: OdgnEcs.eid(), from: String.t(), to: String.t()}],
          gone: [entry()],
          missing: [entry()],
          pruned: boolean()
        }
end
