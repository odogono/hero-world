# Adapted from packages/mua/src/server/mua-world/__test__/vetoes.test.ts.
defmodule MuaWorld.VetoesTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("vetoes.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "lets the room being left veto with a Script's reply", c do
    assert send_bob(c, "north") == "The sentry steps in front of you."
    assert send_bob(c, "look") =~ "Gatehouse"
  end

  test "lets the move happen when the Script passes", c do
    assert send_bob(c, "east") =~ "Hall"
  end

  test "lets the room being entered veto with a fixed response", c do
    assert send_bob(c, "south") == "The vault door is sealed."
    assert send_bob(c, "look") =~ "Gatehouse"
  end

  test "lets what holds a thing refuse to give it up", c do
    assert send_bob(c, "take gem from chest") == "The chest snaps shut on your fingers."
    assert send_bob(c, "i") == "You are empty-handed."
  end

  test "lets where a thing is going refuse it", c do
    send_bob(c, "take rock")
    send_bob(c, "east")
    assert send_bob(c, "drop rock") == "The floor is too hot to put anything down."
    assert send_bob(c, "i") == "You are carrying: the rock."
  end

  test "asks nothing when the action can't happen anyway", c do
    assert send_bob(c, "west") == "You can't go west from here."
  end
end
