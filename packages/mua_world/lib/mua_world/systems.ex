defmodule MuaWorld.Systems do
  @moduledoc """
  mua's Systems (ADR 0020). A System picks entities and gives each a
  Delivery; their Scripts decide what to do. Each run is a Step of its own,
  and intervals count World time in milliseconds.
  """

  alias OdgnEcs.System

  @doc "Every System a mua World runs."
  def all do
    [
      # Every active NPC gets `heartbeat`, for its Scripts to act on
      %System{
        name: "npc_heartbeat",
        every: 45_000,
        query: [where: [{"npc", "active", true}]],
        run: &heartbeat/2
      }
    ]
  end

  defp heartbeat(npcs, state) do
    system = OdgnEcsTalk.handle(state.talk, state.places.system)

    for npc <- npcs,
        OdgnEcsTalk.scripted?(state.talk, npc),
        do: {:ok, _} = OdgnEcsTalk.deliver(state.talk, npc, "heartbeat", [system])

    state
  end
end
