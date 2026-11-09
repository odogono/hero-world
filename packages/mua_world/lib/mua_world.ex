defmodule MuaWorld do
  @moduledoc """
  One World: the process that owns its SQLite database and its NorthTalk
  instance, and orders every change to it (ADRs 0011 and 0015).

  The World is an `odgn_ecs` store, built from EDL once and resumed after
  (`OdgnEdl.load/3`), and its Scripts run through `odgn_ecs_talk`. The
  World process is the Host of an `OdgnEcsEngine`, which runs its Steps,
  timers and Systems (ADR 0021); mua adds its commands, outbox, notices,
  identities and NPC queue.

  Inputs (commands and due timers) enter one at a time. Each is one Step:
  the input, then Pumps until the Group is idle, then one `COMMIT`. Output
  goes to the outbox (`MuaWorld.Tables`) inside the Step's transaction, so
  output from a Segment that rolls back goes with it, and reaches
  subscribers only after the commit that confirms it (ADR 0012).

  On start, timers carry on from the saved World time, every Script is loaded
  fresh, and each Character whose command was still waiting at the last stop
  is told it was abandoned (ADR 0014). Then every scripted thing hears
  `start`, in one Step.

  World time advances while the World runs, whether or not anyone is
  playing, and pauses while it is down. NPCs act through commands (ADR 0003):
  a command a Script asks for with `mua act` runs as a Step of its own once
  the current one commits; any it asks for while those run waits for the
  next tick.

  Accounts and Characters are Entities in the World (ADR 0016). An Account
  owns its Characters through `player.account`, and every call that acts
  for a Character names its Account, which must own it. A new Character
  waits in Limbo until it enters.

      {:ok, world} = MuaWorld.start_link(path: "world.db", edl: "main.edl", starting_room: "west_of_house")
      {:ok, account} = MuaWorld.create_account(world)
      {:ok, ada} = MuaWorld.create_character(world, account, "Ada")
      :ok = MuaWorld.subscribe(world, ada)
      {:ok, _welcome} = MuaWorld.enter(world, account, ada)
      {:ok, lines} = MuaWorld.command(world, account, ada, "look")
  """
  use GenServer

  require Logger

  alias MuaWorld.{
    Components,
    Dispatch,
    Exits,
    Input,
    Lifecycle,
    Lock,
    Places,
    Tables,
    Talk
  }

  alias MuaWorld.Commands.Verbs
  alias OdgnEcsEngine.Delivery

  import OdgnEcsEngine, only: [instant_us: 1]

  defstruct [
    :world,
    # the database's path, whose lock file the World holds
    :path,
    :talk,
    # Notices, shared with `mua`'s callbacks, and each Character's
    # subscribers, which the engine's hook publishes to.
    :table,
    # The verbs the World understands.
    :vocabulary,
    # Limbo, the system actor and the Starting room (`MuaWorld.Places`).
    :places,
    # The engine (`OdgnEcsEngine`), whose `changes` are the last Step's
    # change set, for the client mirror.
    :engine,
    # The current Step's handle (`OdgnEcsEngine.Step`), while one runs.
    :step,
    :tick,
    # World time at the last reading, and the monotonic time it was read.
    # The World keeps the clock, and gives the engine World time.
    :world_ms,
    :read_at
  ]

  @doc """
  Starts a World. Options: `path` (required), `edl`, the path of the EDL to
  build an empty World from (required), `starting_room`, the Definition name
  of the room Characters enter when they have nowhere to return to
  (required), `tick` in milliseconds (100 by default, or `:manual`, when
  World time moves only by `advance/2`, never with the wall clock, so a
  slow machine can't make a timer fire early),
  `limits` for every Script, and, in tests only, `fault`, a point where the
  World stops itself: `:before_commit` or `:after_commit`, before
  publishing.

  A World whose Starting room isn't a top-level place of the World refuses
  to start, with `{:error, {:invalid_starting_room, reason}}`.
  """
  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  def start(opts), do: GenServer.start(__MODULE__, opts, Keyword.take(opts, [:name]))

  @doc """
  Runs one command for a Character as one Step. Returns the Character's
  output once committed, `{:error, :not_owner}` if the Account doesn't own
  the Character, or `{:error, :not_in_play}` if it is in Limbo.
  """
  def command(world, account, character, text),
    do: GenServer.call(world, {:command, account, character, text}, 30_000)

  @doc """
  The Account a sign-in identity maps to, made with its mapping in one Step
  the first time the identity signs in (ADR 0016). `sub` is the identity's
  stable id, such as Google's; `email` is kept, and updated, for operators.
  Admission is the caller's job: this maps whoever it is given.
  """
  def sign_in(world, sub, email, opts \\ []) when is_binary(sub) and sub != "",
    do: GenServer.call(world, {:sign_in, sub, email, Keyword.get(opts, :admin, false)}, 30_000)

  @doc """
  Runs a line of NorthTalk typed by an admin, as one Step (#91). The line
  runs as the Handler `on line actor, here`, with the Character and its
  room; `ask world to named "lamp"` finds anything by Definition name. It
  changes the World with the same Operations Scripts use, and a line that
  fails, or doesn't finish within the Step, leaves no change. The admin is
  told `=> value`, or `!! ` and what went wrong. An Account that isn't an
  admin is told "You can't do that." A command that starts with `;` comes
  here too.
  """
  def admin_line(world, account, character, text),
    do: GenServer.call(world, {:admin_line, account, character, text}, 30_000)

  @doc """
  What a Character can see: its room, what it carries and the commands it
  could type next (`MuaWorld.View`). `{:error, :not_owner}` if the Account
  doesn't own it, `{:error, :not_in_play}` if it is in Limbo.
  """
  def view(world, account, character),
    do: GenServer.call(world, {:view, account, character})

  @doc """
  A fresh mirror of what a Character perceives (`MuaWorld.Mirror.snapshot/2`),
  for a client that has just connected. From then on, each subscriber of the
  Character is sent `{:mua_changes, character, change_set}` after every Step
  that changed what it perceives (`MuaWorld.Mirror.change_set/5`). Refused as
  `view/3` is.
  """
  def mirror(world, account, character),
    do: GenServer.call(world, {:mirror, account, character})

  @doc """
  The Characters in play (not in Limbo), as `{account, character}`. After a
  restart no Connection controls them, so the caller gives each its grace
  before it leaves (#97).
  """
  def in_play(world), do: GenServer.call(world, :in_play)

  @doc "The Characters an Account owns, as `%{id: eid, name: name, in_play: boolean}`."
  def characters(world, account), do: GenServer.call(world, {:characters, account})

  @doc "Makes an Account, as one Step, and returns its id."
  def create_account(world), do: GenServer.call(world, :create_account, 30_000)

  @doc """
  Makes a Character for an Account, with a public name, as one Step. It waits
  in Limbo until it enters. Names are unique among Characters, ignoring case:
  `{:error, :name_taken}`, `{:error, :invalid_name}` or
  `{:error, :not_an_account}` when it can't be made.
  """
  def create_character(world, account, name),
    do: GenServer.call(world, {:create_character, account, name}, 30_000)

  @doc """
  Brings a Character into play from Limbo, as one Step: to the room it left,
  if that is still a place, otherwise to the Starting room. Returns what the
  Character is told: a welcome, or nothing for a Character already in play,
  which stays where it is.
  """
  def enter(world, account, character),
    do: GenServer.call(world, {:enter, account, character}, 30_000)

  @doc """
  Takes a Character out of play, into Limbo, as one Step, remembering the
  room it left. A Character already in Limbo stays there.
  """
  def leave(world, account, character),
    do: GenServer.call(world, {:leave, account, character}, 30_000)

  @doc """
  Sends the calling process `{:mua, character, text}` for each line of the
  Character's output, from now on. Notices left from before a restart come
  first.
  """
  def subscribe(world, character), do: GenServer.call(world, {:subscribe, character, self()})

  @doc "Stops sending the calling process a Character's output."
  def unsubscribe(world, character),
    do: GenServer.call(world, {:unsubscribe, character, self()})

  @doc """
  Writes a consistent snapshot of the World's database to `dest`, which must
  not exist yet, while play carries on: the World makes it between Steps, so
  it holds every committed Step and nothing more (`MuaWorld.Backup`).
  """
  def backup(world, dest), do: GenServer.call(world, {:backup, dest}, 120_000)

  @doc "Advances World time and runs what is due, as a tick does."
  def tick(world), do: GenServer.call(world, :tick, 30_000)

  @doc "World time, in milliseconds."
  def world_time(world), do: GenServer.call(world, :world_time)

  @doc "Moves World time on by `ms`, for tests that don't want to wait."
  def advance(world, ms), do: GenServer.call(world, {:advance, ms})

  @doc "Reads a component, through the World process."
  def component(world, eid, name), do: GenServer.call(world, {:component, eid, name})

  @doc "Every timer kept in the World (`OdgnEcsEngine.Timers`). For tests and operators."
  def timers(world), do: GenServer.call(world, :timers)

  @doc "Writes a component, through the World process, as one Step. For tests and operators."
  def set_component(world, eid, name, data),
    do: GenServer.call(world, {:set_component, eid, name, data}, 30_000)

  @doc "The entity with this Definition name, through the World process."
  def named(world, name), do: GenServer.call(world, {:named, name})

  @doc "Every word that starts a command in this World, for clients to complete."
  def verbs(world), do: GenServer.call(world, :verbs)

  @doc """
  Resets a place, as its `reset` timer does, as one Step: puts back what has
  strayed from it, unless a Character carries it, and tells its Scripts.
  Returns how many things moved.
  """
  def reset(world, place), do: GenServer.call(world, {:reset, place}, 30_000)

  @doc "Limbo, the system actor and the Starting room, by their ids."
  def places(world), do: GenServer.call(world, :places)

  # ---------------------------------------------------------------------
  # Start
  # ---------------------------------------------------------------------

  @impl true
  def init(opts) do
    edl_path = Keyword.fetch!(opts, :edl)
    path = Keyword.fetch!(opts, :path)

    # Trapping exits lets `terminate/2` release the lock when a supervisor
    # stops the World, as on a SIGTERM
    Process.flag(:trap_exit, true)

    # The World holds the lock file while it runs, so nothing else, such as
    # `mix mua.migrate`, writes the database meanwhile; readers may still
    # open it
    case Lock.acquire(path) do
      :ok -> init_world(opts, path, edl_path)
      {:error, :locked} -> {:stop, :locked}
    end
  end

  defp init_world(opts, path, edl_path) do
    {:ok, world} = OdgnEcs.open(path)
    world = Enum.reduce(Components.all(), world, fn c, w -> ok!(OdgnEcs.define(w, c)) end)
    Tables.ensure(world)

    # A World built from another EDL won't start until it is migrated: say so
    # plainly rather than crash
    case OdgnEdl.load(world, File.read!(edl_path),
           path: edl_path,
           roots: MuaWorld.Scripts.roots()
         ) do
      {:ok, world, how} ->
        init_loaded(opts, world, path, how)

      {:error, %OdgnEdl.Error{kind: kind, message: message}} ->
        Logger.error("World at #{path} can't start: #{message}", event: :world_not_started)
        OdgnEcs.close(world)
        Lock.release(path)
        {:stop, {kind, message}}
    end
  end

  defp init_loaded(opts, world, path, how) do
    state = %__MODULE__{
      world: world,
      path: path,
      tick: Keyword.get(opts, :tick, 100),
      world_ms: OdgnEcsEngine.Tables.world_time(world),
      read_at: now_ms()
    }

    :ok = OdgnEcs.begin(world)
    Exits.expand(world)
    abandoned = Tables.abandon_waiting(world)

    case Places.ensure(world, opts[:starting_room]) do
      {:ok, places} ->
        Lifecycle.record_homes(world)
        :ok = OdgnEcs.commit(world)
        state = %{state | vocabulary: Verbs.from_world(world), places: places}

        case start_talk(state, Keyword.get(opts, :limits, [])) do
          {:ok, state} ->
            state = start_world(start_engine(state))
            # a test's `fault` is for the Steps that follow start-up
            state = put_in(state.engine.fault, opts[:fault])
            if is_integer(state.tick), do: Process.send_after(self(), :tick, state.tick)
            started(path, how, state.world_ms, abandoned)
            {:ok, state}

          {:error, {script, reason}} ->
            diagnostics = diagnostics(reason)

            for d <- diagnostics do
              at = Enum.join(Enum.reject([script, d["line"], d["col"]], &is_nil/1), ":")
              Logger.error("#{at} #{d["message"]}", event: :script_load_failed)
            end

            OdgnEcs.close(world)
            Lock.release(path)
            {:stop, {:script_load_failed, script, diagnostics}}
        end

      {:error, reason} ->
        :ok = OdgnEcs.rollback(world)
        OdgnEcs.close(world)
        Lock.release(path)
        {:stop, {:invalid_starting_room, reason}}
    end
  end

  # A World is built from its EDL the first time, and resumed after: after a
  # crash, this is where it recovers, abandoning commands still waiting.
  defp started(path, how, world_ms, abandoned) do
    Logger.info(
      "World #{how} from #{path} at World time #{world_ms} ms" <>
        if(abandoned > 0, do: ", abandoning #{abandoned} waiting commands", else: ""),
      event: :world_started
    )

    :telemetry.execute([:mua_world, :start], %{world_time: world_ms, abandoned: abandoned}, %{
      path: path,
      how: how
    })
  end

  # A stopped World lets go of its database at once, and its lock with it:
  # NorthTalk's owner holds the connection too, through the callbacks.
  @impl true
  def terminate(_reason, state) do
    if state.talk, do: NorthTalk.close(state.talk.owner)
    if state.world, do: OdgnEcs.close(state.world)
    if state.path, do: Lock.release(state.path)
    :ok
  end

  defp ok!({:ok, value}), do: value

  defp start_talk(state, limits) do
    table = Talk.table()

    with {:ok, talk} <- Talk.start(state.world, table, limits),
         do: {:ok, %{state | talk: talk, table: table}}
  end

  # What went wrong loading a Script, as NorthTalk diagnostics
  defp diagnostics(%NorthTalk.LoadError{diagnostics: diagnostics}), do: diagnostics

  defp diagnostics(reason) when is_exception(reason),
    do: [%{"message" => Exception.message(reason)}]

  defp diagnostics(reason), do: [%{"message" => inspect(reason)}]

  # The engine runs mua's Systems and its own `timers`, sends the notices
  # Scripts ask for between Pumps, takes each Step's outbox before its
  # commit, and publishes it after.
  defp start_engine(state) do
    %{world: world, talk: talk, table: table} = state

    engine =
      OdgnEcsEngine.new(world, talk,
        world_time: state.world_ms,
        systems: MuaWorld.Systems.all(state.places.system),
        timers: %{Lifecycle.timers_script() => &fire_lifecycle(in_step(state, &1), &2)},
        between: Talk.between(talk, world, table),
        output: fn -> Tables.take_outbox(world) end,
        on_step: &on_step(Map.take(state, [:world, :table, :places]), &1),
        telemetry: [:mua_world],
        metadata: &%{lines: length(&1)}
      )

    %{state | engine: engine}
  end

  defp on_step(state, {:ok, %{output: lines, changes: changes}}) do
    publish(state.table, lines)
    publish_changes(state, changes)
  end

  # notices queued by the Step's Scripts went with it
  defp on_step(state, {:error, _}), do: Talk.take_notices(state.table)

  # Each mirrored Character with subscribers is sent what changed in its
  # Perception, which is then kept for the next Step
  defp publish_changes(state, changes) do
    for {{:perceived, character}, {before, held}} <-
          :ets.match_object(state.table, {{:perceived, :_}, :_}),
        pids = subscribers(state.table, character),
        pids != [] do
      now = perception(state, character)
      {change_set, held} = MuaWorld.Mirror.change_set(state.world, before, held, now, changes)
      :ets.insert(state.table, {{:perceived, character}, {now, held}})

      case change_set do
        nil -> :ok
        change_set -> for pid <- pids, do: send(pid, {:mua_changes, character, change_set})
      end
    end

    :ok
  end

  # A Character in Limbo perceives only itself and what it carries
  defp perception(state, character) do
    place = location(state, character)
    place = if place == state.places.limbo, do: nil, else: place
    MuaWorld.Perception.of(state.world, character, place)
  end

  defp publish(table, lines) do
    for {character, text} <- lines,
        pid <- subscribers(table, character),
        do: send(pid, {:mua, character, text})
  end

  defp subscribers(table, character) do
    case :ets.lookup(table, {:subscribers, character}) do
      [{_, pids}] -> pids
      [] -> []
    end
  end

  # The state as a Step's input sees it, with that Step's handle and time
  defp in_step(state, step), do: %{state | step: step, world_ms: step.now}

  # Runs `input`, a function of the state returning the Step's result, as
  # one Step at the World's time.
  defp run_step(state, input) do
    {result, engine} =
      OdgnEcsEngine.step(state.engine, &input.(in_step(state, &1)), at: state.world_ms)

    {result, %{state | engine: engine}}
  end

  # Runs `input` as one Step for a Character, replying with the lines it
  # was told, then runs the NPCs' commands.
  defp reply_lines(state, character, input) do
    case run_step(state, input) do
      {{:ok, %{output: lines}}, state} ->
        {:reply, {:ok, for({^character, t} <- lines, do: t)}, run_npcs(state)}

      {{:error, _}, state} ->
        {:reply, {:error, :step_failed}, run_npcs(state)}
    end
  end

  # Runs `input` as one Step, replying with its result
  defp reply_result(state, input) do
    case run_step(state, input) do
      {{:ok, %{result: result}}, state} -> {:reply, result, state}
      {{:error, _}, state} -> {:reply, {:error, :step_failed}, state}
    end
  end

  # Arms mua's timers, then tells every scripted thing the World has
  # started, as one Step. Scripts load fresh on every start (ADR 0014), so
  # this is where they set themselves up again.
  defp start_world(state) do
    {{:ok, _}, state} =
      run_step(state, fn state ->
        Lifecycle.arm(state.world, instant_us(state.world_ms))
        :ok = OdgnEcs.System.arm(state.world, state.engine.systems, state.world_ms)
        system = OdgnEcsTalk.handle(state.talk, state.places.system)

        for eid <- OdgnEcs.query(state.world, with: ["described"]),
            OdgnEcsTalk.scripted?(state.talk, eid),
            do: {:ok, _} = OdgnEcsTalk.deliver(state.talk, eid, "start", [system])

        :ok
      end)

    state
  end

  # ---------------------------------------------------------------------
  # Calls
  # ---------------------------------------------------------------------

  @impl true
  def handle_call({:command, account, character, ";" <> line}, from, state),
    do: handle_call({:admin_line, account, character, line}, from, state)

  def handle_call({:admin_line, account, character, line}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character) do
      admin? = (OdgnEcs.get(state.world, account, "account") || %{})["admin"] == true

      reply_lines(advance_clock(state), character, fn state ->
        if admin?,
          do: run_admin_line(state, character, String.trim(line)),
          else: tell(state, character, "You can't do that.")
      end)
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:command, account, character, text}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character) do
      reply_lines(advance_clock(state), character, &input(&1, character, String.trim(text)))
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:sign_in, sub, email, admin?}, _from, state) do
    reply_result(state, fn state ->
      world = state.world

      account =
        case Tables.account_for(world, sub) do
          nil ->
            {:ok, eid} = OdgnEcs.create(world)
            :ok = OdgnEcs.put(world, eid, "account", %{})
            eid

          account ->
            account
        end

      :ok = OdgnEcs.put(world, account, "account", %{"admin" => admin? == true})
      Tables.put_identity(world, sub, email, account)
      {:ok, account}
    end)
  end

  def handle_call({:view, account, character}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character) do
      {:reply,
       {:ok, MuaWorld.View.for_character(state.world, character, location(state, character))},
       state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:mirror, account, character}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character) do
      perception = perception(state, character)
      snapshot = MuaWorld.Mirror.snapshot(state.world, perception)
      held = MuaWorld.Mirror.held(snapshot)
      :ets.insert(state.table, {{:perceived, character}, {perception, held}})
      {:reply, {:ok, snapshot}, state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:characters, account}, _from, state) do
    owned =
      for eid <- OdgnEcs.query(state.world, where: [{"player", "account", account}]),
          do: %{
            id: eid,
            name: OdgnEcs.get(state.world, eid, "player")["name"],
            in_play: location(state, eid) != state.places.limbo
          }

    {:reply, owned, state}
  end

  def handle_call(:in_play, _from, state) do
    playing =
      for eid <- OdgnEcs.query(state.world, with: ["player"]),
          location(state, eid) != state.places.limbo,
          do: {OdgnEcs.get(state.world, eid, "player")["account"], eid}

    {:reply, playing, state}
  end

  def handle_call(:create_account, _from, state) do
    reply_result(state, fn state ->
      {:ok, eid} = OdgnEcs.create(state.world)
      :ok = OdgnEcs.put(state.world, eid, "account", %{})
      {:ok, eid}
    end)
  end

  def handle_call({:create_character, account, name}, _from, state) do
    name = String.trim(to_string(name))

    cond do
      OdgnEcs.get(state.world, account, "account") == nil ->
        {:reply, {:error, :not_an_account}, state}

      not Regex.match?(~r/^[A-Za-z][A-Za-z0-9' -]{0,19}$/, name) ->
        {:reply, {:error, :invalid_name}, state}

      name_taken?(state.world, name) ->
        {:reply, {:error, :name_taken}, state}

      true ->
        reply_result(state, fn state ->
          world = state.world
          {:ok, eid} = OdgnEcs.create(world)
          :ok = OdgnEcs.put(world, eid, "player", %{"name" => name, "account" => account})
          :ok = OdgnEcs.put(world, eid, "meta", %{"props" => %{"id" => String.downcase(name)}})
          :ok = OdgnEcs.put(world, eid, "location", %{"in" => state.places.limbo})
          OdgnEcsTalk.handle(state.talk, eid)
          {:ok, eid}
        end)
    end
  end

  def handle_call({:enter, account, character}, _from, state) do
    with :ok <- owns(state, account, character) do
      reply_lines(advance_clock(state), character, &enter_play(&1, character))
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:leave, account, character}, _from, state) do
    with :ok <- owns(state, account, character) do
      case reply_lines(advance_clock(state), character, &leave_play(&1, character)) do
        {:reply, {:ok, _}, state} -> {:reply, :ok, state}
        reply -> reply
      end
    else
      error -> {:reply, error, state}
    end
  end

  # Calls run one at a time, between Steps, so no transaction is open
  def handle_call({:backup, dest}, _from, state) do
    started = System.monotonic_time()
    result = MuaWorld.Backup.vacuum_into(state.world.conn, dest)

    :telemetry.execute(
      [:mua_world, :backup],
      %{duration: System.monotonic_time() - started},
      %{dest: dest, result: elem(result, 0)}
    )

    {:reply, result, state}
  end

  def handle_call(:places, _from, state), do: {:reply, state.places, state}

  def handle_call({:reset, place}, _from, state),
    do: reply_result(advance_clock(state), &reset_place(&1, place))

  def handle_call({:subscribe, character, pid}, _from, state) do
    :ok = OdgnEcs.begin(state.world)
    notices = Tables.take_notices(state.world, character)
    :ok = OdgnEcs.commit(state.world)
    for t <- notices, do: send(pid, {:mua, character, t})
    live = Enum.filter(subscribers(state.table, character), &Process.alive?/1)
    :ets.insert(state.table, {{:subscribers, character}, [pid | live -- [pid]]})
    {:reply, :ok, state}
  end

  def handle_call({:unsubscribe, character, pid}, _from, state) do
    pids = List.delete(subscribers(state.table, character), pid)
    :ets.insert(state.table, {{:subscribers, character}, pids})
    # nothing mirrors it now; a new subscriber fetches a fresh mirror
    if pids == [], do: :ets.delete(state.table, {:perceived, character})
    {:reply, :ok, state}
  end

  def handle_call(:tick, _from, state), do: {:reply, :ok, run_due(advance_clock(state))}

  def handle_call(:world_time, _from, state) do
    state = advance_clock(state)
    {:reply, state.world_ms, state}
  end

  def handle_call({:advance, ms}, _from, state),
    do: {:reply, :ok, %{state | world_ms: state.world_ms + ms}}

  def handle_call(:timers, _from, state),
    do: {:reply, OdgnEcsEngine.Timers.all(state.world), state}

  def handle_call({:component, eid, name}, _from, state),
    do: {:reply, OdgnEcs.get(state.world, eid, name), state}

  def handle_call({:set_component, eid, name, data}, _from, state),
    do: reply_result(state, &OdgnEcs.put(&1.world, eid, name, data))

  def handle_call({:named, name}, _from, state),
    do: {:reply, OdgnEdl.entity_named(state.world, name), state}

  def handle_call(:verbs, _from, state), do: {:reply, Verbs.list(state.vocabulary), state}

  # ---------------------------------------------------------------------
  # Accounts and Characters
  # ---------------------------------------------------------------------

  defp owns(state, account, character) do
    case OdgnEcs.get(state.world, character, "player") do
      %{"account" => ^account} when is_integer(account) -> :ok
      _ -> {:error, :not_owner}
    end
  end

  defp in_play(state, character) do
    if location(state, character) == state.places.limbo,
      do: {:error, :not_in_play},
      else: :ok
  end

  defp location(state, eid), do: (OdgnEcs.get(state.world, eid, "location") || %{})["in"]

  # `player.name` compares ignoring case
  defp name_taken?(world, name), do: OdgnEcs.query(world, where: [{"player", "name", name}]) != []

  # A Character in Limbo returns to the room it left, if that is still a
  # place, otherwise to the Starting room. Those already there see it appear.
  # Only a Character coming out of Limbo is welcomed: one already in play,
  # such as after a page reload, carries on without a fresh greeting.
  defp enter_play(state, character) do
    world = state.world
    player = OdgnEcs.get(world, character, "player")

    if location(state, character) == state.places.limbo do
      room = Places.destination(world, character, state.places)
      :ok = OdgnEcs.put(world, character, "location", %{"in" => room})
      :ok = OdgnEcs.put(world, character, "player", Map.put(player, "return_to", nil))

      if player["return_to"] != nil,
        do: Tables.tell(world, room, "#{player["name"]} appears.", character)

      tell(
        state,
        character,
        "Welcome, #{player["name"]}! Type 'look' to begin, or 'help' for the commands."
      )
    else
      state
    end
  end

  # A Character who leaves waits in Limbo, out of the World, and remembers
  # the room it left.
  defp leave_play(state, character) do
    world = state.world
    room = location(state, character)

    if room != nil and room != state.places.limbo do
      player = OdgnEcs.get(world, character, "player")
      :ok = OdgnEcs.put(world, character, "player", Map.put(player, "return_to", room))
      :ok = OdgnEcs.put(world, character, "location", %{"in" => state.places.limbo})
      Tables.tell(world, room, "#{player["name"]} fades from view.")
    end

    state
  end

  @impl true
  def handle_info(:tick, state) do
    state = run_due(advance_clock(state))
    Process.send_after(self(), :tick, state.tick)
    {:noreply, state}
  end

  # A linked process, such as NorthTalk's owner, that dies takes the World
  # with it, as it did before the World trapped exits
  def handle_info({:EXIT, _pid, reason}, state) when reason not in [:normal, :shutdown],
    do: {:stop, reason, state}

  def handle_info(_, state), do: {:noreply, state}

  # A World ticked by hand keeps World time where `advance/2` put it
  defp advance_clock(%{tick: :manual} = state), do: state

  defp advance_clock(state) do
    now = now_ms()
    %{state | world_ms: state.world_ms + (now - state.read_at), read_at: now}
  end

  defp now_ms, do: System.monotonic_time(:millisecond)

  # The engine runs what is due at World time, each as its own Step (due
  # timers, NorthTalk's deadline, due Systems), then the NPCs' commands run.
  defp run_due(state) do
    run_npcs(%{state | engine: OdgnEcsEngine.advance(state.engine, state.world_ms)})
  end

  # mua's own `timers`: a Script's timers go to its entity, from the engine.
  defp fire_lifecycle(state, timer) do
    :ok = OdgnEcsEngine.Timers.remove(state.world, timer)
    owner = timer["owner"]

    cond do
      not OdgnEcs.exists?(state.world, owner) ->
        :ok

      timer["message"] == "reset" ->
        reset_place(state, owner)

      OdgnEcsTalk.scripted?(state.talk, owner) ->
        system = OdgnEcsTalk.handle(state.talk, state.places.system)
        {:ok, _} = OdgnEcsTalk.deliver(state.talk, owner, timer["message"], [system])

      true ->
        :ok
    end

    Lifecycle.rearm(state.world, timer, instant_us(state.world_ms))
  end

  # What a reset does is the lifecycle Service's to decide (ADR 0024); the
  # place's own Scripts hear of it after
  defp reset_place(state, place) do
    talk = state.talk
    handle = OdgnEcsTalk.handle(talk, place)

    {:ok, pending} =
      OdgnEcsEngine.deliver(state.step, %Delivery{
        to: {:service, "lifecycle"},
        message: "reset",
        args: [handle],
        asks: :request
      })

    :ok = OdgnEcsEngine.pump(state.step)

    moved =
      case OdgnEcsTalk.outcome(pending) do
        {:replied, n} when is_number(n) ->
          trunc(n)

        other ->
          if other == :waiting, do: OdgnEcsTalk.abandon(pending)
          Logger.error("reset of #{place} failed: #{inspect(other)}", event: :reset_failed)
          0
      end

    if OdgnEcsTalk.scripted?(state.talk, place) do
      system = OdgnEcsTalk.handle(state.talk, state.places.system)
      {:ok, _} = OdgnEcsTalk.deliver(state.talk, place, "reset", [system])
    end

    moved
  end

  # The NPC commands queued so far, each a Step of its own. Any they queue
  # wait for the next run, so an NPC answering itself can't loop.
  defp run_npcs(state) do
    Enum.reduce(Tables.queued_acts(state.world), state, fn {id, actor, text}, state ->
      {_, state} =
        run_step(state, fn state ->
          Tables.delete_act(state.world, id)
          npc_input(state, actor, text)
        end)

      state
    end)
  end

  # A bound command skips the parser (ADR 0024)
  defp npc_input(state, actor, %{} = bound) do
    active? = (OdgnEcs.get(state.world, actor, "npc") || %{})["active"] == true

    case active? && Input.bound(bound) do
      {:ok, command} -> run_commands(state, actor, [command], command.verb)
      _ -> state
    end
  end

  defp npc_input(state, actor, text) do
    active? = (OdgnEcs.get(state.world, actor, "npc") || %{})["active"] == true

    with true <- active?,
         {:commands, commands} <- Input.read_npc(state.world, state.vocabulary, actor, text) do
      run_commands(state, actor, commands, text)
    else
      _ -> state
    end
  end

  # ---------------------------------------------------------------------
  # Commands
  # ---------------------------------------------------------------------

  # A Character's input: read into commands, which are dispatched in turn.
  defp input(state, actor, text) do
    world = state.world
    {result, changes} = Input.read(world, state.vocabulary, actor, text)

    if changes != %{} do
      player = OdgnEcs.get(world, actor, "player") || %{}
      :ok = OdgnEcs.put(world, actor, "player", Map.merge(player, changes))
    end

    case result do
      {:reply, message} -> tell(state, actor, message)
      {:commands, commands} -> run_commands(state, actor, commands, text)
    end
  end

  # Each command is dispatched in turn within this Step; one whose Scripts
  # are still waiting carries the rest over to a later Step.
  defp run_commands(state, actor, commands, raw) do
    :ok = Dispatch.run(state.step, state.vocabulary, actor, commands, raw)
    state
  end

  # An admin's line runs in a savepoint, released only if its Run
  # completes, so a line that fails or is still waiting leaves no change,
  # its output included. What the admin is told comes after.
  defp run_admin_line(state, actor, line) do
    world = state.world
    talk = state.talk
    service = "admin:#{actor}"
    :ok = OdgnEcs.savepoint(world, "mua_admin_line")

    {outcome, state} =
      with :ok <- OdgnEcsTalk.put_service_script(talk, service, MuaWorld.Admin.source(line)),
           {:ok, pending} <-
             OdgnEcsEngine.deliver(state.step, %Delivery{
               to: {:service, service},
               message: "line",
               args: [
                 OdgnEcsTalk.handle(talk, actor),
                 OdgnEcsTalk.handle(talk, location(state, actor))
               ],
               asks: :request
             }) do
        :ok = OdgnEcsEngine.pump(state.step)
        outcome = OdgnEcsTalk.outcome(pending)
        if outcome == :waiting, do: OdgnEcsTalk.abandon(pending)
        {outcome, state}
      else
        error -> {error, state}
      end

    case outcome do
      {:replied, value} ->
        :ok = OdgnEcs.release(world, "mua_admin_line")
        tell(state, actor, "=> " <> MuaWorld.Admin.show(value))

      other ->
        :ok = OdgnEcs.rollback_to(world, "mua_admin_line")
        # A Run still waiting is discarded with the line's code, so it can't
        # carry on in a later Step
        if other == :waiting, do: OdgnEcsTalk.put_service_script(talk, service, "")
        tell(state, actor, "!! " <> MuaWorld.Admin.failure(other, line))
    end
  end

  defp tell(state, character, text) do
    Tables.output(state.world, character, text)
    state
  end
end
