# Adapted from packages/mua/src/server/mua-world/__test__/scripts.test.ts.
defmodule MuaWorld.ScriptsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("scripts.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "answers with the thing's Script", c do
    assert send_bob(c, "examine statue") == "The statue winks at you."
  end

  test "falls through to the built-in action when the Script passes", c do
    assert send_bob(c, "take statue") == "Taken."
    assert send_bob(c, "i") == "You are carrying: the statue."
  end

  test "uses the built-in action for things without a Script", c do
    assert send_bob(c, "examine rock") == "A plain rock."
  end

  test "lets the room's Script refuse a command", c do
    assert send_bob(c, "north") == "A guard blocks your way."
    assert send_bob(c, "look") =~ "Guardroom"
  end

  test "lets a Script react and still pass the command on", c do
    alice = join(c.world, "alice")
    received(alice)
    output = send_bob(c, "say hello")

    assert output =~ ~s(You say, "hello")
    lines = received(alice)
    assert ~s(bob says, "hello") in lines
    # `show the target` from the room's Script reaches everyone in the room
    assert "The guard grunts." in lines
  end

  test "reports a Script that fails, leaving no change", c do
    assert send_bob(c, "examine tablet") == "Something went wrong."
    tablet = MuaWorld.named(c.world, "tablet")
    assert MuaWorld.component(c.world, tablet, "item")["weight"] == 1.0
  end
end
