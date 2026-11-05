defmodule OdgnEcsEngine.TimersTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component, SQL}
  alias OdgnEcsEngine.Timers

  @epoch ~U[2000-01-01 00:00:00Z]

  @edl """
  entity tower { meta { props: { id: "tower" } } }
  entity chapel { meta { props: { id: "chapel" } } }
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

  @meta %Component{name: "meta", columns: [%Column{name: "props", type: :json}]}

  defp world(path \\ ":memory:", defs \\ []) do
    {:ok, world} = OdgnEcs.open(path)

    world =
      Enum.reduce(OdgnEcsTalk.components() ++ [@meta | defs], world, fn c, w ->
        elem(OdgnEcs.define(w, c), 1)
      end)

    {:ok, world, _} = OdgnEdl.load(world, @edl)
    :ok = OdgnEcsEngine.Tables.ensure(world)
    world
  end

  defp talk(world) do
    test = self()

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        on_show: &send(test, {:show, &1, &2}),
        capabilities: [&Timers.capability/1]
      )

    for e <- ["tower", "chapel"],
        do: :ok = OdgnEcsTalk.load_entity_script(talk, id(world, e), @bell)

    talk
  end

  defp bells do
    world = world()
    {world, talk(world)}
  end

  defp id(world, name), do: OdgnEdl.entity_named(world, name)
  defp now(ms \\ 0), do: DateTime.add(@epoch, ms, :millisecond)
  defp us(seconds), do: DateTime.to_unix(now(seconds * 1000), :microsecond)

  defp run(talk, eid, message, args) do
    {:ok, _} = OdgnEcsTalk.deliver(talk, eid, message, args)
    for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now())
  end

  test "delivers a timer to the entity whose Run set it" do
    {world, talk} = bells()
    tower = id(world, "tower")
    chapel = id(world, "chapel")
    run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, chapel), 5])

    assert [%{"owner" => ^tower, "name" => "bell"}] = Timers.due(world, us(5))
    assert Timers.due(world, us(4)) == []
    assert Timers.next_at(world) == us(5)

    for t <- Timers.due(world, us(5)), do: {:ok, _} = Timers.fire(talk, t)
    for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now(5000))

    assert_received {:show, ^chapel, "ding"}
    assert Timers.due(world, us(100)) == []
    assert Timers.next_at(world) == nil
  end

  test "scopes timer names to the entity, though they share a Script" do
    {world, talk} = bells()
    tower = id(world, "tower")
    chapel = id(world, "chapel")
    run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])
    run(talk, chapel, "arm", [OdgnEcsTalk.handle(talk, chapel), 5])

    assert world |> Timers.due(us(5)) |> Enum.map(& &1["owner"]) |> Enum.sort() ==
             Enum.sort([tower, chapel])
  end

  test "belongs to the entity a Request went to" do
    {world, talk} = bells()
    chapel = id(world, "chapel")

    {:ok, pending} =
      OdgnEcsTalk.request(talk, chapel, "arm", [OdgnEcsTalk.handle(talk, chapel), 5], now())

    for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now())
    assert OdgnEcsTalk.outcome(pending) != :waiting

    assert [%{"owner" => ^chapel}] = Timers.due(world, us(5))
  end

  test "keeps the Host's own timers apart from Scripts'" do
    {world, _talk} = bells()
    tower = id(world, "tower")

    for at <- [us(3), us(4)],
        do:
          :ok =
            Timers.schedule(world, %{
              owner: tower,
              script: "host",
              name: "tick",
              at: at,
              message: "tick"
            })

    assert [%{"script" => "host", "at" => at} = timer] = Timers.timers(world, "host")
    assert at == us(4)
    assert [^timer] = Timers.due(world, us(4))

    :ok = Timers.remove(world, timer)
    assert Timers.timers(world, "host") == []
  end

  test "replaces a timer of the same name, and cancels one" do
    {world, talk} = bells()
    tower = id(world, "tower")
    run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])
    run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 9])

    assert [%{"at" => at}] = Timers.due(world, us(100))
    assert at == us(9)

    run(talk, tower, "disarm", [])
    assert Timers.due(world, us(100)) == []
  end

  test "goes with the entity it belongs to" do
    {world, talk} = bells()
    tower = id(world, "tower")
    run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])

    :ok = OdgnEcs.delete(world, tower)
    assert Timers.owned_by(world, tower) == []
  end

  @tag :tmp_dir
  test "keeps timers in the World, so another adapter fires them", %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    world = world(path)
    talk = talk(world)
    tower = id(world, "tower")
    run(talk, tower, "arm", [OdgnEcsTalk.handle(talk, tower), 5])
    OdgnEcs.close(world)

    world = world(path)
    talk = talk(world)
    for t <- Timers.due(world, us(5)), do: {:ok, _} = Timers.fire(talk, t)
    for _ <- 1..3, do: OdgnEcsTalk.pump(talk, now(5000))

    assert_received {:show, ^tower, "ding"}
  end

  test "moves a World's `talk_timer` entities into the engine's table (ADR 0022)" do
    talk_timer = %Component{
      name: "talk_timer",
      play_state: true,
      columns: [
        %Column{name: "owner", type: :eid, optional: false, on_delete: :cascade},
        %Column{name: "script", type: :string, optional: false},
        %Column{name: "name", type: :string, optional: false},
        %Column{name: "at", type: :int, optional: false, index: true},
        %Column{name: "message", type: :string, optional: false},
        %Column{name: "args", type: :string, optional: false}
      ]
    }

    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce([@meta, talk_timer], world, fn c, w -> elem(OdgnEcs.define(w, c), 1) end)

    {:ok, world, _} = OdgnEdl.load(world, @edl)
    tower = id(world, "tower")

    for {name, at} <- [{"late", 9}, {"early", 5}] do
      {:ok, eid} = OdgnEcs.create(world)

      :ok =
        OdgnEcs.put(world, eid, "talk_timer", %{
          "owner" => tower,
          "script" => "entity:#{tower}",
          "name" => name,
          "at" => us(at),
          "message" => "ring",
          "args" => "[]"
        })
    end

    :ok = OdgnEcsEngine.Tables.ensure(world)
    # and again, as the next start does
    :ok = OdgnEcsEngine.Tables.ensure(world)

    assert world |> Timers.owned_by(tower) |> Enum.map(&{&1["name"], &1["at"]}) ==
             [{"early", us(5)}, {"late", us(9)}]

    assert OdgnEcs.query(world, with: ["talk_timer"]) == []
    assert SQL.one!(world.conn, "SELECT count(*) FROM entities") == [2]
  end
end
