# Adapted from packages/ecs-talk/src/__test__: ecs-talk.test.ts,
# segment.test.ts and timer.test.ts.
defmodule OdgnEcsTalkTest do
  use ExUnit.Case, async: true

  import OdgnEcsTalk.Case

  alias NorthTalk.{ScriptError, Verdict}
  alias OdgnEcsTalk.MessagePath

  @edl """
  atom thing { stats { hp: 10 } }
  atom person: thing { stats { hp: 20 } }
  entity hall { meta { props: { id: "hall" } } }
  entity cellar { meta { props: { id: "cellar" } } }
  entity hero: person {
    meta { props: { id: "hero" } }
    location { in: $hall }
  }
  entity lamp {
    meta { props: { id: "lamp" } }
    location { in: $hall }
    item { weight: 2 }
  }
  entity dust { location { in: $hall } }
  """

  defp setup_world(more \\ "") do
    world = world(@edl <> more)
    {world, talk(world)}
  end

  defp map(entries), do: NorthTalk.Map.new(entries)

  describe "Handles" do
    test "read components and Elements" do
      {world, talk} = setup_world()

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", """
        on inspect
          return the stats of the target
        end inspect

        on survey place
          put the number of elements of place into n
          put element "lamp" of place into lamp
          return {count: n, lamp: the weight of the item of lamp, first: element 1 of place = the target}
        end survey
        """)

      hero = id(world, "hero")
      assert value(ask(talk, hero, "inspect")) == map([{"hp", 20}, {"mood", "calm"}])

      hall = OdgnEcsTalk.handle(talk, id(world, "hall"))

      assert value(ask(talk, hero, "survey", [hall])) ==
               map([{"count", 3}, {"lamp", Decimal.new("2.0")}, {"first", true}])
    end

    test "read a missing component as Nothing" do
      {world, talk} = setup_world()

      :ok =
        OdgnEcsTalk.load_atom_script(
          talk,
          "person",
          "on peek\n  return the item of the target is nothing\nend peek"
        )

      assert value(ask(talk, id(world, "hero"), "peek")) == true
    end

    test "pass text through a Handler argument" do
      {world, talk} = setup_world()

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", "on echo s\n  return s & \"!\"\nend echo")

      assert value(ask(talk, id(world, "hero"), "echo", ["hi"])) == "hi!"
    end
  end

  describe "the world Capability" do
    test "finds, moves and shows" do
      {world, talk} = setup_world()
      hero = id(world, "hero")
      cellar = id(world, "cellar")

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", """
        on fetch place, dest
          ask world to find place, "item"
          put it into items
          moveTo item 1 of items, dest
          show the target, "moved " & the length of items
          return the number of elements of dest
        end fetch
        """)

      args = [OdgnEcsTalk.handle(talk, id(world, "hall")), OdgnEcsTalk.handle(talk, cellar)]
      assert value(ask(talk, hero, "fetch", args)) == 1
      assert OdgnEcs.get(world, id(world, "lamp"), "location") == %{"in" => cellar}
      assert_received {:show, ^hero, "moved 1"}
    end

    test "a change that doesn't fit its component fails the Run and writes nothing" do
      {world, talk} = setup_world()
      hero = id(world, "hero")

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", """
        on enrage
          change the target, "stats", {hp: "lots"}
        end enrage
        """)

      assert {:error, %ScriptError{}} = ask(talk, hero, "enrage")
      assert OdgnEcs.get(world, hero, "stats")["hp"] == 20
    end

    test "a Run that writes and then faults leaves no trace" do
      {world, talk} = setup_world()
      hero = id(world, "hero")

      :ok =
        OdgnEcsTalk.load_atom_script(
          talk,
          "person",
          """
          on hurt place
            change the target, "stats", {hp: 1}
            moveTo the target, place
            repeat forever
            end repeat
          end hurt
          """,
          limits: [fuel_per_run: 500]
        )

      assert {:error, %ScriptError{}} =
               ask(talk, hero, "hurt", [OdgnEcsTalk.handle(talk, id(world, "cellar"))])

      assert OdgnEcs.get(world, hero, "stats")["hp"] == 20
      assert OdgnEcs.get(world, hero, "location") == %{"in" => id(world, "hall")}
    end

    test "a Run that writes and completes keeps its writes" do
      {world, talk} = setup_world()
      hero = id(world, "hero")

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", """
        on hurt place
          change the target, "stats", {hp: 1}
          moveTo the target, place
        end hurt
        """)

      ask(talk, hero, "hurt", [OdgnEcsTalk.handle(talk, id(world, "cellar"))])
      assert OdgnEcs.get(world, hero, "stats") == %{"hp" => 1, "mood" => "calm"}
      assert OdgnEcs.get(world, hero, "location") == %{"in" => id(world, "cellar")}
    end
  end

  describe "links and Decisions" do
    @links """
    atom place { link {} }
    entity far: place {}
    entity near: place { link { to: $far } }
    entity shut: place { link { to: $far locked: true } }
    """

    @place """
    on go
      ask world to resolve the to of the link of the target
      send arrive to it
    end go

    on arrive
      show the target, "arrived"
    end arrive

    on probe id
      ask world to resolve id
      return it is nothing
    end probe

    on beforeGo, deciding
      if the locked of the link of the target then veto "locked"
    end beforeGo
    """

    defp links do
      world = world(@links)
      talk = talk(world)
      :ok = OdgnEcsTalk.load_atom_script(talk, "place", @place)
      {world, talk}
    end

    test "deliver to an entity a Script reaches inside a Run" do
      {world, talk} = links()
      far = id(world, "far")
      {:ok, _} = OdgnEcsTalk.deliver(talk, id(world, "near"), "go")
      for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now())

      assert_received {:show, ^far, "arrived"}
    end

    test "resolve an id that names no entity to Nothing" do
      {world, talk} = links()
      assert value(ask(talk, id(world, "near"), "probe", [9999])) == true
    end

    test "answer a Decision with a veto reason" do
      {world, talk} = links()
      {:ok, open} = OdgnEcsTalk.decide(talk, id(world, "near"), "beforeGo")
      {:ok, shut} = OdgnEcsTalk.decide(talk, id(world, "shut"), "beforeGo")

      assert {:ok, %Verdict{verdict: :allowed}} = settle(talk, open)
      assert {:ok, %Verdict{verdict: :vetoed, vetoes: [veto]}} = settle(talk, shut)
      assert veto.reason == "locked"
    end
  end

  describe "the Message Path" do
    test "climbs an unhandled message to the base atom's Script" do
      {world, talk} = setup_world()

      :ok =
        OdgnEcsTalk.load_atom_script(
          talk,
          "thing",
          ~s(on describe\n  return "a thing with " & the hp of the stats of the target\nend describe)
        )

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", ~s(on greet\n  return "hello"\nend greet))

      hero = id(world, "hero")

      assert value(ask(talk, hero, "greet")) == "hello"
      assert value(ask(talk, hero, "describe")) == "a thing with 20"
    end

    test "reaches every base Script, rightmost first" do
      world = world("atom a {}\natom b {}\nentity both: a b {}")
      talk = talk(world)

      :ok =
        OdgnEcsTalk.load_atom_script(
          talk,
          "a",
          ~s(on who\n  return "a"\nend who\non onlyA\n  return "from a"\nend onlyA)
        )

      :ok = OdgnEcsTalk.load_atom_script(talk, "b", ~s(on who\n  return "b"\nend who))

      assert value(ask(talk, id(world, "both"), "who")) == "b"
      assert value(ask(talk, id(world, "both"), "onlyA")) == "from a"
    end

    test "puts a shared ancestor after every atom built on it" do
      world =
        world(
          "atom thing {}\natom box: thing {}\natom fragile: thing {}\nentity vase: box fragile {}"
        )

      talk = talk(world)

      :ok =
        OdgnEcsTalk.load_atom_script(
          talk,
          "thing",
          ~s(on order\n  return "thing"\nend order\non base\n  return "thing"\nend base)
        )

      :ok = OdgnEcsTalk.load_atom_script(talk, "box", ~s(on order\n  return "box"\nend order))
      :ok = OdgnEcsTalk.load_atom_script(talk, "fragile", "on other\n  return 1\nend other")

      vase = id(world, "vase")
      assert value(ask(talk, vase, "order")) == "box"
      assert value(ask(talk, vase, "base")) == "thing"
    end

    test "gives an atom a parent for each path it sits on" do
      world = world("atom a {}\natom b {}\nentity plain: a {}\nentity mixed: b a {}")
      talk = talk(world)
      :ok = OdgnEcsTalk.load_atom_script(talk, "a", "on who\n  pass who\nend who")
      :ok = OdgnEcsTalk.load_atom_script(talk, "b", ~s(on who\n  return "b"\nend who))

      assert value(ask(talk, id(world, "mixed"), "who")) == "b"
      assert {:error, %ScriptError{}} = ask(talk, id(world, "plain"), "who")
    end

    test "re-links paths when an atom's Script loads later" do
      world = world("atom a {}\natom b {}\nentity both: a b {}")
      talk = talk(world)
      :ok = OdgnEcsTalk.load_atom_script(talk, "b", ~s(on who\n  return "b"\nend who))
      both = id(world, "both")
      assert value(ask(talk, both, "who")) == "b"

      :ok = OdgnEcsTalk.load_atom_script(talk, "a", ~s(on onlyA\n  return "a"\nend onlyA))
      assert value(ask(talk, both, "onlyA")) == "a"
    end

    test "linearizes Lineage" do
      lineage = %{"box" => ["thing"], "fragile" => ["thing"], "thing" => []}

      assert MessagePath.linearize(["box", "fragile"], &lineage[&1]) == [
               "fragile",
               "box",
               "thing"
             ]

      assert MessagePath.linearize(["a", "b"], fn _ -> [] end) == ["b", "a"]
      assert MessagePath.linearize([], fn _ -> [] end) == []
    end
  end

  test "a Service Script is reached only by name" do
    {world, talk} = setup_world()

    :ok =
      OdgnEcsTalk.load_service_script(talk, "weigher", """
      on weigh thing
        return the hp of the stats of thing
      end weigh

      on beforeLift thing, deciding
        if the hp of the stats of thing > 15 then
          veto "too heavy"
        end if
      end beforeLift
      """)

    hero = OdgnEcsTalk.handle(talk, id(world, "hero"))
    {:ok, weighed} = OdgnEcsTalk.request_service(talk, "weigher", "weigh", [hero], now())
    {:ok, lifted} = OdgnEcsTalk.decide_service(talk, "weigher", "beforeLift", [hero])

    assert value(settle(talk, weighed)) == 20
    assert {:ok, %Verdict{verdict: :vetoed}} = settle(talk, lifted)

    assert {:error, %ScriptError{outcome: "unhandled"}} =
             ask(talk, id(world, "hero"), "weigh", [hero])

    assert_raise ArgumentError, "No Service Script named nobody", fn ->
      OdgnEcsTalk.decide_service(talk, "nobody", "x")
    end
  end

  @tag :tmp_dir
  test "loads the Scripts the EDL declares", %{tmp_dir: dir} do
    File.write!(Path.join(dir, "person.talk"), ~s(on who\n  return "person"\nend who))
    File.write!(Path.join(dir, "rock.talk"), ~s(on who\n  return "rock"\nend who))
    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce(OdgnEcsTalk.components(), world, fn c, w -> elem(OdgnEcs.define(w, c), 1) end)

    {:ok, world, _} =
      OdgnEdl.load(
        world,
        """
        def script {
          src: string
        }
        atom person { script { src: "person.talk" } }
        entity hero: person {}
        entity rock { script { src: "rock.talk" } }
        """,
        path: Path.join(dir, "main.edl")
      )

    talk = talk(world)
    assert OdgnEcsTalk.load_scripts(talk, &File.read!/1) == :ok
    assert value(ask(talk, id(world, "hero"), "who")) == "person"
    assert value(ask(talk, id(world, "rock"), "who")) == "rock"
  end

  describe "the timer Capability" do
    @bells """
    entity tower {}
    entity chapel {}
    """

    @bell """
    on arm place, secs
      ask clock to now
      tell timer to schedule "bell", it + secs * 1 s, "ring", [place]
    end arm

    on disarm
      tell timer to cancel "bell"
    end disarm

    on ring place
      show place, "ding"
    end ring
    """

    defp bells do
      world = world(@bells)
      talk = talk(world)

      for e <- ["tower", "chapel"],
          do: :ok = OdgnEcsTalk.load_entity_script(talk, id(world, e), @bell)

      {world, talk}
    end

    defp run(talk, eid, message, args) do
      {:ok, _} = OdgnEcsTalk.deliver(talk, eid, message, args)
      for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now())
    end

    defp us(seconds), do: DateTime.to_unix(now(seconds * 1000), :microsecond)

    test "delivers a timer to the entity whose Run set it" do
      {world, talk} = bells()
      tower = id(world, "tower")
      chapel = id(world, "chapel")
      run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, chapel), 5])

      assert [%{"owner" => ^tower, "name" => "bell"}] = OdgnEcsTalk.due_timers(talk, us(5))
      assert OdgnEcsTalk.due_timers(talk, us(4)) == []

      for t <- OdgnEcsTalk.due_timers(talk, us(5)), do: {:ok, _} = OdgnEcsTalk.fire_timer(talk, t)
      for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now(5000))

      assert_received {:show, ^chapel, "ding"}
      assert OdgnEcsTalk.due_timers(talk, us(100)) == []
    end

    test "scopes timer names to the entity, though they share a Script" do
      {world, talk} = bells()
      tower = id(world, "tower")
      chapel = id(world, "chapel")
      run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])
      run(talk, chapel, "arm", [OdgnEcsTalk.handle(talk, chapel), 5])

      assert talk |> OdgnEcsTalk.due_timers(us(5)) |> Enum.map(& &1["owner"]) |> Enum.sort() ==
               Enum.sort([tower, chapel])
    end

    test "belongs to the entity a Request went to" do
      {world, talk} = bells()
      chapel = id(world, "chapel")
      ask(talk, chapel, "arm", [OdgnEcsTalk.handle(talk, chapel), 5])

      assert [%{"owner" => ^chapel}] = OdgnEcsTalk.due_timers(talk, us(5))
    end

    test "replaces a timer of the same name, and cancels one" do
      {world, talk} = bells()
      tower = id(world, "tower")
      run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])
      run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 9])

      assert [%{"at" => at}] = OdgnEcsTalk.due_timers(talk, us(100))
      assert at == us(9)

      run(talk, tower, "disarm", [])
      assert OdgnEcsTalk.due_timers(talk, us(100)) == []
    end

    @tag :tmp_dir
    test "keeps timers in the World, so another adapter fires them", %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      world = world(@bells, path)
      talk = talk(world)
      tower = id(world, "tower")
      :ok = OdgnEcsTalk.load_entity_script(talk, tower, @bell)
      run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])
      OdgnEcs.close(world)

      world = world(@bells, path)
      talk = talk(world)
      :ok = OdgnEcsTalk.load_entity_script(talk, tower, @bell)
      for t <- OdgnEcsTalk.due_timers(talk, us(5)), do: {:ok, _} = OdgnEcsTalk.fire_timer(talk, t)
      for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now(5000))

      assert_received {:show, ^tower, "ding"}
    end
  end
end
