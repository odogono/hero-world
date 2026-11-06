# Runs the shared Step cases in spec/ecs/steps (ADR 0021), which the
# TypeScript engine runs too. The format is in spec/ecs/README.md.
defmodule OdgnEcsEngine.StepsTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component, SQL}
  alias OdgnEcsEngine.{Delivery, Timers}

  @spec_dir Path.expand("../../../spec/ecs/steps", __DIR__)

  for file <- Path.wildcard(Path.join(@spec_dir, "*.json")) do
    @external_resource file
    spec = file |> File.read!() |> JSON.decode!()

    describe "steps/" <> Path.basename(file) do
      for c <- spec["cases"] do
        test c["name"] do
          run_case(unquote(Macro.escape(spec)), unquote(Macro.escape(c)))
        end
      end
    end
  end

  # The case's Steps, each checked as it runs
  defp run_case(spec, c) do
    engine = engine(spec)
    Enum.reduce(c["steps"], engine, &run_step/2)
  end

  defp run_step(%{"step" => input} = s, engine) do
    {result, engine} = OdgnEcsEngine.step(engine, input(engine, input), step_opts(s))
    take(:steps)
    check_step(engine, s["expect"], result)
    check_deadline(engine, s)
    engine
  end

  defp run_step(%{"advance" => ms} = s, engine) do
    engine = OdgnEcsEngine.advance(engine, ms)
    steps = take(:steps)
    expected = s["expect"]

    assert length(steps) == length(expected),
           "advance #{ms} ran #{length(steps)} Steps: #{inspect(steps)}"

    for {result, expect} <- Enum.zip(steps, expected), do: check_step(engine, expect, result)
    check_deadline(engine, s)
    engine
  end

  defp step_opts(%{"at" => ms}), do: [at: ms]
  defp step_opts(_), do: []

  # -- Building ---------------------------------------------------------------

  defp engine(spec) do
    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce(
        OdgnEcsTalk.components() ++ Enum.map(spec["components"], &component/1),
        world,
        fn c, w -> elem(OdgnEcs.define(w, c), 1) end
      )

    {:ok, world, _} = OdgnEdl.load(world, spec["edl"])
    # Output goes to a table in the World's transaction, as a Host's outbox
    # would, so a Segment or Step that rolls back sends nothing
    SQL.exec!(
      world.conn,
      "CREATE TABLE step_output (id INTEGER PRIMARY KEY, actor INTEGER, text TEXT)"
    )

    take_shown = fn ->
      rows = SQL.all!(world.conn, "SELECT actor, text FROM step_output ORDER BY id")
      SQL.exec!(world.conn, "DELETE FROM step_output")
      rows
    end

    Process.put(:steps, [])

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        on_show: fn eid, text ->
          SQL.run!(world.conn, "INSERT INTO step_output (actor, text) VALUES (?1, ?2)", [
            eid,
            text
          ])
        end,
        limits: [fuel_per_run: 5_000],
        capabilities: [&Timers.capability/1]
      )

    for s <- spec["scripts"] do
      :ok =
        case s do
          %{"atom" => atom} ->
            OdgnEcsTalk.load_atom_script(talk, atom, s["source"])

          %{"entity" => label} ->
            OdgnEcsTalk.load_entity_script(talk, id(world, label), s["source"])

          %{"service" => name} ->
            OdgnEcsTalk.load_service_script(talk, name, s["source"])
        end
    end

    systems = Enum.map(spec["systems"] || [], &system/1)
    :ok = OdgnEcs.System.arm(world, systems, 0)

    OdgnEcsEngine.new(world, talk,
      world_time: 0,
      systems: systems,
      output: take_shown,
      on_step: fn result ->
        Process.put(:steps, Process.get(:steps) ++ [result])
      end
    )
  end

  defp component(%{"name" => name, "columns" => columns}) do
    %Component{
      name: name,
      columns:
        for col <- columns do
          %Column{
            name: col["name"],
            type: String.to_existing_atom(col["type"]),
            default: col["default"]
          }
        end
    }
  end

  # A case's System delivers its message to each entity it selects
  defp system(s) do
    %OdgnEcs.System{
      name: s["name"],
      every: s["every"],
      query: query(s["query"] || %{}),
      run: fn eids, step ->
        for eid <- eids,
            do: {:ok, _} = OdgnEcsEngine.deliver(step, %Delivery{to: eid, message: s["deliver"]})
      end
    }
  end

  defp query(q),
    do: Enum.flat_map(q, fn {"with", names} -> [with: names] end)

  defp id(world, label), do: OdgnEdl.entity_named(world, label) || flunk("No entity #{label}")

  defp take(key) do
    value = Process.get(key)
    Process.put(key, [])
    value
  end

  # -- Inputs -----------------------------------------------------------------

  defp input(engine, %{"deliver" => ds}), do: Enum.map(ds, &delivery(engine, &1))

  defp input(engine, %{"fail" => ds}) do
    fn step ->
      for d <- ds, do: {:ok, _} = OdgnEcsEngine.deliver(step, delivery(engine, d))
      OdgnEcsEngine.pump(step)
      raise "the case's input fails"
    end
  end

  defp input(engine, %{"decide_until_veto" => ds}) do
    fn step ->
      Enum.reduce_while(ds, "passed", fn d, acc ->
        {:ok, pending} =
          OdgnEcsEngine.deliver(step, %{delivery(engine, d) | asks: :decide})

        OdgnEcsEngine.pump(step)

        case OdgnEcsTalk.outcome(pending) do
          {:vetoed, _} = vetoed -> {:halt, outcome(engine, vetoed)}
          _ -> {:cont, acc}
        end
      end)
    end
  end

  defp input(engine, %{"ask" => d}) do
    fn step ->
      answered = fn _step, o -> Process.put(:answered, outcome(engine, o)) end

      case OdgnEcsEngine.ask(step, delivery(engine, d), %{input: d["message"]}, answered) do
        :waiting -> "waiting"
        _ -> Process.delete(:answered)
      end
    end
  end

  defp delivery(engine, d) do
    %Delivery{
      to: id(engine.world, d["to"]),
      message: d["message"],
      args: Enum.map(d["args"] || [], &arg(engine, &1)),
      asks: String.to_existing_atom(d["asks"] || "deliver")
    }
  end

  defp arg(engine, %{"$ref" => label}),
    do: OdgnEcsTalk.handle(engine.talk, id(engine.world, label))

  defp arg(_engine, v), do: v

  # -- Checks -----------------------------------------------------------------

  defp check_step(engine, expect, result) do
    answered = Process.delete(:answered)

    case result do
      {:error, _} ->
        assert expect["error"] == true, "the Step failed: #{inspect(result)}"

      {:ok, out} ->
        refute expect["error"], "the Step committed"
        labels = labels(engine.world)
        check(expect, "result", out.result)
        check(expect, "answered", answered)
        check(expect, "world_time", out.world_time)

        check(expect, "output", for([eid, text] <- out.output, do: [labels[eid], text]))

        check(
          expect,
          "changes",
          for(
            {eid, name, kind, data} <- out.changes,
            do: [labels[eid], name, to_string(kind), data]
          )
        )
    end

    for {label, components} <- expect["world"] || %{}, {name, data} <- components do
      assert OdgnEcs.get(engine.world, id(engine.world, label), name) == data,
             "#{label}'s #{name}"
    end
  end

  defp check(expect, key, actual) do
    if Map.has_key?(expect, key), do: assert(actual == expect[key], key)
  end

  defp check_deadline(engine, s) do
    key = if Map.has_key?(s, "advance"), do: s, else: s["expect"]

    if Map.has_key?(key, "next_deadline"),
      do: assert(OdgnEcsEngine.next_deadline(engine) == key["next_deadline"], "next_deadline")
  end

  defp labels(world) do
    for eid <- OdgnEcs.query(world, with: ["edl_definition"]), into: %{} do
      {eid, OdgnEcs.get(world, eid, "edl_definition")["name"]}
    end
  end

  # An outcome as the cases write it
  defp outcome(_engine, {:replied, v}), do: %{"replied" => plain(v)}
  defp outcome(_engine, :passed), do: "passed"
  defp outcome(_engine, {:vetoed, reason}), do: %{"vetoed" => plain(reason)}
  defp outcome(_engine, {:failed, _}), do: "failed"
  defp outcome(_engine, :waiting), do: "waiting"

  defp plain(v), do: OdgnEcsTalk.Values.from_value(v)
end
