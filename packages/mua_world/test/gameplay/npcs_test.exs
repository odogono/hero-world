# Adapted from packages/mua/src/server/mua-world/__test__/npcs.test.ts. An
# NPC's command is a Step of its own after the one that prompted it, so what
# it says reaches Characters as output rather than in their command's reply.
defmodule MuaWorld.NpcsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("npcs.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  test "shows the NPCs in a room", %{world: world, bob: bob} do
    assert send_command(world, bob, "look") =~ "Also here: Parrot, Cat"
  end

  test "lets an NPC react to speech with a command of its own", %{world: world, bob: bob} do
    send_command(world, bob, "say pieces of eight")
    assert ~s(Parrot says, "pieces of eight") in received(bob)
  end

  test "can be spoken to", %{world: world, bob: bob} do
    assert send_command(world, bob, "say to polly hello") =~ ~s(You say to Parrot, "hello")
    assert ~s(Parrot says, "hello") in received(bob)
  end

  test "lets an NPC react to someone arriving", %{world: world, bob: bob} do
    send_command(world, bob, "east")
    assert ~s(Trader says, "Welcome to the market!") in received(bob)
  end

  test "lets an NPC act on its own timer", %{world: world, bob: bob} do
    cat = MuaWorld.named(world, "tom")
    square = location(world, cat)

    run_for(world, 9)
    assert location(world, cat) == square

    run_for(world, 3)
    assert "Cat goes east." in received(bob)
    refute location(world, cat) == square
  end

  test "an NPC set inactive stands still", %{world: world, bob: bob} do
    send_command(world, bob, "say hello")
    received(bob)

    :ok =
      MuaWorld.set_component(world, MuaWorld.named(world, "polly"), "npc", %{"active" => false})

    send_command(world, bob, "say pieces of eight")
    refute ~s(Parrot says, "pieces of eight") in received(bob)
  end
end
