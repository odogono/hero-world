defmodule MuaWorld.Components do
  @moduledoc """
  mua's components, ported from `packages/mua/src/server/mua-world/coms.ts`
  with snake_case names. The World defines them before its Build, so EDL
  authors never write `def` blocks for them. `play_state` marks those that
  play changes, which a Migration treats differently (#100).

  Left out on purpose: the connection and login components, which Phoenix
  owns (#97), and the event components, since a Step needs no event
  entities.
  """

  alias OdgnEcs.{Column, Component}

  @directions ~w(north northeast east southeast south southwest west northwest up down in out)

  @doc "Every component a mua World defines, `odgn_ecs_talk`'s included."
  def all, do: OdgnEcsTalk.components() ++ mua()

  defp mua do
    [
      c("container", true, [
        col("capacity", :float, default: 10),
        col("is_closed", :boolean, default: false)
      ]),
      c("item", false, [
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
      c("readable", false, [col("text", :string)]),
      c("home", true, [col("in", :eid)]),
      c("noun", false, [col("words", :array)]),
      c("responses", false, [
        col("indirect", :json),
        col("room", :json),
        col("target", :json),
        col("veto", :json)
      ]),
      c("messages", false, [col("msg", :json), col("omsg", :json)]),
      c("script", false, [col("src", :string)]),
      c("described", false, [col("description", :string), col("name", :string)]),
      # A person's game identity (ADR 0016). Phoenix maps a Google identity
      # to its id; nothing in the World points at a person directly.
      c("account", true, []),
      c("player", false, [
        col("name", :string, optional: false),
        # the Account that owns the Character
        col("account", :eid),
        col("last_input", :string),
        col("last_target_id", :eid),
        col("pending", :json),
        col("return_to", :eid)
      ])
    ]
  end

  defp c(name, play_state, columns),
    do: %Component{name: name, play_state: play_state, columns: columns}

  defp col(name, type, opts \\ []), do: struct(%Column{name: name, type: type}, opts)
end
