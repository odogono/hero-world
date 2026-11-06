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
    test "refuse instead of the Service Action, inherited from an atom", c do
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

  test "falls through to the Service Action when nobody responds", c do
    assert send_bob(c, "open crate") == "Opening the crate reveals: the coin."
  end
end

# Dispatch on its own: a World on `:memory:` with NorthTalk and the engine,
# and no World process. Each command runs as one Step.
defmodule MuaWorld.DispatchRunTest do
  use ExUnit.Case, async: true

  alias MuaWorld.{Components, Dispatch, Exits, Talk, Tables}
  alias MuaWorld.Commands.Verbs

  setup do
    path = MuaWorld.Case.fixture("dispatch.edl")
    {:ok, world} = OdgnEcs.open(":memory:")
    world = Enum.reduce(Components.all(), world, fn c, w -> elem(OdgnEcs.define(w, c), 1) end)
    Tables.ensure(world)

    {:ok, world, _} =
      OdgnEdl.load(world, File.read!(path), path: path, roots: MuaWorld.Scripts.roots())

    :ok = OdgnEcs.begin(world)
    Exits.expand(world)
    room = named(world, "Attic")
    {:ok, actor} = OdgnEcs.create(world)
    :ok = OdgnEcs.put(world, actor, "described", %{"name" => "bob", "description" => "Bob."})
    :ok = OdgnEcs.put(world, actor, "location", %{"in" => room})
    :ok = OdgnEcs.commit(world)

    table = Talk.table()
    # NorthTalk's owner is linked to the test, and stops with it
    {:ok, talk} = Talk.start(world, table)

    engine =
      OdgnEcsEngine.new(world, talk,
        between: Talk.between(talk, world, table),
        output: fn -> Tables.take_outbox(world) end
      )

    {:ok,
     world: world, engine: engine, actor: actor, room: room, vocabulary: Verbs.from_world(world)}
  end

  # Runs bound commands as one Step, returning what the actor was told
  defp run(c, commands) do
    {{:ok, %{output: lines}}, _engine} =
      OdgnEcsEngine.step(c.engine, fn step ->
        Dispatch.run(step, c.vocabulary, c.actor, commands, "test")
      end)

    for {actor, text} <- lines, actor == c.actor, do: text
  end

  defp named(world, name) do
    Enum.find(OdgnEcs.query(world, with: ["described"]), fn eid ->
      OdgnEcs.get(world, eid, "described")["name"] == name
    end)
  end

  defp location(world, eid), do: OdgnEcs.get(world, eid, "location")["in"]

  test "asks the second object before the thing acted on", c do
    crate = named(c.world, "Crate")
    plinth = named(c.world, "Plinth")

    assert run(c, [%{verb: "open", target_id: crate, indirect_id: plinth}]) ==
             ["The plinth is not a key."]

    assert run(c, [%{verb: "open", target_id: crate}]) == ["The crate is stuck."]
  end

  test "a veto stops the action and leaves no change", c do
    gem = named(c.world, "Gem")
    chest = named(c.world, "Chest")

    assert run(c, [%{verb: "take", target_id: gem}]) == ["The chest snaps shut on your fingers."]
    assert location(c.world, gem) == chest
  end

  test "an after<Verb> reply is merged into the action's", c do
    rock = named(c.world, "Rock")

    assert run(c, [%{verb: "take", target_id: rock}]) == ["Taken.\nDust swirls where it lay."]
    assert location(c.world, rock) == c.actor
  end

  @tag :capture_log
  test "a failing Script gives \"Something went wrong.\" once", c do
    box = named(c.world, "Puzzle box")
    assert run(c, [%{verb: "examine", target_id: box}]) == ["Something went wrong."]
  end

  test "each command is told with its label, in order", c do
    rock = named(c.world, "Rock")
    gem = named(c.world, "Gem")

    assert run(c, [
             %{verb: "take", target_id: gem, label: "Gem"},
             %{verb: "take", target_id: rock, label: "Rock"}
           ]) ==
             [
               "Gem: The chest snaps shut on your fingers.",
               "Rock: Taken.\nDust swirls where it lay."
             ]
  end
end
