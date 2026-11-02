# Adapted from packages/mua/src/server/mua-world/__test__/gameplay.test.ts,
# against the main world (priv/edl/main.edl).
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

    assert output =~ "West of house"
    assert output =~ "the mailbox"
    assert output =~ "Exits: north, south"
  end

  test "starts a look with the room, with no stray blank lines", %{world: world} do
    bob = join(world, "bob")

    assert send_command(world, bob, "look") =~
             ~r/^West of house\n.+\n\nThere is: the mailbox\nExits: north, south$/
  end

  test "moves through an exit and describes the new room", %{world: world} do
    bob = join(world, "bob")

    assert send_command(world, bob, "north") =~ "North of house"
    assert send_command(world, bob, "look") =~ "North of house"
  end

  test "reports a blocked exit", %{world: world} do
    bob = join(world, "bob")
    send_command(world, bob, "north")

    assert send_command(world, bob, "s") =~ "The windows are all barred"
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
    send_command(world, bob, "north")
    assert send_command(world, bob, "again") =~ "You can't go north from here."
  end

  test "lists the commands for help", %{world: world} do
    bob = join(world, "bob")
    help = send_command(world, bob, "help")

    assert help =~ "Commands: look, move, take"
    assert help =~ "read"
  end

  test "reads what is written on a thing", %{world: world} do
    bob = join(world, "bob")
    send_command(world, bob, "open mailbox")

    assert send_command(world, bob, "read leaflet") =~ ~r/^WELCOME TO MUA!/
    assert send_command(world, bob, "read mailbox") == "There's nothing written on it."
  end
end
