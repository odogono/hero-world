# Adapted from packages/mua/src/server/mua-world/__test__/locks.test.ts: the
# same behaviour, built in (MuaWorld.Actions) and as a Script
# (packages/mua-scripts/scripts/services/lockable.talk), must pass every case.
for {kind, fixture} <- [{"BuiltIn", "locks.edl"}, {"Scripted", "locks-scripted.edl"}] do
  defmodule Module.concat(MuaWorld.LocksTest, kind) do
    use ExUnit.Case, async: true

    import MuaWorld.Case

    @moduletag :tmp_dir
    @fixture fixture

    setup %{tmp_dir: dir} do
      world = start(@fixture, dir)
      {:ok, world: world, bob: join(world, "bob")}
    end

    defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

    test "won't open while locked", c do
      assert send_bob(c, "open strongbox") == "The strongbox is locked."
      assert send_bob(c, "examine box") =~ "It is closed and locked."
    end

    test "unlocks with the key that fits, then opens", c do
      send_bob(c, "take iron key")

      assert send_bob(c, "unlock box with iron key") ==
               "You unlock the strongbox with the iron key."

      assert send_bob(c, "open box") == "Opening the strongbox reveals: the gold."
    end

    test "refuses a key that does not fit, or something that is not a key", c do
      send_bob(c, "take tin key")
      send_bob(c, "take spoon")
      assert send_bob(c, "unlock box with tin key") == "The tin key doesn't fit."
      assert send_bob(c, "unlock box with spoon") == "You can't unlock anything with that."
    end

    test "only uses a key you are carrying", c do
      assert send_bob(c, "unlock box with iron key") == "You aren't carrying any iron key."
    end

    test "finds a fitting key you carry when none is named", c do
      send_bob(c, "take tin key")
      send_bob(c, "take iron key")

      assert send_bob(c, "unlock box") ==
               "(with the iron key)\nYou unlock the strongbox with the iron key."
    end

    test "needs a key", c do
      assert send_bob(c, "unlock box") == "You need a key to unlock the strongbox."
    end

    test "locks again only once closed", c do
      send_bob(c, "take iron key")
      send_bob(c, "unlock box")
      send_bob(c, "open box")
      assert send_bob(c, "lock box") == "You'll have to close the strongbox first."
      send_bob(c, "close box")
      # the strongbox's own message for locking
      assert send_bob(c, "lock box") == "(with the iron key)\nThe strongbox's bolts slide home."
      assert send_bob(c, "lock box") == "The strongbox is already locked."
    end

    test "tells others in the room", c do
      alice = join(c.world, "alice")
      received(alice)
      send_bob(c, "take iron key")
      send_bob(c, "unlock box")
      assert "bob unlocks the strongbox." in received(alice)
    end
  end
end
