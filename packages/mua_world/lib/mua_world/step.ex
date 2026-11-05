defmodule MuaWorld.Step do
  @moduledoc """
  One Step of a World (ADRs 0012 and 0015): begin, with World time; the
  input; Pumps until the Group is idle; the inputs whose Runs it settles;
  then one `COMMIT`, and only then the output, to subscribers.

  Output goes to the World's outbox (`MuaWorld.Tables`) during the Step,
  inside its transaction, so output from a Segment that rolls back goes
  with it, and nothing is published before the `COMMIT` that confirms it.

  An input that asks a Script something it hasn't answered once the Pumps
  are idle waits (`await/5`): its continuation runs in the Step that sees
  the Run end, and meanwhile it keeps a `mua_waiting` row, so a restart can
  say it was abandoned (ADR 0014).

  In tests only, the World's `fault` stops the process, as a crash would, at
  `:before_commit` or `:after_commit`, before publishing.

  The components the Step added, changed or removed, its change set
  (`OdgnEcs.take_changes/1`), are kept in the state's `changes` after the
  `COMMIT`. Writes made outside a Step aren't in it.

  It works on the World's state, `%MuaWorld{}`, and returns it.
  """
  require Logger

  alias MuaWorld.{Tables, Talk}
  alias MuaWorld.Commands.Scope

  # World time 0, as the Instant NorthTalk's Clock reads.
  @epoch ~U[2000-01-01 00:00:00Z]

  @doc """
  Runs `input`, a function of the state, as one Step. Returns the lines it
  published, as `{character, text}`, and the state.
  """
  def run(state, input) do
    world = state.world
    started = System.monotonic_time()
    :ok = OdgnEcs.begin(world)
    # Changes made since the last Step, outside one, are not this Step's
    OdgnEcs.take_changes(world)
    Tables.put_world_time(world, state.world_ms)
    state = input.(state)
    state = pump(state)
    state = settle_waiting(state)
    Tables.put_world_time(world, state.world_ms)
    lines = Tables.take_outbox(world)
    fault(state, :before_commit)
    commit!(world)
    state = %{state | changes: OdgnEcs.take_changes(world)}

    :telemetry.execute(
      [:mua_world, :step, :stop],
      %{duration: System.monotonic_time() - started},
      %{lines: length(lines), changes: length(state.changes)}
    )

    fault(state, :after_commit)
    publish(state, lines)
    {lines, state}
  end

  # A failed COMMIT leaves NorthTalk ahead of the database, so the World
  # stops and restarts from what was committed.
  defp commit!(world) do
    case OdgnEcs.commit(world) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.error("World commit failed, restarting from the last commit: #{inspect(reason)}",
          event: :commit_failed
        )

        :telemetry.execute([:mua_world, :commit, :error], %{count: 1}, %{reason: reason})
        exit({:commit_failed, reason})
    end
  end

  defp fault(%{fault: point}, point), do: Process.exit(self(), :kill)
  defp fault(_, _), do: :ok

  defp publish(state, lines) do
    for {character, text} <- lines,
        pid <- Map.get(state.subscribers, character, []),
        do: send(pid, {:mua, character, text})
  end

  @doc """
  Pumps until the Group is idle, sending the notices Scripts asked for
  along the way, and notes when NorthTalk next needs pumping.
  """
  def pump(state) do
    between = fn ->
      notices = Talk.take_notices(state.table)

      for {place, message, who} <- notices,
          do: notify(state, place, message, [{:entity, who}])

      notices != []
    end

    {:ok, next} =
      OdgnEcsTalk.pump_until_idle(state.talk, instant(state.world_ms), between: between)

    %{state | next_deadline: next && DateTime.diff(next, @epoch, :millisecond)}
  end

  @doc """
  Pumps until idle, then calls `k` with the outcome of a Request or Decision
  (`OdgnEcsTalk.outcome/1`) now or, if its Run is still waiting, in the Step
  that sees it end. `character` and `command` are what a restart reports
  abandoned.
  """
  def await(state, pending, character, command, k) do
    state = pump(state)

    case OdgnEcsTalk.outcome(pending) do
      :waiting ->
        put_in(state.waiting[make_ref()], %{
          pending: pending,
          character: character,
          command: command,
          then: k,
          row: nil
        })

      outcome ->
        k.(state, outcome)
    end
  end

  # Every input still waiting whose Run has now ended gets its outcome, in
  # this Step; any still waiting keeps or gains its `mua_waiting` row.
  defp settle_waiting(state) do
    Enum.reduce(state.waiting, state, fn {id, w}, state ->
      case OdgnEcsTalk.outcome(w.pending) do
        :waiting ->
          if w.row,
            do: state,
            else:
              put_in(
                state.waiting[id].row,
                Tables.insert_waiting(state.world, w.character, w.command)
              )

        outcome ->
          if w.row, do: Tables.delete_waiting(state.world, w.row)
          state = %{state | waiting: Map.delete(state.waiting, id)}
          w.then.(state, outcome)
      end
    end)
  end

  @doc """
  Sends a notice to the Scripts of the things in a place, but not the one
  it is about (its first argument), such as the actor who arrived.
  """
  def notify(state, place, message, args) do
    about = with [{:entity, eid} | _] <- args, do: eid
    values = Enum.map(args, &value(state, &1))

    for watcher <- Scope.entities_in(state.world, place),
        watcher != about,
        OdgnEcsTalk.scripted?(state.talk, watcher),
        do: {:ok, _} = OdgnEcsTalk.deliver(state.talk, watcher, message, values)

    :ok
  end

  @doc "An argument for a Script: an entity's Handle, or text as it is."
  def value(state, {:entity, eid}), do: OdgnEcsTalk.handle(state.talk, eid)
  def value(_state, text), do: text

  @doc "World time `ms` as the Instant NorthTalk's Clock reads."
  def instant(ms), do: DateTime.add(@epoch, ms, :millisecond)

  @doc "World time `ms` as microseconds since the Unix epoch, as timers keep it."
  def instant_us(ms), do: DateTime.to_unix(instant(ms), :microsecond)
end
