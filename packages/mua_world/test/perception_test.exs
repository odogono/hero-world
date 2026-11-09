# A Character's Perception: the one gate on what its Player is told (#164).
defmodule MuaWorld.PerceptionTest do
  use ExUnit.Case, async: true

  alias MuaWorld.Perception

  setup do
    {:ok, world} = OdgnEcs.open(":memory:")
    world = Enum.reduce(MuaWorld.Components.all(), world, &elem(OdgnEcs.define(&2, &1), 1))

    new = fn place, components ->
      {:ok, eid} = OdgnEcs.create(world)
      if place, do: :ok = OdgnEcs.put(world, eid, "location", %{"in" => place})
      for {name, data} <- components, do: :ok = OdgnEcs.put(world, eid, name, data)
      eid
    end

    room = new.(nil, %{"container" => %{"is_closed" => false}})
    elsewhere = new.(nil, %{"container" => %{"is_closed" => false}})
    door = new.(nil, %{"door" => %{"is_closed" => true}})
    _exit = new.(room, %{"portal" => %{"dir" => "north", "to" => elsewhere, "door" => door}})
    ada = new.(room, %{"player" => %{"name" => "Ada"}})
    bob = new.(room, %{"player" => %{"name" => "Bob"}})
    bobs_coin = new.(bob, %{"item" => %{}})
    bag = new.(ada, %{"container" => %{"is_closed" => false}})
    in_bag = new.(bag, %{"item" => %{}})
    crate = new.(room, %{"container" => %{"is_closed" => true}})
    in_crate = new.(crate, %{"item" => %{}})
    far = new.(elsewhere, %{"item" => %{}})

    {:ok,
     world: world,
     room: room,
     elsewhere: elsewhere,
     door: door,
     ada: ada,
     bob: bob,
     bobs_coin: bobs_coin,
     bag: bag,
     in_bag: in_bag,
     crate: crate,
     in_crate: in_crate,
     far: far}
  end

  test "covers the place, its Elements, its exits' doors and what is carried", c do
    p = Perception.of(c.world, c.ada, c.room)

    for eid <- [c.ada, c.room, c.door, c.bob, c.bag, c.in_bag, c.crate],
        do: assert(Perception.perceives?(p, eid))
  end

  test "excludes closed containers' contents, other Characters' and other places", c do
    p = Perception.of(c.world, c.ada, c.room)

    for eid <- [c.in_crate, c.bobs_coin, c.elsewhere, c.far],
        do: refute(Perception.perceives?(p, eid))
  end

  test "includes an open container's contents", c do
    :ok = OdgnEcs.put(c.world, c.crate, "container", %{"is_closed" => false})
    assert Perception.perceives?(Perception.of(c.world, c.ada, c.room), c.in_crate)
  end

  test "is only the Character and what it carries when it has no place", c do
    p = Perception.of(c.world, c.ada, nil)
    assert p.entities == MapSet.new([c.ada, c.bag, c.in_bag])
  end

  test "lists only perceived elements of a holder", c do
    p = Perception.of(c.world, c.ada, c.room)
    assert Perception.elements(p, c.world, c.bob, ["item"]) == []
    assert Perception.elements(p, c.world, c.crate, ["item"]) == []
    assert [{_, _}] = Perception.elements(p, c.world, c.bag, ["item"])
  end
end
