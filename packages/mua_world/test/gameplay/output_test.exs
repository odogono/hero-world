# Adapted from packages/mua/src/server/mua-world/__test__/output.test.ts and
# the renderer tests in messages.test.ts.
defmodule MuaWorld.OutputTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  alias MuaWorld.Messages

  @moduletag :tmp_dir

  describe "telling" do
    setup %{tmp_dir: dir} do
      world = start("objects.edl", dir)
      bob = join(world, "bob")
      alice = join(world, "alice")
      carol = join(world, "carol")
      for c <- [bob, alice, carol], do: received(c)
      {:ok, world: world, bob: bob, alice: alice, carol: carol}
    end

    test "tells the actor what only they should hear", c do
      assert send_command(c.world, c.bob, "take lamp") == "Taken."

      assert received(c.alice) == ["bob takes the lamp."]
      assert received(c.carol) == ["bob takes the lamp."]
    end

    test "says nothing to a player who has gone", c do
      :ok = MuaWorld.leave(c.world, account(c.alice), c.alice)
      received(c.alice)

      send_command(c.world, c.bob, "say Anyone there?")
      assert received(c.alice) == []
      assert Enum.any?(received(c.carol), &(&1 =~ "Anyone there?"))
    end
  end

  describe "rendering a message" do
    @values %{
      "actor" => "bob",
      "dir" => "north",
      "target" => "lamp",
      the: %{"target" => "the lamp"}
    }

    test ~s(fills in names, with or without "the") do
      assert Messages.render("{actor} takes {the target}.", @values) == "bob takes the lamp."
      assert Messages.render("{actor} goes {dir}.", @values) == "bob goes north."
    end

    test "capitalises a placeholder written with a capital" do
      assert Messages.render("{The target} glows. {Actor} grins.", @values) ==
               "The lamp glows. Bob grins."
    end

    test "leaves unknown placeholders alone" do
      assert Messages.render("{actor} eyes {the indirect}.", @values) ==
               "bob eyes {the indirect}."
    end
  end
end
