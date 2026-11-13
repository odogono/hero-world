# Adapted from packages/mua/src/server/mua-world/__test__/gameplay.test.ts,
# against the main world (priv/edl/main.edl), Porthleven.
defmodule MuaWorld.GameplayTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    {:ok, world: start("main", dir)}
  end

  test "looks at the starting room", %{world: world} do
    bob = join(world, "bob")
    output = send_command(world, bob, "look")

    assert output =~ "Harbour Steps"
    assert output =~ "There is: the crate"
    assert output =~ "Exits: north, south, east, west"
  end

  test "starts a look with the room, with no stray blank lines", %{world: world} do
    bob = join(world, "bob")

    assert send_command(world, bob, "look") =~
             ~r/^Harbour Steps\n.+\n\nYou see: the sea, the noticeboard\nThere is: the crate\nAlso here: Morwenna\nExits: north, south, east, west\n\nThe tide is out\..+$/
  end

  test "moves through an exit and describes the new room", %{world: world} do
    bob = join(world, "bob")

    assert send_command(world, bob, "north") =~ "The Square"
    assert send_command(world, bob, "look") =~ "The Square"
  end

  test "reports a blocked exit", %{world: world} do
    bob = join(world, "bob")
    assert send_command(world, bob, "s") =~ "The ferry has gone"
  end

  test "tells others in the room when someone arrives", %{world: world} do
    alice = join(world, "alice")
    send_command(world, alice, "north")
    bob = join(world, "bob")
    received(alice)

    send_command(world, bob, "north")
    assert Enum.join(received(alice), "\n") =~ "bob arrives."
  end

  test "says something to the room", %{world: world} do
    alice = join(world, "alice")
    bob = join(world, "bob")
    received(alice)

    assert send_command(world, bob, "say Hello Alice") =~ ~s(You say, "Hello Alice")
    assert Enum.join(received(alice), "\n") =~ ~s(bob says, "Hello Alice")
  end

  test "repeats the previous command with again", %{world: world} do
    bob = join(world, "bob")

    assert send_command(world, bob, "g") =~ "There is nothing to repeat."
    send_command(world, bob, "east")
    assert send_command(world, bob, "again") =~ "You can't go east from here."
  end

  test "lists the commands for help", %{world: world} do
    bob = join(world, "bob")
    help = send_command(world, bob, "help")

    assert help =~ "Commands: look, move, take"
    assert help =~ "read"
  end

  test "reads what is written on a thing", %{world: world} do
    bob = join(world, "bob")
    send_command(world, bob, "open crate")

    assert send_command(world, bob, "read card") =~ ~r/^PORTHLEVEN TIDES\./
    assert send_command(world, bob, "read crate") == "There's nothing written on it."
  end
end
