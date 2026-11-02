defmodule MuaWorld do
  @moduledoc """
  One World: the process that owns its SQLite database and its NorthTalk
  instance, and orders every change to it (ADRs 0011 and 0015).

  The World is an `odgn_ecs` store, built from EDL once and resumed after
  (`OdgnEdl.load/3`), and its Scripts run through `odgn_ecs_talk`.

  Inputs (commands and due timers) enter one at a time. Each is one Step:
  the input, then `pump` until the Group is idle, then one `COMMIT`. Output
  confirming the Step goes to subscribers only after that commit (ADR 0012).

  On start, timers carry on from the saved World time, every Script is loaded
  fresh, and each Character whose command was still waiting at the last stop
  is told it was abandoned (ADR 0014).

      {:ok, world} = MuaWorld.start_link(path: "world.db", edl: "edl/main.edl")
      ada = MuaWorld.named(world, "ada")
      :ok = MuaWorld.subscribe(world, ada)
      {:ok, lines} = MuaWorld.command(world, ada, "look")
  """
  use GenServer

  alias MuaWorld.{Components, Tables, Talk}
  alias NorthTalk.{Pending, Result, ScriptError, Verdict}

  # World time 0, as the Instant NorthTalk's Clock reads.
  @epoch ~U[2000-01-01 00:00:00Z]

  defstruct [
    :world,
    :talk,
    :fault,
    :tick,
    # World time at the last reading, and the monotonic time it was read.
    :world_ms,
    :read_at,
    # When NorthTalk next needs pumping, in World time, if ever.
    :next_deadline,
    subscribers: %{},
    # Inputs whose Runs are still waiting, by Pending id: what to do with
    # the result, and their `mua_waiting` row.
    waiting: %{}
  ]

  @doc """
  Starts a World. Options: `path` (required), `edl`, the path of the EDL to
  build an empty World from (required), `tick` in milliseconds (100 by
  default, or `:manual`), `limits` for every Script, and, in tests only,
  `fault`, a point where the World stops itself: `:before_commit` or
  `:after_commit`, before publishing.
  """
  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  def start(opts), do: GenServer.start(__MODULE__, opts, Keyword.take(opts, [:name]))

  @doc "Runs one command for a Character as one Step. Returns the Character's output once committed."
  def command(world, character, text),
    do: GenServer.call(world, {:command, character, text}, 30_000)

  @doc """
  Sends the calling process `{:mua, character, text}` for each line of the
  Character's output, from now on. Notices left from before a restart come
  first.
  """
  def subscribe(world, character), do: GenServer.call(world, {:subscribe, character, self()})

  @doc "Advances World time and runs what is due, as a tick does."
  def tick(world), do: GenServer.call(world, :tick, 30_000)

  @doc "World time, in milliseconds."
  def world_time(world), do: GenServer.call(world, :world_time)

  @doc "Moves World time on by `ms`, for tests that don't want to wait."
  def advance(world, ms), do: GenServer.call(world, {:advance, ms})

  @doc "Reads a component, through the World process."
  def component(world, eid, name), do: GenServer.call(world, {:component, eid, name})

  @doc "The entity with this Definition name, through the World process."
  def named(world, name), do: GenServer.call(world, {:named, name})

  # ---------------------------------------------------------------------
  # Start
  # ---------------------------------------------------------------------

  @impl true
  def init(opts) do
    edl_path = Keyword.fetch!(opts, :edl)
    {:ok, world} = OdgnEcs.open(Keyword.fetch!(opts, :path))
    world = Enum.reduce(Components.all(), world, fn c, w -> ok!(OdgnEcs.define(w, c)) end)
    Tables.ensure(world)
    {:ok, world, _built_or_resumed} = OdgnEdl.load(world, File.read!(edl_path), path: edl_path)

    state = %__MODULE__{
      world: world,
      fault: opts[:fault],
      tick: Keyword.get(opts, :tick, 100),
      world_ms: Tables.world_time(world),
      read_at: now_ms()
    }

    :ok = OdgnEcs.begin(world)
    Tables.abandon_waiting(world)
    :ok = OdgnEcs.commit(world)

    state = start_talk(state, Keyword.get(opts, :limits, []))
    if is_integer(state.tick), do: Process.send_after(self(), :tick, state.tick)
    {:ok, state}
  end

  defp ok!({:ok, value}), do: value

  defp start_talk(state, limits) do
    world = state.world
    {:ok, owner} = NorthTalk.start_link(drive: :manual)
    :ok = NorthTalk.define_capability!(owner, Talk.mua(world))

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        owner: owner,
        grants: %{"mua" => NorthTalk.grant!(owner, "mua")},
        limits: limits,
        on_show: &Tables.output(world, &1, &2)
      )

    :ok = OdgnEcsTalk.load_scripts(talk, &File.read!/1)
    %{state | talk: talk}
  end

  # ---------------------------------------------------------------------
  # Calls
  # ---------------------------------------------------------------------

  @impl true
  def handle_call({:command, character, text}, _from, state) do
    state = advance_clock(state)
    {lines, state} = step(state, fn state -> dispatch(state, character, String.trim(text)) end)
    {:reply, {:ok, for({^character, t} <- lines, do: t)}, state}
  end

  def handle_call({:subscribe, character, pid}, _from, state) do
    :ok = OdgnEcs.begin(state.world)
    notices = Tables.take_notices(state.world, character)
    :ok = OdgnEcs.commit(state.world)
    for t <- notices, do: send(pid, {:mua, character, t})
    {:reply, :ok, update_in(state.subscribers[character], &[pid | &1 || []])}
  end

  def handle_call(:tick, _from, state), do: {:reply, :ok, run_due(advance_clock(state))}

  def handle_call(:world_time, _from, state) do
    state = advance_clock(state)
    {:reply, state.world_ms, state}
  end

  def handle_call({:advance, ms}, _from, state),
    do: {:reply, :ok, %{state | world_ms: state.world_ms + ms}}

  def handle_call({:component, eid, name}, _from, state),
    do: {:reply, OdgnEcs.get(state.world, eid, name), state}

  def handle_call({:named, name}, _from, state),
    do: {:reply, OdgnEdl.entity_named(state.world, name), state}

  @impl true
  def handle_info(:tick, state) do
    state = run_due(advance_clock(state))
    Process.send_after(self(), :tick, state.tick)
    {:noreply, state}
  end

  def handle_info(_, state), do: {:noreply, state}

  defp advance_clock(state) do
    now = now_ms()
    %{state | world_ms: state.world_ms + (now - state.read_at), read_at: now}
  end

  defp now_ms, do: System.monotonic_time(:millisecond)

  # Due timers each run as a Step, and so does a NorthTalk deadline, such as
  # the end of a Script's `wait`.
  defp run_due(state) do
    # World time is kept on every tick, so a restart resumes close to where
    # it stopped even when nothing happened in between.
    Tables.put_world_time(state.world, state.world_ms)

    state =
      state.talk
      |> OdgnEcsTalk.due_timers(instant_us(state.world_ms))
      |> Enum.reduce(state, fn timer, state ->
        {_, state} =
          step(state, fn state ->
            OdgnEcsTalk.fire_timer(state.talk, timer)
            state
          end)

        state
      end)

    if state.next_deadline != nil and state.next_deadline <= state.world_ms,
      do: elem(step(state, & &1), 1),
      else: state
  end

  # ---------------------------------------------------------------------
  # Steps
  # ---------------------------------------------------------------------

  # One Step: the input, pumps until idle, the results it settles, then one
  # COMMIT, and only then the output.
  defp step(state, input) do
    world = state.world
    :ok = OdgnEcs.begin(world)
    Tables.put_world_time(world, state.world_ms)
    state = input.(state)
    state = pump_idle(state)
    state = settle_waiting(state)
    Tables.put_world_time(world, state.world_ms)
    lines = Tables.take_outbox(world)
    fault(state, :before_commit)

    # A failed COMMIT leaves NorthTalk ahead of the database, so the World
    # stops and restarts from what was committed.
    case OdgnEcs.commit(world) do
      :ok -> :ok
      {:error, reason} -> exit({:commit_failed, reason})
    end

    fault(state, :after_commit)
    publish(state, lines)
    {lines, state}
  end

  defp fault(%{fault: point}, point), do: Process.exit(self(), :kill)
  defp fault(_, _), do: :ok

  defp pump_idle(state) do
    {:ok, pump} = OdgnEcsTalk.pump(state.talk, instant(state.world_ms))
    state = %{state | next_deadline: deadline(pump.next_deadline)}
    if pump.state == "sliced", do: pump_idle(state), else: state
  end

  defp instant(ms), do: DateTime.add(@epoch, ms, :millisecond)
  defp instant_us(ms), do: DateTime.to_unix(instant(ms), :microsecond)

  defp deadline(nil), do: nil

  defp deadline(text) do
    {:ok, dt, _} = DateTime.from_iso8601(text)
    DateTime.diff(dt, @epoch, :millisecond)
  end

  # Every input still waiting whose Run has now ended gets its result, in
  # this Step; any still waiting keeps or gains its `mua_waiting` row.
  defp settle_waiting(state) do
    Enum.reduce(state.waiting, state, fn {id, w}, state ->
      case NorthTalk.await(w.pending, 0) do
        {:error, %NorthTalk.HostError{code: "timeout"}} ->
          if w.row,
            do: state,
            else:
              put_in(
                state.waiting[id].row,
                Tables.insert_waiting(state.world, w.character, w.command)
              )

        result ->
          NorthTalk.release_pending(w.pending)
          if w.row, do: Tables.delete_waiting(state.world, w.row)
          state = %{state | waiting: Map.delete(state.waiting, id)}
          w.then.(state, result)
      end
    end)
  end

  defp publish(state, lines) do
    for {character, text} <- lines,
        pid <- Map.get(state.subscribers, character, []),
        do: send(pid, {:mua, character, text})
  end

  # ---------------------------------------------------------------------
  # Commands
  #
  # A stand-in until command parsing, binding and dispatch arrive (#113):
  # `say`, `take`, and any other verb offered to the room.
  # ---------------------------------------------------------------------

  defp dispatch(state, character, text) do
    room = location(state, character)
    [verb | rest] = String.split(text, " ", parts: 2) ++ [""]
    rest = String.trim(hd(rest))

    cond do
      room == nil -> tell(state, character, "You are nowhere.")
      verb == "say" -> say(state, character, room, rest)
      verb == "take" -> take(state, character, room, rest, text)
      true -> offer(state, character, room, verb, rest, text)
    end
  end

  defp location(state, eid) do
    case OdgnEcs.get(state.world, eid, "location") do
      %{"in" => place} -> place
      _ -> nil
    end
  end

  defp name(state, eid) do
    case OdgnEcs.get(state.world, eid, "player") || OdgnEcs.get(state.world, eid, "described") do
      %{"name" => name} -> name
      _ -> nil
    end
  end

  defp tell(state, character, text) do
    Tables.output(state.world, character, text)
    state
  end

  defp handle(state, eid), do: OdgnEcsTalk.handle(state.talk, eid)

  # A command offered to the room: its Message Path may answer. `look`
  # falls back to the built-in description.
  defp offer(state, me, room, verb, rest, text) do
    args = if verb == "look", do: [handle(state, me)], else: [handle(state, me), rest]
    {:ok, pending} = OdgnEcsTalk.request(state.talk, room, verb, args, instant(state.world_ms))

    wait(state, pending, me, text, fn state, result ->
      case result do
        {:ok, %Result{value: reply}} when is_binary(reply) and reply != "" ->
          tell(state, me, reply)

        {:ok, %Result{}} ->
          state

        {:error, %ScriptError{outcome: "unhandled"}} when verb == "look" ->
          describe(state, me, room)

        {:error, %ScriptError{outcome: "unhandled"}} ->
          tell(state, me, "You can't do that here.")

        {:error, _} ->
          tell(state, me, "Something went wrong.")
      end
    end)
  end

  defp describe(state, character, room) do
    described = OdgnEcs.get(state.world, room, "described") || %{}

    others =
      for id <- OdgnEcsTalk.element_ids(state.talk, room),
          id != character,
          n = name(state, id),
          do: n

    lines = [described["name"], described["description"]] ++ Enum.map(others, &"You see #{&1}.")
    Enum.reduce(Enum.reject(lines, &is_nil/1), state, &tell(&2, character, &1))
  end

  defp say(state, me, room, words) do
    for c <- Tables.characters_at(state.world, room),
        do:
          tell(
            state,
            c,
            if(c == me,
              do: "You say, \"#{words}\"",
              else: "#{name(state, me)} says, \"#{words}\""
            )
          )

    {:ok, _} = OdgnEcsTalk.deliver(state.talk, room, "heard", [handle(state, me), words])
    state
  end

  # Taking asks the thing first, as a Decision along its Message Path.
  defp take(state, me, room, name, text) do
    case Enum.find(
           OdgnEcsTalk.element_ids(state.talk, room),
           &(OdgnEcsTalk.element_name(state.talk, &1) == name)
         ) do
      nil ->
        tell(state, me, "You don't see #{name} here.")

      thing ->
        {:ok, pending} =
          OdgnEcsTalk.decide(state.talk, thing, "taking", [
            handle(state, me),
            handle(state, thing)
          ])

        wait(state, pending, me, text, fn state, result ->
          case result do
            {:ok, %Verdict{verdict: :allowed}} ->
              :ok = OdgnEcs.put(state.world, thing, "location", %{"in" => me})
              tell(state, me, "You take #{name}.")

            {:ok, %Verdict{verdict: :vetoed, vetoes: [veto | _]}} ->
              tell(state, me, veto.reason || "You can't take #{name}.")

            _ ->
              tell(state, me, "You can't take #{name}.")
          end
        end)
    end
  end

  defp wait(state, %Pending{id: id} = pending, character, command, then),
    do:
      put_in(state.waiting[id], %{
        pending: pending,
        character: character,
        command: command,
        then: then,
        row: nil
      })
end
