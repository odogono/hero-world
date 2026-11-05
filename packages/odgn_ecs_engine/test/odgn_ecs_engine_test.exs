defmodule OdgnEcsEngineTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component, SQL}
  alias OdgnEcsEngine.{Delivery, Tables}

  @edl """
  atom loud {}
  entity hall { meta { props: { id: "hall" } } }
  entity bell: loud { meta { props: { id: "bell" } } }
  """

  # A ring that shows; a crack marks the bell and shows, then runs out of
  # fuel, failing its Segment; slow answers once its wait is over
  @loud """
  on ring
    show the target, "Ding!"
  end ring

  on crack
    change the target, "mark", {n: 1}
    show the target, "Crack!"
    repeat forever
    end repeat
  end crack

  on slow
    wait 2 s
    show the target, "Slow."
    return "done"
  end slow

  on judge, deciding
    veto "no"
  end judge
  """

  @defs [
    %Component{name: "meta", columns: [%Column{name: "props", type: :json}]},
    %Component{name: "mark", columns: [%Column{name: "n", type: :int}]}
  ]

  # A World whose Scripts' `show` lines go to a `shown` table, inside its
  # transaction, as a Host's outbox would, and an engine whose output is
  # those lines and whose hook tells the test process.
  defp engine(opts \\ []) do
    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce(OdgnEcsTalk.components() ++ @defs, world, fn c, w ->
        elem(OdgnEcs.define(w, c), 1)
      end)

    {:ok, world, _} = OdgnEdl.load(world, @edl)
    SQL.exec!(world.conn, "CREATE TABLE shown (id INTEGER PRIMARY KEY, text TEXT)")

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        on_show: fn _, text ->
          SQL.run!(world.conn, "INSERT INTO shown (text) VALUES (?1)", [text])
        end,
        limits: [fuel_per_run: 5_000]
      )

    :ok = OdgnEcsTalk.load_atom_script(talk, "loud", @loud)
    test = self()

    output = fn ->
      lines = for [t] <- SQL.all!(world.conn, "SELECT text FROM shown ORDER BY id"), do: t
      SQL.run!(world.conn, "DELETE FROM shown")
      lines
    end

    OdgnEcsEngine.new(
      world,
      talk,
      Keyword.merge([output: output, on_step: &send(test, {:step, &1})], opts)
    )
  end

  defp bell(engine), do: OdgnEdl.entity_named(engine.world, "bell")
  defp to_bell(engine, message), do: %Delivery{to: bell(engine), message: message}

  describe "step/3" do
    test "sends a list of Deliveries in order, and hooks the output after the commit" do
      engine = engine()
      ring = to_bell(engine, "ring")

      {{:ok, out}, _} = OdgnEcsEngine.step(engine, [ring, ring], at: 500)

      assert out.output == ["Ding!", "Ding!"]
      assert out.world_time == 500
      assert_received {:step, {:ok, ^out}}
      assert Tables.world_time(engine.world) == 500
    end

    test "gives a callback a handle, and returns what it returns" do
      engine = engine()

      {{:ok, out}, _} =
        OdgnEcsEngine.step(engine, fn step ->
          # a Host may read the World between Deliveries, as at a Veto
          {:ok, pending} =
            OdgnEcsEngine.deliver(step, %{to_bell(engine, "judge") | asks: :decide})

          OdgnEcsEngine.pump(step)

          case OdgnEcsTalk.outcome(pending) do
            {:vetoed, reason} ->
              reason

            _ ->
              {:ok, _} = OdgnEcsEngine.deliver(step, to_bell(engine, "ring"))
              :rang
          end
        end)

      assert out.result == "no"
      assert out.output == []
    end

    test "a Script whose Segment fails loses only that Segment" do
      engine = engine()

      {{:ok, out}, engine} = OdgnEcsEngine.step(engine, [to_bell(engine, "crack")])

      assert out.output == []
      assert OdgnEcs.get(engine.world, bell(engine), "mark") == nil
    end

    test "an input that raises rolls the whole Step back, and waiting inputs carry on" do
      engine = engine()
      bell = bell(engine)
      k = fn _step, outcome -> send(self(), {:answered, outcome}) end

      {{:ok, _}, engine} =
        OdgnEcsEngine.step(engine, fn step ->
          :waiting =
            OdgnEcsEngine.ask(
              step,
              %{to_bell(engine, "slow") | asks: :request},
              %{input: "slow"},
              k
            )
        end)

      {{:error, %RuntimeError{message: "boom"}}, engine} =
        OdgnEcsEngine.step(engine, fn step ->
          :ok = OdgnEcs.put(step.world, bell, "mark", %{"n" => 2})
          {:ok, _} = OdgnEcsEngine.deliver(step, to_bell(engine, "ring"))
          raise "boom"
        end)

      assert_received {:step, {:error, %RuntimeError{}}}
      assert OdgnEcs.get(engine.world, bell, "mark") == nil
      assert [%{input: "slow"}] = waiting_rows(engine)

      engine = OdgnEcsEngine.advance(engine, 2_000)
      assert_received {:answered, {:replied, "done"}}
      assert waiting_rows(engine) == []
    end

    test "a listed Delivery that can't be sent fails the Step" do
      engine = engine()

      {{:error, %ArgumentError{}}, _} =
        OdgnEcsEngine.step(engine, [
          to_bell(engine, "ring"),
          %Delivery{to: {:service, "nobody"}, message: "ring", asks: :request}
        ])

      assert_received {:step, {:error, _}}
      refute_received {:step, {:ok, _}}
      assert SQL.all!(engine.world.conn, "SELECT text FROM shown") == []
    end
  end

  describe "Waiting inputs" do
    test "an answer after the Pumps are idle continues in the Step that sees it" do
      engine = engine()
      test = self()

      {{:ok, out}, engine} =
        OdgnEcsEngine.step(engine, fn step ->
          OdgnEcsEngine.ask(
            step,
            %{to_bell(engine, "slow") | asks: :request},
            %{actor: 7, input: "ring slowly"},
            fn step, outcome -> send(test, {:answered, step.now, outcome}) end
          )
        end)

      assert out.result == :waiting
      assert waiting_rows(engine) == [%{actor: 7, input: "ring slowly"}]
      assert OdgnEcsEngine.next_deadline(engine) == 2_000

      engine = OdgnEcsEngine.advance(engine, 1_000)
      refute_received {:answered, _, _}

      engine = OdgnEcsEngine.advance(engine, 2_000)
      assert_received {:answered, 2_000, {:replied, "done"}}
      assert_received {:step, {:ok, %{output: ["Slow."]}}}
      assert waiting_rows(engine) == []
      assert OdgnEcsEngine.next_deadline(engine) == nil
    end

    test "a restart takes those left waiting" do
      engine = engine()

      {{:ok, _}, engine} =
        OdgnEcsEngine.step(engine, fn step ->
          OdgnEcsEngine.ask(
            step,
            %{to_bell(engine, "slow") | asks: :request},
            %{input: "x"},
            fn _, _ -> :ok end
          )
        end)

      assert Tables.take_waiting(engine.world) == [%{actor: nil, input: "x"}]
      assert Tables.take_waiting(engine.world) == []
    end
  end

  describe "advance/2" do
    test "runs due timers, earliest first, then Systems, each as a Step" do
      test = self()

      system = %OdgnEcs.System{
        name: "chime",
        every: 1_000,
        run: fn _, step -> send(test, {:ran, :chime, step.now}) end
      }

      engine =
        engine(
          systems: [system],
          timers: %{
            "host:test" => fn step, timer ->
              OdgnEcsTalk.remove_timer(step.talk, timer)
              send(test, {:ran, timer["name"], step.now})
            end
          }
        )

      bell = bell(engine)
      :ok = OdgnEcs.System.arm(engine.world, [system], 0)

      for {name, ms} <- [{"late", 900}, {"early", 800}],
          do:
            :ok =
              OdgnEcsTalk.schedule(engine.talk, %{
                owner: bell,
                script: "host:test",
                name: name,
                at: OdgnEcsEngine.instant_us(ms),
                message: name
              })

      assert OdgnEcsEngine.next_deadline(engine) == 800

      engine = OdgnEcsEngine.advance(engine, 1_000)

      assert collect() == [{"early", 1_000}, {"late", 1_000}, {:chime, 1_000}]
      assert OdgnEcsEngine.next_deadline(engine) == 2_000
      assert Tables.world_time(engine.world) == 1_000
    end
  end

  defp collect(acc \\ []) do
    receive do
      {:ran, name, at} -> collect([{name, at} | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  defp waiting_rows(engine) do
    for [actor, input] <-
          SQL.all!(engine.world.conn, "SELECT actor, input FROM ecs_engine_waiting ORDER BY id"),
        do: %{actor: actor, input: input}
  end
end
