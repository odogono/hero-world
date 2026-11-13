# Destroying a placed thing (#283). Whether it may be destroyed is the
# build Service Script's (mua-scripts/scripts/services/build.talk).
defmodule MuaWorld.DestroyTest do
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
    received(ada)
    received(bob)
    {:ok, world: world, ada: ada, bob: bob, satchel: satchel}
  end

  defp grant(world, eid, builder \\ %{}),
    do: :ok = MuaWorld.set_component(world, account(eid), "builder", builder)

  defp gone?(world, eid),
    do:
      Enum.all?(
        ~w(described item container location made_by),
        &(MuaWorld.component(world, eid, &1) == nil)
      )

  test "a builder at their max_placed destroys a thing, then places another",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    grant(world, ada, %{"max_placed" => 1})

    assert MuaWorld.place(world, account(ada), ada, @satchel) ==
             {:error, "You have placed all 1 things you may."}

    assert send_command(world, ada, "destroy satchel") == "You unmake the satchel."
    assert received(bob) == ["ada unmakes the satchel."]
    assert gone?(world, satchel)
    assert MuaWorld.builder(world, account(ada)).placed == 0
    assert send_command(world, bob, "look at satchel") =~ "can't see"

    assert {:ok, %{placed: 1}} = MuaWorld.place(world, account(ada), ada, @satchel)
  end

  test "a container that holds something is refused, and nothing is written",
       %{world: world, ada: ada, satchel: satchel} do
    spoon = MuaWorld.named(world, "spoon")
    :ok = MuaWorld.set_component(world, spoon, "location", %{"in" => satchel})

    assert send_command(world, ada, "destroy satchel") ==
             "The satchel holds things: empty it first."

    assert MuaWorld.component(world, satchel, "made_by") == %{"account" => account(ada)}
    assert MuaWorld.component(world, satchel, "described")["name"] == "Satchel"
    assert MuaWorld.component(world, spoon, "location") == %{"in" => satchel}
    assert MuaWorld.builder(world, account(ada)).placed == 1
  end

  test "who may destroy is the builder's destroy permission",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    assert send_command(world, bob, "destroy satchel") == "You can't build."

    grant(world, bob)
    assert send_command(world, bob, "destroy satchel") == "You didn't make that."

    grant(world, bob, %{"destroy" => "none"})
    assert send_command(world, bob, "destroy satchel") == "You can't destroy things."

    assert send_command(world, ada, "destroy spoon") ==
             "Only a thing someone placed can be destroyed."

    refute gone?(world, satchel)

    grant(world, bob, %{"destroy" => "any"})
    assert send_command(world, bob, "destroy satchel") == "You unmake the satchel."
    assert gone?(world, satchel)
  end

  test "a destroyed thing is no longer open in anyone's composer",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    grant(world, bob, %{"edit" => "any"})
    assert send_command(world, bob, "edit satchel") == "You open the satchel to edit it."
    assert {:ok, %{eid: ^satchel}} = MuaWorld.editing(world, account(bob), bob)

    assert send_command(world, ada, "destroy satchel") == "You unmake the satchel."
    assert MuaWorld.editing(world, account(bob), bob) == {:ok, nil}
  end

  test "a builder destroys a thing they carry", %{world: world, ada: ada, satchel: satchel} do
    assert send_command(world, ada, "take satchel") =~ "Taken"
    assert send_command(world, ada, "destroy satchel") == "You unmake the satchel."
    assert gone?(world, satchel)
    refute send_command(world, ada, "inventory") =~ "satchel"
  end
end
