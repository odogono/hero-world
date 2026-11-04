defmodule OdgnEcs.SystemTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component, System}

  @npc %Component{name: "npc", columns: [%Column{name: "active", type: :boolean, default: true}]}

  setup do
    {:ok, world} = OdgnEcs.open(":memory:")
    {:ok, world} = OdgnEcs.define(world, @npc)

    [a, b] =
      for active <- [true, false] do
        {:ok, eid} = OdgnEcs.create(world)
        :ok = OdgnEcs.put(world, eid, "npc", %{"active" => active})
        eid
      end

    {:ok, world: world, a: a, b: b}
  end

  defp heartbeat(opts \\ []) do
    struct(
      %System{
        name: "heartbeat",
        every: 45,
        query: [where: [{"npc", "active", true}]],
        run: fn entities, context -> {entities, context} end
      },
      opts
    )
  end

  test "first runs one interval after it is first seen", %{world: w} do
    s = heartbeat()
    assert System.due(w, [s], 100) == []
    assert System.due(w, [s], 144) == []
    assert System.due(w, [s], 145) == [s]
  end

  test "arming records when a System was first seen", %{world: w} do
    s = heartbeat()
    :ok = System.arm(w, [s], 10)
    :ok = System.arm(w, [s], 30)
    assert System.due(w, [s], 54) == []
    assert System.due(w, [s], 55) == [s]
  end

  test "runs over its entities with a context, and waits another interval", %{world: w, a: a} do
    s = heartbeat()
    System.due(w, [s], 0)

    assert System.run(w, s, 50, :ctx) == {[a], :ctx}
    assert System.due(w, [s], 94) == []
    assert System.due(w, [s], 95) == [s]
  end

  test "reads components with its entities", %{world: w, a: a} do
    s = heartbeat(select: ["npc"])
    assert {[{^a, %{"npc" => %{"active" => true}}}], nil} = System.run(w, s, 0, nil)
  end

  test "runs once after missing several intervals", %{world: w} do
    s = heartbeat()
    System.due(w, [s], 0)
    assert System.due(w, [s], 1_000) == [s]
    System.run(w, s, 1_000, nil)
    assert System.due(w, [s], 1_001) == []
  end

  test "keeps its last run in the World, and rolls back with it", %{world: w} do
    s = heartbeat()
    System.due(w, [s], 0)

    :ok = OdgnEcs.savepoint(w, "step")
    System.run(w, s, 45, nil)
    :ok = OdgnEcs.rollback_to(w, "step")

    assert System.due(w, [s], 45) == [s]
  end

  test "keeps each System's interval apart", %{world: w} do
    fast = heartbeat(name: "fast", every: 10)
    slow = heartbeat(name: "slow", every: 100)
    System.due(w, [fast, slow], 0)
    assert System.due(w, [fast, slow], 50) == [fast]
    assert System.due(w, [fast, slow], 100) == [fast, slow]
  end
end
