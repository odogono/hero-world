# Adapted from packages/mua/src/server/mua-world/__test__/verbs.test.ts.
defmodule MuaWorld.VerbsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("verbs.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)

  test "understands a new verb, for the room to handle", c do
    assert send_bob(c, "pray") == "A calm settles over you."
    assert send_bob(c, "kneel") == "A calm settles over you."
  end

  test "lets the room's own Script answer look past a scripted mix-in", c do
    # the chapel is `room holy`: look climbs past holy's Script to room's
    assert send_bob(c, "look") == "You stand in the Chapel."
    send_bob(c, "east")
    assert send_bob(c, "look") == "You stand in the Yard."
  end

  test "binds a new verb to the things it names", c do
    assert send_bob(c, "pray to altar") == "The altar glows faintly."
  end

  test "says the verb's own incomplete message", c do
    assert send_bob(c, "pray to") == "Pray to whom?"
  end

  test "refuses a new verb where nothing handles it", c do
    send_bob(c, "east")
    assert send_bob(c, "pray") == "You can't do that."
  end

  test "adds forms to a built-in verb, which keeps its own", c do
    assert send_bob(c, "look under altar") ==
             "Something is scratched into the stone beneath: SALVE."

    assert send_bob(c, "look") =~ "Chapel"
    assert send_bob(c, "examine altar") == "A stone altar."
  end

  test "offers the new verbs to complete", c do
    verbs = MuaWorld.verbs(c.world)
    for word <- ~w(pray kneel look), do: assert(word in verbs)
  end
end
