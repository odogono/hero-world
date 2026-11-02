# Adapted from packages/mua/src/server/mua-world/__test__/command.test.ts.
defmodule MuaWorld.CommandTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("command.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "a Script sees the second object of the command", c do
    send_bob(c, "take feather")

    assert send_bob(c, "unlock box with feather") ==
             "You press the Feather into a gap between the panels."
  end

  test "a Script sees when there is no second object", c do
    assert send_bob(c, "unlock box") == "There is no keyhole you can see."
  end

  test "a Script tells everyone else in the room, but not the actor", c do
    alice = join(c.world, "alice")
    send_bob(c, "take feather")
    received(alice)

    output = send_bob(c, "unlock box with feather")

    assert "bob fiddles with the puzzle box." in received(alice)
    refute output =~ "fiddles"
  end
end
