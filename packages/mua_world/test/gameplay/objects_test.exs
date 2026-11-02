# Adapted from packages/mua/src/server/mua-world/__test__/objects.test.ts.
defmodule MuaWorld.ObjectsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("objects.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  describe "examine" do
    test "describes a thing by name or one of its noun words", c do
      assert send_bob(c, "examine lamp") == "A brass oil lamp."
      assert send_bob(c, "look at the anvil") == "A very heavy anvil."
      assert send_bob(c, "x lantern") == "A brass oil lamp."
    end

    test "says when nothing matches", c do
      assert send_bob(c, "examine sword") == "You can't see any sword here."
    end

    test "says whether a container is open", c do
      assert send_bob(c, "examine crate") =~ "It is closed."
      send_bob(c, "open crate")
      assert send_bob(c, "look in crate") =~ "It contains: the coin."
    end

    test "refers back to the last object with it", c do
      send_bob(c, "examine lamp")
      assert send_bob(c, "examine it") == "A brass oil lamp."
    end
  end

  describe "take and drop" do
    test "picks a thing up and puts it down", c do
      assert send_bob(c, "take lamp") == "Taken."
      assert send_bob(c, "inventory") == "You are carrying: the lamp."
      assert send_bob(c, "take lamp") == "You already have that."
      assert send_bob(c, "drop lamp") == "Dropped."
      assert send_bob(c, "i") == "You are empty-handed."
    end

    test "only drops what you're carrying", c do
      assert send_bob(c, "drop lamp") == "You aren't carrying any lamp."
    end

    test "refuses things that can't be taken", c do
      assert send_bob(c, "take anvil") == "You can't take that."
    end

    test "cannot reach into a closed container", c do
      assert send_bob(c, "take coin") == "You can't see any coin here."
      assert send_bob(c, "take coin from crate") == "The crate is closed."
    end

    test "takes from an open container", c do
      assert send_bob(c, "open crate") == "Opening the crate reveals: the coin."
      assert send_bob(c, "take the coin from the crate") == "Taken."
      assert send_bob(c, "look in crate") =~ "It is empty."
    end

    test "takes everything it can, one reply per object", c do
      output = send_bob(c, "take all")

      assert output =~ "Brass key: Taken."
      assert output =~ "Iron key: Taken."
      assert output =~ "Lamp: Taken."
      assert output =~ "Anvil: You can't take that."
    end

    test "leaves what you carry out of take all, and drops it all", c do
      send_bob(c, "take lamp")

      refute send_bob(c, "take all") =~ "Lamp"
      assert send_bob(c, "drop all") =~ "Lamp: Dropped."
      assert send_bob(c, "i") == "You are empty-handed."
    end

    test "takes everything except what is named", c do
      output = send_bob(c, "get all except lamp and anvil")

      assert output =~ "Brass key: Taken."
      refute output =~ "Lamp"
      refute output =~ "Anvil"
    end

    test "takes a list of things", c do
      assert send_bob(c, "take lamp and brass key") == "Lamp: Taken.\nBrass key: Taken."
    end

    test "tells others in the room", c do
      alice = join(c.world, "alice")
      send_bob(c, "take lamp")

      assert "bob takes the lamp." in received(alice)
    end

    test "uses a thing's own messages, set directly or inherited", c do
      alice = join(c.world, "alice")

      assert send_bob(c, "take vase") == "You lift the vase with both hands."
      send_bob(c, "drop vase")
      assert "bob sets the vase down very gently." in received(alice)
    end
  end

  describe "ambiguity" do
    test "asks which one, then acts on the answer", c do
      assert send_bob(c, "take key") == "Which do you mean: the brass key or the iron key?"
      assert send_bob(c, "brass") == "Taken."
      assert send_bob(c, "inventory") == "You are carrying: the brass key."
    end

    test "uses adjectives to tell things apart", c do
      assert send_bob(c, "take iron key") == "Taken."
    end

    test "treats an unrelated reply as a new command", c do
      send_bob(c, "take key")
      assert send_bob(c, "examine lamp") == "A brass oil lamp."
      assert send_bob(c, "iron") == ~s(Unknown command: "iron")
    end

    @tag :tmp_dir
    test "keeps the question across a restart", %{tmp_dir: dir} do
      path = Path.join(dir, "kept.db")
      world = start("objects.edl", dir, path: path)
      bob = join(world, "bob")
      send_command(world, bob, "take key")
      GenServer.stop(world)

      world = start("objects.edl", dir, path: path)
      assert send_command(world, bob, "iron") == "Taken."
    end
  end

  describe "repeating" do
    test "again repeats the last command", c do
      send_bob(c, "examine lamp")
      assert send_bob(c, "again") == "A brass oil lamp."
      assert send_bob(c, "g") == "A brass oil lamp."
    end

    test "says when there is nothing to repeat", c do
      assert send_bob(c, "again") == "There is nothing to repeat."
    end
  end

  describe "speaking to someone" do
    test "treats a player name as the start of say to", c do
      alice = join(c.world, "alice")

      assert send_bob(c, "alice hello there") == ~s(You say to alice, "hello there")
      assert ~s(bob says to alice, "hello there") in received(alice)
    end

    test "shows other players in the room", c do
      join(c.world, "alice")
      assert send_bob(c, "look") =~ "Also here: alice"
    end
  end

  test "lists the commands", c do
    assert send_bob(c, "help") =~ "Commands: look, move, take"
  end
end
