# Adapted from packages/mua/src/server/mua-world/__test__/after.test.ts.
defmodule MuaWorld.AfterTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("after.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "adds the target's reply to the built-in's", c do
    assert send_bob(c, "examine orb") == "A glass orb.\nIt hums faintly."
  end

  test "leaves things without an after handler alone", c do
    assert send_bob(c, "examine rock") == "A plain rock."
  end

  test "adds the room's reply", c do
    assert send_bob(c, "take orb") == "Taken.\nDust swirls where it lay."
  end

  test "asks nothing when the built-in refuses", c do
    send_bob(c, "take orb")
    assert send_bob(c, "take orb") == "You already have that."
  end

  test "runs the built-in once", c do
    send_bob(c, "take rock")
    assert send_bob(c, "i") == "You are carrying: the rock."
  end
end
