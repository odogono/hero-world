# Adapted from packages/mua/src/server/mua-world/__test__/garden.test.ts: the
# walled garden east of the house, in the main world.
defmodule MuaWorld.GardenTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("main", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)
  defp walk(c, commands), do: for(command <- commands, do: send_bob(c, command))

  test "lies east of the house", c do
    walk(c, ["north", "east"])
    assert send_bob(c, "east") =~ "Garden Path"
  end

  test "answers look in a room with a scripted mix-in", c do
    walk(c, ["north", "east", "east"])
    assert send_bob(c, "look") =~ "A gravel path runs between"
  end

  test "smells of roses", c do
    walk(c, ["north", "east", "east"])

    assert send_bob(c, "smell") == "The air is thick with the scent of roses."
    assert send_bob(c, "sniff roses") =~ "heady, sweet scent"
  end

  test "opens the locked shed with the key from the well", c do
    walk(c, ["north", "east", "east"])
    assert send_bob(c, "east") == "The shed door is closed."
    assert send_bob(c, "open door") == "The shed door is locked."

    walk(c, ["north", "north", "take key from bucket", "south", "south"])
    send_bob(c, "unlock door")
    assert send_bob(c, "open door") == "Opened."
    assert send_bob(c, "east") =~ "Garden Shed"
    assert send_bob(c, "read catalogue") =~ "Water them every evening"
  end

  test "lets you water the roses with the watering can", c do
    walk(c, ["north", "east", "east", "north", "north"])
    walk(c, ["take key from bucket", "south", "south"])
    walk(c, ["unlock door", "open door", "east", "take can", "take trowel"])
    send_bob(c, "west")

    assert send_bob(c, "water roses with trowel") == "The trowel won't help the roses."

    assert send_bob(c, "water roses with can") ==
             "You water the roses. They drink gratefully and lift their heads."
  end

  test "has a gardener who greets you and knows where the key is", c do
    walk(c, ["north", "east", "east"])
    received(c.bob)

    send_bob(c, "north")
    assert ~s(Hollis says, "Mind the roses, bob.") in received(c.bob)

    send_bob(c, "say have you seen a key?")

    assert ~s(Hollis says, "The shed key? I dropped it in the well bucket, I think.") in received(
             c.bob
           )
  end

  test "has a gardener who potters off on his own", c do
    walk(c, ["north", "east", "east", "north"])
    received(c.bob)

    run_for(c.world, 50)
    assert "Hollis goes south." in received(c.bob)
  end
end
