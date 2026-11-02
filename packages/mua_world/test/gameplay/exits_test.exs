# Adapted from packages/mua/src/server/mua-world/__test__/exits.test.ts.
defmodule MuaWorld.ExitsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("exits.edl", dir)
    {:ok, world: world, bob: join(world, "bob"), path: Path.join(dir, "world.db")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "makes an exit to the room named", c do
    assert send_bob(c, "north") =~ "Library"
  end

  test "makes the way back", c do
    # the cellar's `up` makes the hall's `down`
    assert send_bob(c, "down") =~ "Cellar"
    assert send_bob(c, "up") =~ "Hall"
  end

  test "leaves out the way back for a one-way exit", c do
    send_bob(c, "east")
    assert send_bob(c, "west") == "You can't go west from here."
  end

  test "says why an exit that leads nowhere is closed", c do
    assert send_bob(c, "west") == "A painted door. It doesn't open."
  end

  test "keeps an exit declared as an entity over the way back", c do
    send_bob(c, "north")
    assert send_bob(c, "south") == "A bookcase blocks the way."
  end

  test "keeps an exit the room declares over a way back", c do
    # the study's south exit would make the hall's north: the hall's own wins
    assert send_bob(c, "north") =~ "Library"
  end

  test "lists the ways out of a room", c do
    assert send_bob(c, "look") =~ "Exits: north, east, west, down"
  end

  test "makes nothing new when the World starts again", c do
    GenServer.stop(c.world)
    {:ok, world} = OdgnEcs.open(c.path)
    before = length(OdgnEcs.query(world, with: ["portal"]))

    assert MuaWorld.Exits.expand(world) == []
    assert length(OdgnEcs.query(world, with: ["portal"])) == before
  end
end
