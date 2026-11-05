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
    test "finds an entity by its Definition name, or Nothing" do
      {world, talk} = setup_world()

      :ok =
        OdgnEcsTalk.load_atom_script(talk, "person", """
        on lookup name
          ask world to named name
          return it
        end lookup
        """)

      hero = id(world, "hero")
      lamp = OdgnEcsTalk.handle(talk, id(world, "lamp"))
      assert value(ask(talk, hero, "lookup", ["lamp"])) == lamp
      assert value(ask(talk, hero, "lookup", ["nowhere"])) == nil
    end

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
      send arrive to the to of the link of the target
    end go

    on leadsTo place
      return the to of the link of the target is place
    end leadsTo

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

    test "give a Script a reference field as the Handle it names" do
      {world, talk} = links()
      far = OdgnEcsTalk.handle(talk, id(world, "far"))
      near = OdgnEcsTalk.handle(talk, id(world, "near"))

      assert value(ask(talk, id(world, "near"), "leadsTo", [far])) == true
      assert value(ask(talk, id(world, "near"), "leadsTo", [near])) == false
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

  test "a Library calls the world Capability with its caller's Grant" do
    {world, talk} = setup_world()

    {:ok, _} =
      OdgnEcsTalk.add_library(talk, "weights", """
      function heaviest place
        ask world to find place, "item"
        return the weight of the item of item 1 of it
      end heaviest
      """)

    :ok =
      OdgnEcsTalk.load_atom_script(talk, "person", """
      use heaviest from weights

      on weigh place
        return heaviest(place)
      end weigh
      """)

    hall = OdgnEcsTalk.handle(talk, id(world, "hall"))
    assert value(ask(talk, id(world, "hero"), "weigh", [hall])) == Decimal.new("2.0")
  end

  test "knows which entities a Script can answer for" do
    {world, talk} = setup_world()
    :ok = OdgnEcsTalk.load_atom_script(talk, "thing", "on x\n  return 1\nend x")
    :ok = OdgnEcsTalk.load_entity_script(talk, id(world, "lamp"), "on x\n  return 1\nend x")

    assert OdgnEcsTalk.scripted?(talk, id(world, "hero"))
    assert OdgnEcsTalk.scripted?(talk, id(world, "lamp"))
    refute OdgnEcsTalk.scripted?(talk, id(world, "hall"))
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

  @tag :tmp_dir
  test "names the Script that fails to load", %{tmp_dir: dir} do
    File.write!(Path.join(dir, "rock.talk"), "on who\n  return (\nend who")
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
        entity rock { script { src: "rock.talk" } }
        """,
        path: Path.join(dir, "main.edl")
      )

    assert {:error, {path, %NorthTalk.LoadError{}}} =
             OdgnEcsTalk.load_scripts(talk(world), &File.read!/1)

    assert Path.basename(path) == "rock.talk"
  end

  test "a Service Script's code can be replaced, keeping its Grants" do
    {world, talk} = setup_world()
    hero = OdgnEcsTalk.handle(talk, id(world, "hero"))
    :ok = OdgnEcsTalk.put_service_script(talk, "probe", "on run who\n  return 1\nend run")

    :ok =
      OdgnEcsTalk.put_service_script(talk, "probe", """
      on run who
        change who, "stats", {hp: 7}
        return 2
      end run
      """)

    {:ok, pending} = OdgnEcsTalk.request_service(talk, "probe", "run", [hero], now())
    assert value(settle(talk, pending)) == 2
    assert OdgnEcs.get(world, id(world, "hero"), "stats")["hp"] == 7

    assert {:error, %NorthTalk.LoadError{}} =
             OdgnEcsTalk.put_service_script(talk, "probe", "on run\n  return (\nend run")

    {:ok, pending} = OdgnEcsTalk.request_service(talk, "probe", "run", [hero], now())
    assert value(settle(talk, pending)) == 2
  end

  test "a Service Script that fails to load can be loaded again" do
    {world, talk} = setup_world()
    hero = OdgnEcsTalk.handle(talk, id(world, "hero"))

    assert {:error, %NorthTalk.LoadError{}} =
             OdgnEcsTalk.put_service_script(talk, "probe", "on run\n  return (\nend run")

    :ok = OdgnEcsTalk.put_service_script(talk, "probe", "on run who\n  return 1\nend run")

    {:ok, pending} = OdgnEcsTalk.request_service(talk, "probe", "run", [hero], now())
    assert value(settle(talk, pending)) == 1
  end

  describe "a Delivery's host term" do
    # `probe` answers the host term of the Run's Delivery, and its receiver
    @probe """
    on peek
      ask probe to host
      if it is nothing then
        show the target, "nothing"
      else
        show the target, it
      end if
    end peek

    on linger
      wait 2 s
      ask probe to host
      show the target, it
    end linger

    on query
      ask probe to host
      return it
    end query

    on judge, deciding
      ask probe to host
      veto it
    end judge
    """

    defp probe_capability(talk) do
      NorthTalk.Capability.from_functions("probe", %{
        "host" =>
          {[args: [], result: "any", cost: 1],
           fn [], call ->
             case OdgnEcsTalk.delivery(talk, call) do
               %{host: host, receiver: eid} -> {:ok, host && "#{host} for #{eid}"}
               nil -> {:ok, nil}
             end
           end}
      })
    end

    defp probed do
      {world, _} = setup_world()
      talk = talk(world, capabilities: [&probe_capability/1])
      :ok = OdgnEcsTalk.load_atom_script(talk, "person", @probe)
      {talk, id(world, "hero")}
    end

    defp entry(talk, id), do: OdgnEcsTalk.delivery(talk, %NorthTalk.Call{delivery: id})

    test "is seen by a Capability in the Run, and freed once its work ends" do
      {talk, hero} = probed()
      {:ok, id} = OdgnEcsTalk.deliver(talk, hero, "peek", [], host: "look")
      assert entry(talk, id) == %{receiver: hero, host: "look"}

      {:ok, _} = OdgnEcsTalk.pump(talk, now())
      assert_receive {:show, ^hero, "look for " <> _}
      assert entry(talk, id) == nil
    end

    test "is kept while a Run waits" do
      {talk, hero} = probed()
      {:ok, id} = OdgnEcsTalk.deliver(talk, hero, "linger", [], host: "wait")

      {:ok, _} = OdgnEcsTalk.pump(talk, now())
      {:ok, _} = OdgnEcsTalk.pump(talk, now(1000))
      assert entry(talk, id) == %{receiver: hero, host: "wait"}

      {:ok, _} = OdgnEcsTalk.pump(talk, now(3000))
      assert_receive {:show, ^hero, "wait for " <> _}
      assert entry(talk, id) == nil
    end

    test "is seen by a Request's Run in its first Pump" do
      {talk, hero} = probed()
      {:ok, pending} = OdgnEcsTalk.request(talk, hero, "query", [], now(), host: "ask")
      assert value(settle(talk, pending)) == "ask for #{hero}"
      assert entry(talk, pending.delivery) == nil
    end

    test "is seen by a Decision's Run" do
      {talk, hero} = probed()
      {:ok, pending} = OdgnEcsTalk.decide(talk, hero, "judge", [], host: "vote")
      assert {:ok, %Verdict{vetoes: [veto]}} = settle(talk, pending)
      assert veto.reason == "vote for #{hero}"
    end

    test "is Nothing for a Delivery sent without one" do
      {talk, hero} = probed()
      {:ok, _} = OdgnEcsTalk.deliver(talk, hero, "peek")
      {:ok, _} = OdgnEcsTalk.pump(talk, now())
      assert_receive {:show, ^hero, "nothing"}

      assert value(ask(talk, hero, "query")) == nil
    end
  end

  describe "outcomes" do
    @outcomes """
    on greet
      return "hello"
    end greet

    on enrage
      change the target, "stats", {hp: "lots"}
    end enrage

    on linger
      wait 2 s
      return "late"
    end linger

    on beforeGo, deciding
      veto "locked"
    end beforeGo
    """

    defp outcomes do
      {world, talk} = setup_world()
      :ok = OdgnEcsTalk.load_atom_script(talk, "person", @outcomes)
      {talk, id(world, "hero")}
    end

    defp idle(talk, pending, ms \\ 0) do
      {:ok, _} = OdgnEcsTalk.pump_until_idle(talk, now(ms))
      OdgnEcsTalk.outcome(pending)
    end

    test "a Handler that returns has replied" do
      {talk, hero} = outcomes()
      {:ok, pending} = OdgnEcsTalk.request(talk, hero, "greet", [], now())
      assert idle(talk, pending) == {:replied, "hello"}
    end

    test "a message nobody handles, or a Decision allowed, has passed" do
      {talk, hero} = outcomes()
      {:ok, unhandled} = OdgnEcsTalk.request(talk, hero, "dance", [], now())
      {:ok, allowed} = OdgnEcsTalk.decide(talk, hero, "beforeSit")
      assert idle(talk, unhandled) == :passed
      assert idle(talk, allowed) == :passed
    end

    test "a Decision vetoed gives its reason" do
      {talk, hero} = outcomes()
      {:ok, pending} = OdgnEcsTalk.decide(talk, hero, "beforeGo")
      assert idle(talk, pending) == {:vetoed, "locked"}
    end

    test "a Run that fails gives its error" do
      {talk, hero} = outcomes()
      {:ok, pending} = OdgnEcsTalk.request(talk, hero, "enrage", [], now())
      assert {:failed, %ScriptError{}} = idle(talk, pending)
    end

    test "a Run still waiting once idle is waiting, and replies in a later Pump" do
      {talk, hero} = outcomes()
      {:ok, pending} = OdgnEcsTalk.request(talk, hero, "linger", [], now())
      assert {:ok, deadline} = OdgnEcsTalk.pump_until_idle(talk, now())
      assert DateTime.compare(deadline, now(2000)) == :eq
      assert OdgnEcsTalk.outcome(pending) == :waiting
      assert idle(talk, pending, 2000) == {:replied, "late"}
    end

    test "pumps again while `between` sends more work" do
      {talk, hero} = outcomes()
      {:ok, ref} = Agent.start_link(fn -> 2 end)

      between = fn ->
        Agent.get_and_update(ref, fn
          0 -> {false, 0}
          n -> {true, n - 1}
        end)
      end

      {:ok, _} = OdgnEcsTalk.deliver(talk, hero, "greet")
      assert {:ok, nil} = OdgnEcsTalk.pump_until_idle(talk, now(), between: between)
      assert Agent.get(ref, & &1) == 0
    end
  end
end
