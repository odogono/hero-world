# Adapted from packages/mua/src/server/mua-world/__test__/dispatch.test.ts.
defmodule MuaWorld.DispatchTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("objects.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  describe "target responses" do
    test "refuse instead of the built-in action, inherited from an atom", c do
      assert send_bob(c, "take statue") == "It's bolted to the floor."
      assert send_bob(c, "i") == "You are empty-handed."
    end

    test "only apply to their own verb", c do
      assert send_bob(c, "examine statue") == "A marble statue."
    end

    test "apply to each object of a multi-object command", c do
      assert send_bob(c, "take lamp and statue") ==
               "Lamp: Taken.\nStatue: It's bolted to the floor."
    end
  end

  describe "room responses" do
    test "refuse commands made inside the room", c do
      alice = join(c.world, "alice")
      send_bob(c, "take lamp")
      send_bob(c, "east")
      received(alice)

      assert send_bob(c, "drop lamp") == "The floor is too sacred to drop things on."
      assert send_bob(c, "say hello") == "The silence swallows your words."
      assert send_bob(c, "i") == "You are carrying: the lamp."
      assert received(alice) == []
    end

    test "do not apply in other rooms", c do
      send_bob(c, "take lamp")
      assert send_bob(c, "drop lamp") == "Dropped."
    end
  end

  describe "moving" do
    test "goes through an exit and tells both rooms", c do
      alice = join(c.world, "alice")

      assert send_bob(c, "east") =~ "Vault"
      assert "bob goes east." in received(alice)
    end

    test "uses an exit's own messages", c do
      alice = join(c.world, "alice")
      send_bob(c, "east")
      received(alice)

      assert send_bob(c, "down") =~ "You drop through the trapdoor."
      assert "bob tumbles out of the ceiling." in received(alice)
    end

    test "refuses a direction with no exit", c do
      assert send_bob(c, "north") == "You can't go north from here."
    end
  end
end
