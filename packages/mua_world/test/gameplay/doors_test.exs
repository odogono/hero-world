# Adapted from packages/mua/src/server/mua-world/__test__/doors.test.ts.
defmodule MuaWorld.DoorsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("doors.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "blocks the way while closed, and says so in the exits", c do
    assert send_bob(c, "look") =~ "Exits: north (closed)"
    assert send_bob(c, "north") == "The oak door is closed."
  end

  test "can be examined from the room", c do
    assert send_bob(c, "examine door") == "A heavy oak door.\nIt is closed and locked."
  end

  test "opens once unlocked, and lets you through", c do
    assert send_bob(c, "open door") == "The oak door is locked."
    send_bob(c, "take key")
    send_bob(c, "unlock door")
    assert send_bob(c, "open door") == "Opened."
    assert send_bob(c, "north") =~ "Study"
  end

  test "is one door from both sides", c do
    alice = join(c.world, "alice")
    send_bob(c, "take key")
    send_bob(c, "unlock door")
    send_bob(c, "open door")
    send_bob(c, "north")
    received(alice)

    # closed from the study, it is closed in the hall too
    assert send_bob(c, "close door") == "Closed."
    assert "The oak door closes." in received(alice)
    assert send_bob(c, "south") == "The oak door is closed."
    assert send_command(c.world, alice, "north") == "The oak door is closed."

    # and locked from the study, it is locked in the hall
    send_bob(c, "lock door")
    assert send_command(c.world, alice, "open door") == "The oak door is locked."
  end

  test "can't be taken", c do
    assert send_bob(c, "take door") == "You can't take that."
  end
end
