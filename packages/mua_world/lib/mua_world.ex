defmodule MuaWorld do
  @moduledoc """
  One World: the process that owns its SQLite connection and its NorthTalk
  instance, and orders every change to it (ADRs 0011 and 0015).

  Inputs (commands and due timers) enter one at a time. Each is one Step:
  the input, then `pump` until the Group is idle, then one `COMMIT`. Output
  confirming the Step goes to subscribers only after that commit (ADR 0012).

  On start, timers carry on from the saved World time, every Script is loaded
  fresh, and each Character whose command was still waiting at the last stop
  is told it was abandoned (ADR 0014).

      {:ok, world} = MuaWorld.start_link(path: "world.db", fixture: fixture)
      :ok = MuaWorld.subscribe(world, character_id)
      {:ok, lines} = MuaWorld.command(world, character_id, "look")
  """
  use GenServer

  alias MuaWorld.{Store, Talk}
  alias NorthTalk.{Pending, Pumped, Result, ScriptError, Verdict}

  # World time 0, as the Instant NorthTalk's Clock reads.
  @epoch ~U[2000-01-01 00:00:00Z]

  defstruct [
    :conn,
    :owner,
    :group,
    :fault,
    :tick,
    # World time at the last reading, and the monotonic time it was read.
    :world_ms,
    :read_at,
    # When NorthTalk next needs pumping, in World time, if ever.
    :next_deadline,
    subscribers: %{},
    # Inputs whose Runs are still waiting, by Pending id: what to do with
    # the result, and their `waiting` row.
    waiting: %{}
  ]

  @doc """
  Starts a World. Options: `path` (required), `fixture` to seed an empty
  World (see `MuaWorld.Store.seed/2`), `tick` in milliseconds (100 by
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

  @doc "Reads an entity, through the World process."
  def entity(world, eid), do: GenServer.call(world, {:entity, eid})

  # ---------------------------------------------------------------------
  # Start
  # ---------------------------------------------------------------------

  @impl true
  def init(opts) do
    {:ok, conn} = Store.open(Keyword.fetch!(opts, :path))
    if Store.empty?(conn) and opts[:fixture], do: Store.seed(conn, opts[:fixture])

    state = %__MODULE__{
      conn: conn,
      fault: opts[:fault],
      tick: Keyword.get(opts, :tick, 100),
      world_ms: Store.world_time(conn),
      read_at: now_ms()
    }

    abandon_waiting(conn)
    state = start_talk(state, Keyword.get(opts, :limits, []))
    if is_integer(state.tick), do: Process.send_after(self(), :tick, state.tick)
    {:ok, state}
  end

  # Commands still waiting at the last stop are abandoned: their Characters
  # are told, once they subscribe. Undelivered output was never confirmed.
  defp abandon_waiting(conn) do
    Store.exec!(conn, "BEGIN IMMEDIATE")

    for [character, command] <-
          Store.all(conn, "SELECT character, command FROM waiting ORDER BY id") do
      Store.run!(conn, "INSERT INTO notices (character, text) VALUES (?, ?)", [
        character,
        "The world was restarted, and \"#{command}\" was abandoned."
      ])
    end

    Store.exec!(conn, "DELETE FROM waiting; DELETE FROM outbox")
    Store.exec!(conn, "COMMIT")
  end

  defp start_talk(state, limits) do
    conn = state.conn
    {:ok, owner} = NorthTalk.start_link(drive: :manual)
    group = NorthTalk.new_group!(owner, Talk.group_name(), [])
    world_time = world_clock(state)

    :ok = NorthTalk.define_object_kind!(owner, Talk.atom_kind())
    :ok = NorthTalk.define_object_kind!(owner, Talk.entity_kind())
    :ok = NorthTalk.define_capability!(owner, Talk.world(conn, world_time))
    :ok = NorthTalk.define_capability!(owner, Talk.clock(world_time))

    grants = %{
      "world" => NorthTalk.grant!(owner, "world", []),
      "clock" => NorthTalk.grant!(owner, "clock", [])
    }

    # Single inheritance: each atom's Object sits under its parent's.
    atoms = Store.atoms(conn)
    by_name = Map.new(atoms, &{&1.name, &1})

    for atom <- parents_first(atoms, by_name) do
      parent = atom.parent && Talk.atom_object(atom.parent)
      obj = NorthTalk.object!(group, Talk.atom_kind(), atom.name, atom.name, parent: parent)
      if atom.script, do: load!(group, "atom:" <> atom.name, atom.script, obj, grants, limits)
    end

    # Every entity has its Handle from the start, so a callback can give one
    # without asking the owner.
    for e <- Store.entities(conn) do
      parent = e.atom && Talk.atom_object(e.atom)

      handle =
        NorthTalk.object!(group, Talk.entity_kind(), Integer.to_string(e.id), {conn, e.id},
          parent: parent
        )

      if e.script, do: load!(group, "entity:#{e.id}", e.script, handle, grants, limits)
    end

    %{state | owner: owner, group: group}
  end

  defp load!(group, name, source, owner, grants, limits),
    do: NorthTalk.load!(group, name, source, owner: owner, grants: grants, limits: limits)

  defp parents_first(atoms, by_name) do
    depth = fn depth, a -> if a.parent, do: 1 + depth.(depth, by_name[a.parent]), else: 0 end
    Enum.sort_by(atoms, &depth.(depth, &1))
  end

  # Callbacks read World time from the table, where each Step keeps it.
  defp world_clock(state) do
    conn = state.conn
    fn -> Store.world_time(conn) end
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
    conn = state.conn
    Store.exec!(conn, "BEGIN IMMEDIATE")

    notices =
      for [t] <-
            Store.all(conn, "SELECT text FROM notices WHERE character = ? ORDER BY id", [
              character
            ]),
          do: t

    Store.run!(conn, "DELETE FROM notices WHERE character = ?", [character])
    Store.exec!(conn, "COMMIT")
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
    do: {:reply, Store.component(state.conn, eid, name), state}

  def handle_call({:entity, eid}, _from, state),
    do: {:reply, Store.entity(state.conn, eid), state}

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
    Store.put_world_time(state.conn, state.world_ms)

    due =
      Store.all(
        state.conn,
        "SELECT id, entity, message FROM timers WHERE due <= ? ORDER BY due, id",
        [state.world_ms]
      )

    state =
      Enum.reduce(due, state, fn [id, eid, message], state ->
        {_, state} =
          step(state, fn state ->
            Store.run!(state.conn, "DELETE FROM timers WHERE id = ?", [id])
            {:ok, _} = NorthTalk.deliver(state.group, Talk.handle(eid), message, [])
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
    conn = state.conn
    Store.exec!(conn, "BEGIN IMMEDIATE")
    # Callbacks read World time from the table, so it is current for the Step.
    Store.put_world_time(conn, state.world_ms)
    state = input.(state)
    state = pump_idle(state)
    state = settle_waiting(state)
    Store.put_world_time(conn, state.world_ms)
    lines = Store.take_outbox(conn)
    fault(state, :before_commit)

    # A failed COMMIT leaves NorthTalk ahead of the database, so the World
    # stops and restarts from what was committed.
    case Exqlite.Sqlite3.execute(conn, "COMMIT") do
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
    {:ok, pump} = NorthTalk.pump(state.group, now: instant(state.world_ms))
    state = %{state | next_deadline: deadline(pump.next_deadline)}
    if pump.state == "sliced", do: pump_idle(state), else: state
  end

  defp instant(ms), do: DateTime.add(@epoch, ms, :millisecond)

  defp deadline(nil), do: nil

  defp deadline(text) do
    {:ok, dt, _} = DateTime.from_iso8601(text)
    DateTime.diff(dt, @epoch, :millisecond)
  end

  # Every input still waiting whose Run has now ended gets its result, in
  # this Step; any still waiting keeps or gains its `waiting` row.
  defp settle_waiting(state) do
    Enum.reduce(state.waiting, state, fn {id, w}, state ->
      case NorthTalk.await(w.pending, 0) do
        {:error, %NorthTalk.HostError{code: "timeout"}} ->
          if w.row,
            do: state,
            else:
              put_in(state.waiting[id].row, insert_waiting(state.conn, w.character, w.command))

        result ->
          NorthTalk.release_pending(w.pending)
          if w.row, do: Store.run!(state.conn, "DELETE FROM waiting WHERE id = ?", [w.row])
          state = %{state | waiting: Map.delete(state.waiting, id)}
          w.then.(state, result)
      end
    end)
  end

  defp insert_waiting(conn, character, command) do
    Store.run!(conn, "INSERT INTO waiting (character, command) VALUES (?, ?)", [
      character,
      command
    ])

    Store.last_id(conn)
  end

  defp publish(state, lines) do
    for {character, text} <- lines,
        pid <- Map.get(state.subscribers, character, []),
        do: send(pid, {:mua, character, text})
  end

  # ---------------------------------------------------------------------
  # Commands
  # ---------------------------------------------------------------------

  defp dispatch(state, character, text) do
    me = Store.entity(state.conn, character)
    room = me && me.location
    [verb | rest] = String.split(text, " ", parts: 2) ++ [""]
    rest = String.trim(hd(rest))

    cond do
      room == nil -> tell(state, character, "You are nowhere.")
      verb == "say" -> say(state, me, room, rest)
      verb == "take" -> take(state, me, room, rest, text)
      true -> offer(state, me, room, verb, rest, text)
    end
  end

  defp tell(state, character, text) do
    Store.output(state.conn, character, text)
    state
  end

  # A command offered to the room: its Message Path may answer. `look`
  # falls back to the built-in description.
  defp offer(state, me, room, verb, rest, text) do
    args = if verb == "look", do: [Talk.handle(me.id)], else: [Talk.handle(me.id), rest]

    {:ok, %Pumped{pending: pending}} =
      NorthTalk.request_pump(state.group, Talk.handle(room), verb, args,
        now: instant(state.world_ms)
      )

    wait(state, pending, me.id, text, fn state, result ->
      case result do
        {:ok, %Result{value: reply}} when is_binary(reply) and reply != "" ->
          tell(state, me.id, reply)

        {:ok, %Result{}} ->
          state

        {:error, %ScriptError{outcome: "unhandled"}} when verb == "look" ->
          describe(state, me.id, room)

        {:error, %ScriptError{outcome: "unhandled"}} ->
          tell(state, me.id, "You can't do that here.")

        {:error, _} ->
          tell(state, me.id, "Something went wrong.")
      end
    end)
  end

  defp describe(state, character, room) do
    conn = state.conn
    place = Store.entity(conn, room)

    others =
      for id <- Store.elements(conn, room), id != character, do: Store.entity(conn, id).name

    lines =
      [place.name, Store.component(conn, room, "description")] ++
        Enum.map(others, &"You see #{&1}.")

    Enum.reduce(Enum.reject(lines, &is_nil/1), state, &tell(&2, character, &1))
  end

  defp say(state, me, room, words) do
    for c <- Store.characters_at(state.conn, room),
        do:
          Store.output(
            state.conn,
            c,
            if(c == me.id, do: "You say, \"#{words}\"", else: "#{me.name} says, \"#{words}\"")
          )

    {:ok, _} =
      NorthTalk.deliver(state.group, Talk.handle(room), "heard", [Talk.handle(me.id), words])

    state
  end

  # Taking asks the thing first, as a Decision along its Message Path.
  defp take(state, me, room, name, text) do
    case Store.named_element(state.conn, room, name) do
      nil ->
        tell(state, me.id, "You don't see #{name} here.")

      thing ->
        {:ok, pending} =
          NorthTalk.decide(state.group, Talk.handle(thing), "taking", [
            Talk.handle(me.id),
            Talk.handle(thing)
          ])

        wait(state, pending, me.id, text, fn state, result ->
          case result do
            {:ok, %Verdict{verdict: :allowed}} ->
              Store.move(state.conn, thing, me.id)
              tell(state, me.id, "You take #{name}.")

            {:ok, %Verdict{verdict: :vetoed, vetoes: [veto | _]}} ->
              tell(state, me.id, veto.reason || "You can't take #{name}.")

            _ ->
              tell(state, me.id, "You can't take #{name}.")
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
