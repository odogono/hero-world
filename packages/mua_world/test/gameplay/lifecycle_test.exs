# Adapted from the homes, reset and start cases of
# packages/mua/src/server/mua-world/__test__/lifecycle.test.ts.
defmodule MuaWorld.LifecycleTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("lifecycle.edl", dir)
    {:ok, world: world, bob: join(world, "bob"), shrine: MuaWorld.named(world, "west_of_house")}
  end

  test "gives each thing its starting place as its home", %{world: world, shrine: shrine} do
    assert MuaWorld.component(world, MuaWorld.named(world, "lamp"), "home") == %{"in" => shrine}
  end

  test "puts strayed things back when a place resets", %{world: world, bob: bob, shrine: shrine} do
    send_command(world, bob, "take lamp")
    send_command(world, bob, "east")
    send_command(world, bob, "drop lamp")

    assert MuaWorld.reset(world, shrine) == 1
    assert location(world, MuaWorld.named(world, "lamp")) == shrine
  end

  test "leaves what a Character carries when a place resets", %{
    world: world,
    bob: bob,
    shrine: shrine
  } do
    send_command(world, bob, "take lamp")
    send_command(world, bob, "east")

    assert MuaWorld.reset(world, shrine) == 0
  end

  test "tells a place's Scripts it has reset", %{world: world, bob: bob, shrine: shrine} do
    received(bob)
    MuaWorld.reset(world, shrine)
    assert "Dust settles over the shrine." in received(bob)
  end

  test "tells Scripts the World has started", %{world: world} do
    assert MuaWorld.component(world, MuaWorld.named(world, "idol"), "item")["weight"] == 7.0
  end
end
