defmodule MuaWorld.Systems do
  @moduledoc """
  mua's Systems (ADR 0020). A System picks entities and gives each a
  Delivery; their Scripts decide what to do. Each run is a Step of its own,
  and intervals count World time in milliseconds.
  """

  alias OdgnEcs.System

  @doc """
  Every System a mua World runs, sending from `system`, the system actor.
  Each runs with the Step's handle (`OdgnEcsEngine.Step`).
  """
  def all(system) do
    [
      # Every active NPC gets `heartbeat`, for its Scripts to act on
      %System{
        name: "npc_heartbeat",
        every: 45_000,
        query: [where: [{"npc", "active", true}]],
        run: &heartbeat(&1, &2, system)
      }
    ]
  end

  defp heartbeat(npcs, step, system) do
    system = OdgnEcsTalk.handle(step.talk, system)

    for npc <- npcs,
        OdgnEcsTalk.scripted?(step.talk, npc),
        do: {:ok, _} = OdgnEcsTalk.deliver(step.talk, npc, "heartbeat", [system])

    :ok
  end
end
