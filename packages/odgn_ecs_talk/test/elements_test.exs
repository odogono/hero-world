defmodule OdgnEcsTalk.ElementsTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component}

  @mark %Component{name: "mark", columns: [%Column{name: "n", type: :int}]}

  setup do
    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce(OdgnEcsTalk.components() ++ [@mark], world, &elem(OdgnEcs.define(&2, &1), 1))

    [room, other] = for _ <- 1..2, do: elem(OdgnEcs.create(world), 1)

    put = fn place, mark ->
      {:ok, eid} = OdgnEcs.create(world)
      :ok = OdgnEcs.put(world, eid, "location", %{"in" => place})
      if mark, do: :ok = OdgnEcs.put(world, eid, "mark", %{"n" => mark})
      eid
    end

    [a, b, c] = [put.(room, 1), put.(room, nil), put.(other, 2)]
    {:ok, world: world, room: room, a: a, b: b, c: c}
  end

  test "lists the entities in a place, in id order", %{world: w, room: room, a: a, b: b} do
    assert OdgnEcsTalk.elements(w, room) == [a, b]
  end

  test "reads components with them, and narrows them", %{world: w, room: room, a: a, b: b} do
    assert OdgnEcsTalk.elements(w, room, select: ["mark"]) == [
             {a, %{"mark" => %{"n" => 1}}},
             {b, %{}}
           ]

    assert OdgnEcsTalk.elements(w, room, with: ["mark"]) == [a]
    assert OdgnEcsTalk.elements(w, room, where: [{"mark", "n", :>, 0}]) == [a]
  end

  test "finds nothing when the Location component isn't defined", %{world: w, room: room} do
    assert OdgnEcsTalk.elements(w, room, location: {"nowhere", "in"}) == []
  end
end
