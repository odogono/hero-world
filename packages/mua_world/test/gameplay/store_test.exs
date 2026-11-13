# Storing a placed thing and bringing it back (#282). Whether it may be
# stored is the build Service Script's (mua-scripts/scripts/services/build.talk).
defmodule MuaWorld.StoreTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  @satchel %{
    "described" => %{"name" => "Satchel", "description" => "A leather satchel."},
    "item" => %{},
    "container" => %{"capacity" => 5}
  }

  setup %{tmp_dir: dir} do
    world = start("locks.edl", dir)
    ada = join(world, "ada")
    bob = join(world, "bob")
    grant(world, ada)
    {:ok, %{eid: satchel}} = MuaWorld.place(world, account(ada), ada, @satchel)
    key = MuaWorld.named(world, "iron_key")
    :ok = MuaWorld.set_component(world, key, "location", %{"in" => satchel})
    received(ada)
    received(bob)
    limbo = MuaWorld.places(world).limbo
    {:ok, world: world, ada: ada, bob: bob, satchel: satchel, key: key, limbo: limbo}
  end

  defp grant(world, eid, builder \\ %{}),
    do: :ok = MuaWorld.set_component(world, account(eid), "builder", builder)

  defp place(world, eid, name) do
    composition = put_in(@satchel, ["described", "name"], name)
    {:ok, %{eid: eid}} = MuaWorld.place(world, account(eid), eid, composition)
    eid
  end

  test "a builder stores a thing, which keeps what it holds and its place in the quota",
       %{world: world, ada: ada, bob: bob, satchel: satchel, key: key, limbo: limbo} do
    room = location(world, ada)
    assert send_command(world, ada, "store satchel") == "You put away the satchel."
    assert received(bob) == ["ada puts away the satchel."]

    assert location(world, satchel) == limbo
    assert location(world, key) == satchel
    assert MuaWorld.component(world, satchel, "made_by") == %{"account" => account(ada)}
    assert MuaWorld.builder(world, account(ada)).placed == 1
    assert send_command(world, bob, "look at satchel") =~ "can't see"

    # a reset leaves it in Limbo
    MuaWorld.reset(world, room)
    assert location(world, satchel) == limbo
  end

  test "stored lists it, and unstore brings it, with what it holds, to the builder",
       %{world: world, ada: ada, bob: bob, satchel: satchel, key: key} do
    assert send_command(world, ada, "stored") == "You have nothing stored."
    assert send_command(world, ada, "take satchel") =~ "Taken"
    send_command(world, ada, "store satchel")
    received(bob)

    assert send_command(world, ada, "stored") == "You can bring back the satchel."
    assert send_command(world, ada, "unstore the Satchel") == "You bring out the satchel."
    assert received(bob) == ["ada brings out the satchel."]
    # to the room, not into their hands
    assert location(world, satchel) == location(world, ada)
    assert location(world, key) == satchel
    assert send_command(world, ada, "stored") == "You have nothing stored."
  end

  test "who may store is the builder's store permission",
       %{world: world, ada: ada, bob: bob, satchel: satchel, limbo: limbo} do
    assert send_command(world, bob, "store satchel") == "You can't build."
    assert send_command(world, bob, "stored") == "You can't build."

    grant(world, bob)
    assert send_command(world, bob, "store satchel") == "You didn't make that."

    grant(world, bob, %{"store" => "none"})
    assert send_command(world, bob, "store satchel") == "You can't store things."
    assert send_command(world, bob, "unstore satchel") == "You can't store things."

    assert send_command(world, ada, "store spoon") ==
             "Only a thing someone placed can be stored."

    assert location(world, satchel) == location(world, ada)
    assert location(world, MuaWorld.named(world, "spoon")) == location(world, ada)

    # an Admin who may store any placed thing stores and brings back another's
    grant(world, bob, %{"store" => "any"})
    assert send_command(world, bob, "store satchel") == "You put away the satchel."
    assert location(world, satchel) == limbo

    # its Maker, with own, still may; another builder with own may not
    grant(world, bob)
    assert send_command(world, bob, "stored") == "You have nothing stored."
    assert send_command(world, bob, "unstore satchel") == "You have no satchel stored."
    assert location(world, satchel) == limbo

    grant(world, bob, %{"store" => "any"})
    assert send_command(world, bob, "unstore satchel") == "You bring out the satchel."
    assert location(world, satchel) == location(world, bob)
  end

  test "two stored things with the same name are told apart by number",
       %{world: world, ada: ada, satchel: first, limbo: limbo} do
    second = place(world, ada, "Satchel")

    for thing <- [first, second],
        do: :ok = MuaWorld.set_component(world, thing, "location", %{"in" => limbo})

    assert send_command(world, ada, "stored") == "You can bring back the satchel, the satchel."

    assert send_command(world, ada, "unstore satchel") ==
             "You have 2 stored called satchel: say which, from unstore satchel 1 to unstore satchel 2."

    assert send_command(world, ada, "unstore satchel 3") == "You have no satchel 3 stored."
    assert send_command(world, ada, "unstore satchel 2") == "You bring out the satchel."
    assert location(world, second) == location(world, ada)
    assert location(world, first) == limbo
  end

  test "storing closes the thing in every composer",
       %{world: world, ada: ada, bob: bob} do
    grant(world, bob, %{"edit" => "any"})
    assert send_command(world, bob, "edit satchel") == "You open the satchel to edit it."
    assert send_command(world, ada, "store satchel") == "You put away the satchel."
    assert MuaWorld.editing(world, account(bob), bob) == {:ok, nil}
    assert MuaWorld.component(world, bob, "editing") == nil
  end

  test "a destroyed thing is closed in every composer too",
       %{world: world, ada: ada, bob: bob, key: key} do
    :ok = MuaWorld.set_component(world, key, "location", %{"in" => location(world, ada)})
    grant(world, bob, %{"edit" => "any"})
    send_command(world, bob, "edit satchel")
    assert send_command(world, ada, "destroy satchel") == "You unmake the satchel."
    assert MuaWorld.component(world, bob, "editing") == nil
  end
end
