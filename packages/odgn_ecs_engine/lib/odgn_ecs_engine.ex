defmodule OdgnEcsEngine do
  @moduledoc """
  The engine above the store (ADRs 0018 and 0021): Steps, Deliveries,
  Waiting inputs, World time, timers and runs of Systems, for a World whose
  Scripts run through `odgn_ecs_talk`. It has no process and keeps no
  clock: the Host owns both, and calls it from the one process that writes
  the World (ADR 0011).

  A Host uses it through four things:

    * `step/3` runs one input as one Step: begin, the input, Pumps until
      the Group is idle, the Waiting inputs it settles, then one `COMMIT`.
    * `advance/2` moves World time on and runs each due timer and System as
      a Step of its own.
    * `next_deadline/1` says when `advance/2` next has work.
    * The `:on_step` hook is called with each Step's output after its
      commit, or with the error that rolled it back.

  ## Inputs

  A Step's input is either a list of `OdgnEcsEngine.Delivery`s, sent in
  order, or a function of an `OdgnEcsEngine.Step` handle, for a Host that
  reads the World between Deliveries, such as stopping at the first Veto.
  What the function returns is the Step's `result`.

  ## Waiting inputs

  A Request or Decision asked with `ask/4` that hasn't been answered once
  the Pumps are idle waits: its continuation runs in the Step that sees its
  Run end. Meanwhile it keeps an `ecs_engine_waiting` row, so a restarted
  Host can tell its actor it was abandoned (`OdgnEcsEngine.Tables.take_waiting/1`).

  ## Failure

  If the input raises or exits, or a listed Delivery can't be sent, the
  whole Step rolls back: nothing is committed, `:on_step` gets
  `{:error, reason}`, and inputs that were already waiting carry on. A
  Script whose Segment fails is not a failed Step: only its Segment rolls
  back. A failed `COMMIT` leaves NorthTalk ahead of the database, so it
  exits the Host's process, which restarts from the last commit.

  ## Timers

  Timers are the engine's (`OdgnEcsEngine.Timers`), kept in the World. A
  Host gives Scripts the `timer` Capability by starting its adapter with
  `capabilities: [&OdgnEcsEngine.Timers.capability/1]`.

  ## Order at one World time

  `advance/2` keeps World time, then runs, each as its own Step:

  1. the timers due, earliest first, and oldest first at the same time;
  2. one Step for NorthTalk, if its deadline (such as the end of a Script's
     `wait`) has come;
  3. the Systems due, in the order the Host gave them.

  ## Options for `new/3`

    * `:world_time` - World time to start at, in milliseconds; by default
      what the World last committed.
    * `:systems` - the `OdgnEcs.System`s to run. Each runs with the Step
      handle as its context.
    * `:timers` - `%{script => fun}`: the Host's own timers, by the script
      name it stored them under (`OdgnEcsEngine.Timers.schedule/2`). Each due one is
      given to `fun.(step, timer)` instead of being delivered, and is the
      Host's to remove.
    * `:between` - called after each Pump with no arguments; returns whether
      it sent more work, such as notices a Capability queued.
    * `:output` - called with no arguments inside the Step's transaction,
      just before its `COMMIT`; its value is the output's `:output`, such
      as the Host's outbox.
    * `:on_step` - the hook: `{:ok, output}` after each commit, where
      output is `%{result:, output:, changes:, world_time:}`, or
      `{:error, reason}` after a rollback.
    * `:telemetry` - the event prefix (`[:odgn_ecs_engine]` by default);
      each Step emits `prefix ++ [:step, :stop]`.
    * `:metadata` - a function of a Step's `:output` giving extra telemetry
      metadata.
    * `:fault` - in tests only, `:before_commit` or `:after_commit`: the
      point where a Step kills its process, as a crash would.
  """
  require Logger

  alias OdgnEcsEngine.{Delivery, Step, Tables, Timers}

  # World time 0, as the Instant NorthTalk's Clock reads.
  @epoch ~U[2000-01-01 00:00:00Z]

  defstruct [
    :world,
    :talk,
    # Waiting inputs and NorthTalk's next deadline, which a Step's handle
    # writes while it runs
    :table,
    world_time: 0,
    systems: [],
    timers: %{},
    between: nil,
    output: nil,
    on_step: nil,
    telemetry: [:odgn_ecs_engine],
    metadata: nil,
    fault: nil,
    # The last Step's change set (`OdgnEcs.take_changes/1`)
    changes: []
  ]

  @type t :: %__MODULE__{}

  @doc """
  An engine over a World and its NorthTalk adapter, made in the process
  that will run its Steps. Creates the engine's tables if need be.
  """
  def new(%OdgnEcs{} = world, talk, opts \\ []) do
    Tables.ensure(world)

    %__MODULE__{
      world: world,
      talk: talk,
      table: :ets.new(__MODULE__, [:ordered_set, :private]),
      world_time: Keyword.get_lazy(opts, :world_time, fn -> Tables.world_time(world) end),
      systems: Keyword.get(opts, :systems, []),
      timers: Keyword.get(opts, :timers, %{}),
      between: Keyword.get(opts, :between),
      output: Keyword.get(opts, :output),
      on_step: Keyword.get(opts, :on_step),
      telemetry: Keyword.get(opts, :telemetry, [:odgn_ecs_engine]),
      metadata: Keyword.get(opts, :metadata),
      fault: Keyword.get(opts, :fault)
    }
  end

  @doc "World time, in milliseconds, as the Host last gave it."
  def world_time(%__MODULE__{world_time: ms}), do: ms

  # ---------------------------------------------------------------------
  # Steps
  # ---------------------------------------------------------------------

  @doc """
  Runs `input` as one Step. Option `:at` moves World time to that many
  milliseconds first, without running what is due. Returns
  `{{:ok, output}, engine}` or `{{:error, reason}, engine}`.
  """
  def step(%__MODULE__{} = engine, input, opts \\ []) do
    engine =
      case opts[:at] do
        nil -> engine
        ms -> %{engine | world_time: ms}
      end

    world = engine.world
    started = System.monotonic_time()
    :ok = OdgnEcs.begin(world)
    # Changes made since the last Step, outside one, are not this Step's
    OdgnEcs.take_changes(world)
    Tables.put_world_time(world, engine.world_time)
    step = handle(engine)
    before = waiting(engine)

    case run(step, input) do
      {:ok, result} ->
        Tables.put_world_time(world, engine.world_time)
        output = if engine.output, do: engine.output.()
        fault(engine, :before_commit)
        commit!(world)
        changes = OdgnEcs.take_changes(world)

        :telemetry.execute(
          engine.telemetry ++ [:step, :stop],
          %{duration: System.monotonic_time() - started},
          Map.merge(
            %{changes: length(changes)},
            if(engine.metadata, do: engine.metadata.(output), else: %{})
          )
        )

        fault(engine, :after_commit)

        output = %{
          result: result,
          output: output,
          changes: changes,
          world_time: engine.world_time
        }

        hook(engine, {:ok, output})
        {{:ok, output}, %{engine | changes: changes}}

      {:error, reason} ->
        :ok = OdgnEcs.rollback(world)
        OdgnEcs.take_changes(world)
        restore_waiting(engine, before)
        Logger.error("Step failed and rolled back: #{inspect(reason)}", event: :step_failed)
        hook(engine, {:error, reason})
        {{:error, reason}, engine}
    end
  end

  defp run(step, input) do
    try do
      with {:ok, result} <- run_input(step, input) do
        pump(step)
        settle_waiting(step)
        {:ok, result}
      end
    rescue
      e -> {:error, e}
    catch
      :exit, reason -> {:error, {:exit, reason}}
      :throw, value -> {:error, {:throw, value}}
    end
  end

  defp run_input(step, deliveries) when is_list(deliveries) do
    Enum.reduce_while(deliveries, {:ok, :ok}, fn delivery, acc ->
      case deliver(step, delivery) do
        {:ok, _} -> {:cont, acc}
        :ok -> {:cont, acc}
        {:error, reason} -> {:halt, {:error, {:delivery, delivery, reason}}}
      end
    end)
  end

  defp run_input(step, input) when is_function(input, 1), do: {:ok, input.(step)}

  defp handle(engine) do
    %Step{
      world: engine.world,
      talk: engine.talk,
      now: engine.world_time,
      table: engine.table,
      between: engine.between
    }
  end

  defp hook(%{on_step: nil}, _), do: :ok
  defp hook(%{on_step: on_step}, result), do: on_step.(result)

  defp commit!(world) do
    case OdgnEcs.commit(world) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.error("World commit failed, restarting from the last commit: #{inspect(reason)}",
          event: :commit_failed
        )

        :telemetry.execute([:odgn_ecs_engine, :commit, :error], %{count: 1}, %{reason: reason})
        exit({:commit_failed, reason})
    end
  end

  defp fault(%{fault: point}, point), do: Process.exit(self(), :kill)
  defp fault(_, _), do: :ok

  # ---------------------------------------------------------------------
  # Deliveries
  # ---------------------------------------------------------------------

  @doc """
  Sends a Delivery in the current Step. Returns `{:ok, id}` for a plain
  Delivery, `{:ok, pending}` for a Request or Decision, or `{:error, reason}`.
  A Request is Pumped once as it is sent.
  """
  def deliver(%Step{talk: talk, now: now}, %Delivery{} = d) do
    opts = [host: d.host]

    case {d.asks, d.to} do
      {:deliver, {:service, _}} ->
        raise ArgumentError, "A Service Script can only be asked: #{inspect(d)}"

      {:deliver, eid} ->
        OdgnEcsTalk.deliver(talk, eid, d.message, d.args, opts)

      {:request, {:service, name}} ->
        OdgnEcsTalk.request_service(talk, name, d.message, d.args, instant(now), opts)

      {:request, eid} ->
        OdgnEcsTalk.request(talk, eid, d.message, d.args, instant(now), opts)

      {:decide, {:service, name}} ->
        OdgnEcsTalk.decide_service(talk, name, d.message, d.args, opts)

      {:decide, eid} ->
        OdgnEcsTalk.decide(talk, eid, d.message, d.args, opts)
    end
  end

  @doc """
  Asks a Request or Decision, Pumps until idle, and calls `k.(step,
  outcome)` (`OdgnEcsTalk.outcome/1`) now, returning what `k` returns, or,
  if its Run is still waiting, returns `:waiting` and calls `k` in the Step
  that sees the Run end, with that Step's handle. `waiting` is
  `%{actor: eid | nil, input: text}`, what a restart reports abandoned.
  """
  def ask(%Step{} = step, %Delivery{asks: asks} = d, waiting, k)
      when asks in [:request, :decide] do
    {:ok, pending} = deliver(step, d)
    pump(step)

    case OdgnEcsTalk.outcome(pending) do
      :waiting ->
        :ets.insert(
          step.table,
          {{:waiting, System.unique_integer([:monotonic])},
           %{pending: pending, actor: waiting[:actor], input: waiting.input, then: k, row: nil}}
        )

        :waiting

      outcome ->
        k.(step, outcome)
    end
  end

  @doc """
  Pumps until the Group is idle, calling the `:between` hook after each
  Pump, and notes when NorthTalk next needs pumping.
  """
  def pump(%Step{talk: talk, now: now} = step) do
    between = step.between || fn -> false end
    {:ok, next} = OdgnEcsTalk.pump_until_idle(talk, instant(now), between: between)
    :ets.insert(step.table, {:deadline, next && DateTime.diff(next, @epoch, :millisecond)})
    :ok
  end

  defp waiting(%{table: table}), do: :ets.match_object(table, {{:waiting, :_}, :_})

  # Every input still waiting whose Run has now ended gets its outcome, in
  # this Step; any still waiting keeps or gains its row. Inputs that start
  # waiting in a continuation are seen by the next Step.
  defp settle_waiting(%Step{table: table, world: world} = step) do
    for {key, w} <- :ets.match_object(table, {{:waiting, :_}, :_}) do
      case OdgnEcsTalk.outcome(w.pending) do
        :waiting ->
          if w.row == nil,
            do:
              :ets.insert(
                table,
                {key, %{w | row: Tables.insert_waiting(world, w.actor, w.input)}}
              )

        outcome ->
          if w.row, do: Tables.delete_waiting(world, w.row)
          :ets.delete(table, key)
          w.then.(step, outcome)
      end
    end

    :ok
  end

  # After a rollback the inputs waiting before the Step carry on. Any that
  # started waiting in it are dropped with its work; any it settled had
  # their answer, whose work is gone, so their rows go too.
  defp restore_waiting(%{table: table, world: world}, before) do
    keys = MapSet.new(before, &elem(&1, 0))

    for {key, w} <- waiting(%{table: table}), not MapSet.member?(keys, key) do
      OdgnEcsTalk.abandon(w.pending)
      :ets.delete(table, key)
    end

    # rows written in the Step rolled back with it, so each keeps the row
    # it had before
    for {key, w} = entry <- before do
      cond do
        :ets.lookup(table, key) != [] -> :ets.insert(table, entry)
        w.row -> Tables.delete_waiting(world, w.row)
        true -> :ok
      end
    end

    :ok
  end

  # ---------------------------------------------------------------------
  # World time
  # ---------------------------------------------------------------------

  @doc """
  Moves World time to `world_time` milliseconds and runs what is due, each
  as its own Step, in the order the module doc gives. World time is kept
  even when nothing is due, so a restart resumes close to where it stopped.
  """
  def advance(%__MODULE__{} = engine, world_time) do
    engine = %{engine | world_time: world_time}
    Tables.put_world_time(engine.world, world_time)

    engine =
      engine.world
      |> Timers.due(instant_us(world_time))
      |> Enum.reduce(engine, fn timer, engine ->
        elem(step(engine, &fire(&1, timer, engine.timers)), 1)
      end)

    engine =
      case deadline(engine) do
        at when is_integer(at) and at <= world_time -> elem(step(engine, fn _ -> :ok end), 1)
        _ -> engine
      end

    engine.world
    |> OdgnEcs.System.due(engine.systems, world_time)
    |> Enum.reduce(engine, fn system, engine ->
      elem(step(engine, &OdgnEcs.System.run(&1.world, system, &1.now, &1)), 1)
    end)
  end

  defp fire(step, %{"script" => script} = timer, handlers) do
    case handlers do
      %{^script => handler} -> handler.(step, timer)
      _ -> Timers.fire(step.talk, timer)
    end
  end

  defp deadline(%{table: table}) do
    case :ets.lookup(table, :deadline) do
      [{_, at}] -> at
      [] -> nil
    end
  end

  @doc """
  The earliest World time, in milliseconds, at which `advance/2` has work:
  a timer, NorthTalk's deadline or a System. `nil` when nothing is waiting
  on time.
  """
  def next_deadline(%__MODULE__{} = engine) do
    timer =
      case Timers.next_at(engine.world) do
        nil -> nil
        us -> ceil_ms(us - instant_us(0))
      end

    [timer, deadline(engine), OdgnEcs.System.next_due(engine.world, engine.systems)]
    |> Enum.reject(&is_nil/1)
    |> Enum.min(fn -> nil end)
  end

  defp ceil_ms(us), do: div(us + 999, 1000)

  @doc "World time `ms` as the Instant NorthTalk's Clock reads."
  def instant(ms), do: DateTime.add(@epoch, ms, :millisecond)

  @doc "World time `ms` as microseconds since the Unix epoch, as timers keep it."
  def instant_us(ms), do: DateTime.to_unix(instant(ms), :microsecond)
end
