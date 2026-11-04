defmodule MuaWorld.StepTest do
  use ExUnit.Case, async: true

  alias MuaWorld.{Components, Step, Tables, Talk}

  @moduletag :tmp_dir

  @edl """
  atom loud {}
  entity hall { meta { props: { id: "hall" } } }
  entity ada {
    meta { props: { id: "ada" } }
    player { name: "Ada" }
    location { in: $hall }
  }
  entity bell: loud {
    meta { props: { id: "bell" } }
    location { in: $hall }
  }
  """

  # A ring that shows; a crack changes the bell and shows,
  # then runs out of fuel, failing its Segment
  @loud """
  on ring who
    show who, "Ding!"
  end ring

  on crack who
    change the target, "npc", {active: false}
    show who, "Crack!"
    repeat forever
    end repeat
  end crack
  """

  # The state a World's Step works on, over a database at `path`, with the
  # calling process subscribed to Ada's output.
  defp state(path, opts \\ []) do
    {:ok, world} = OdgnEcs.open(path)
    world = Enum.reduce(Components.all(), world, &elem(OdgnEcs.define(&2, &1), 1))
    Tables.ensure(world)
    {:ok, world, _} = OdgnEdl.load(world, @edl)
    table = Talk.table()

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        on_show: &Tables.tell(world, &1, &2),
        limits: [fuel_per_run: 5_000]
      )

    :ok = OdgnEcsTalk.load_atom_script(talk, "loud", @loud)
    ada = OdgnEdl.entity_named(world, "ada")

    %MuaWorld{
      world: world,
      talk: talk,
      table: table,
      world_ms: 0,
      fault: opts[:fault],
      subscribers: %{ada => [Keyword.get(opts, :subscriber, self())]}
    }
  end

  defp ada(state), do: OdgnEdl.entity_named(state.world, "ada")
  defp bell(state), do: OdgnEdl.entity_named(state.world, "bell")

  defp ring(state, message) do
    who = OdgnEcsTalk.handle(state.talk, ada(state))
    {:ok, _} = OdgnEcsTalk.deliver(state.talk, bell(state), message, [who])
    state
  end

  test "holds output until COMMIT", %{tmp_dir: dir} do
    state = state(Path.join(dir, "world.db"))
    ada = ada(state)

    {lines, _} =
      Step.run(state, fn state ->
        Tables.output(state.world, ada, "Hello.")
        state = Step.pump(ring(state, "ring"))
        refute_received {:mua, _, _}
        state
      end)

    assert lines == [{ada, "Hello."}, {ada, "Ding!"}]
    assert_received {:mua, ^ada, "Hello."}
    assert_received {:mua, ^ada, "Ding!"}
  end

  test "drops output from a Segment that rolls back", %{tmp_dir: dir} do
    state = state(Path.join(dir, "world.db"))
    ada = ada(state)

    {lines, _} = Step.run(state, &ring(&1, "crack"))

    assert lines == []
    refute_received {:mua, ^ada, "Crack!"}
    assert OdgnEcs.get(state.world, bell(state), "npc") == nil
  end

  test "a fault at :before_commit loses only the changes nobody was told of",
       %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    test = self()

    # The Step runs in a process of its own, which the fault kills
    {pid, ref} =
      spawn_monitor(fn ->
        state = state(path, subscriber: test)
        send(test, {:ada, ada(state)})

        # the first Step commits, and Ada hears it
        {_, state} =
          Step.run(state, fn state ->
            :ok = OdgnEcs.put(state.world, bell(state), "npc", %{"active" => true})
            Tables.output(state.world, ada(state), "The bell wakes.")
            state
          end)

        Step.run(%{state | fault: :before_commit}, fn state ->
          :ok = OdgnEcs.put(state.world, bell(state), "npc", %{"active" => false})
          Tables.output(state.world, ada(state), "The bell sleeps.")
          state
        end)
      end)

    assert_receive {:ada, ada}
    assert_receive {:DOWN, ^ref, :process, ^pid, :killed}
    assert_received {:mua, ^ada, "The bell wakes."}
    refute_received {:mua, ^ada, "The bell sleeps."}

    {:ok, world} = OdgnEcs.open(path)
    world = Enum.reduce(Components.all(), world, &elem(OdgnEcs.define(&2, &1), 1))
    bell = OdgnEdl.entity_named(world, "bell")
    assert OdgnEcs.get(world, bell, "npc") == %{"active" => true}
    assert Tables.take_outbox(world) == []
  end
end
