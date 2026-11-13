defmodule MuaWorld.Components do
  @moduledoc """
  mua's components, ported from `packages/mua/src/server/mua-world/coms.ts`
  with snake_case names. The World defines them before its Build, so EDL
  authors never write `def` blocks for them. `play_state` marks those that
  play changes, which a Migration treats differently (#100), and
  `buildable` those a builder may compose a new entity from (#259). Both
  Hosts agree on them: `spec/mua/components.json`.

  Left out on purpose: the connection and login components, which Phoenix
  owns (#97), and the event components, since a Step needs no event
  entities.
  """

  alias OdgnEcs.{Column, Component}

  # The columns of `exits`, one per Direction in the Base Verbs. A World's
  # own Directions are World data, but an `exits` component can only name
  # one of these.
  @directions ~w(north northeast east southeast south southwest west northwest up down in out)

  @doc "Every component a mua World defines, `odgn_ecs_talk`'s and `odgn_edl`'s included."
  def all, do: OdgnEcsTalk.components() ++ OdgnEdl.components() ++ mua()

  defp mua do
    [
      b("container", true, [
        col("capacity", :float, default: 10),
        col("is_closed", :boolean, default: false)
      ]),
      b("item", false, [
        col("is_takeable", :boolean, default: true),
        col("weight", :float, default: 1)
      ]),
      c("meta", false, [col("props", :json, default: %{})]),
      c("portal", false, [
        col("dir", :string),
        col("door", :eid),
        col("msg", :string),
        col("to", :eid)
      ]),
      c("door", true, [col("is_closed", :boolean, default: true)]),
      c("exits", false, Enum.map(@directions, &col(&1, :json))),
      c("timers", false, [col("every", :json)]),
      c("npc", true, [col("active", :boolean, default: true)]),
      c("lockable", true, [col("is_locked", :boolean, default: false), col("lock", :string)]),
      c("key", false, [col("opens", :array)]),
      c("verbs", false, [col("defs", :json)]),
      c("words", false, [
        col("directions", :json),
        col("aliases", :json),
        col("articles", :array)
      ]),
      b("readable", false, [col("text", :string)]),
      c("home", true, [col("in", :eid)]),
      b("noun", false, [col("words", :array)]),
      c("responses", false, [
        col("indirect", :json),
        col("room", :json),
        col("target", :json),
        col("veto", :json)
      ]),
      c("messages", false, [col("msg", :json), col("omsg", :json)]),
      c("script", false, [col("src", :string)]),
      b("described", false, [col("description", :string), col("name", :string)]),
      # A person's game identity (ADR 0016). Phoenix maps a Google identity
      # to its id; nothing in the World points at a person directly.
      # `admin` lets the Account run NorthTalk at the prompt (#91); sign-in
      # sets it from the configured admins each time.
      c("account", true, [col("admin", :boolean, default: false)]),
      # An Account that may build (#258): whether it may place, and which
      # placed things it may edit (#274) and destroy (#283), each `none`,
      # `own` or `any`; how many
      # things it may place in all, and the largest container it may make.
      # An Admin grants it; taking it away stops new building, and what was
      # placed stays.
      c("builder", true, [
        col("place", :boolean, default: true),
        col("edit", :string, default: "own"),
        col("destroy", :string, default: "own"),
        col("max_placed", :int, default: 50),
        col("max_capacity", :int, default: 20)
      ]),
      # The placed thing a Character has open in the composer (#274), which
      # its next edit must name. It stays on the server.
      c("editing", true, [col("thing", :eid, on_delete: :nullify)]),
      # The Maker of a placed thing: the Account that built it. It stays on
      # the server: no Perception reads an Account.
      c("made_by", true, [col("account", :eid)]),
      c("player", false, [
        # unique among Characters, ignoring case
        col("name", :string, optional: false, unique: true, case_insensitive: true),
        # the Account that owns the Character
        col("account", :eid),
        col("last_input", :string),
        # what the player last referred to, gone when that is
        col("last_target_id", :eid, on_delete: :nullify),
        col("pending", :json),
        col("return_to", :eid, on_delete: :nullify)
      ])
    ]
  end

  defp c(name, play_state, columns),
    do: %Component{name: name, play_state: play_state, columns: columns}

  # One a builder may compose a new entity from (#259)
  defp b(name, play_state, columns), do: %{c(name, play_state, columns) | buildable: true}

  defp col(name, type, opts \\ []), do: struct(%Column{name: name, type: type}, opts)
end
