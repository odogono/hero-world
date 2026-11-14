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

      {:ok, world} = MuaWorld.start_link(path: "world.db", edl: "main.edl", starting_room: "harbour_steps")
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
    Request,
    Tables,
    Talk
  }

  alias MuaWorld.Commands.{Scope, Verbs}
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

  # A command is refused at once while more than this many messages wait
  # for the World, and dropped unrun if it waits longer than `@within`: its
  # caller has given up by then (#139).
  @max_queue 30
  @within 3_000

  @doc """
  Runs one command for a Character as one Step. Returns the Character's
  output once committed, `{:error, :not_owner}` if the Account doesn't own
  the Character, or `{:error, :not_in_play}` if it is in Limbo.

  When the World is behind, the command is refused with `{:error, :busy}`
  and changes nothing (#139): at once while more than `max_queue` messages
  (30) wait for the World, or when it would start more than `within` ms
  (3 s) after it was sent, since its caller has given up by then. Joins,
  timers and the other calls are never refused, and once commands stop
  piling up behind them they keep their pace.
  """
  def command(world, account, character, text, opts \\ []) do
    if backlog(world) > Keyword.get(opts, :max_queue, @max_queue) do
      {:error, :busy}
    else
      deadline = System.monotonic_time(:millisecond) + Keyword.get(opts, :within, @within)
      GenServer.call(world, {:command, account, character, text, deadline}, 30_000)
    end
  end

  # How many messages wait for the World
  defp backlog(world) do
    with pid when is_pid(pid) <- GenServer.whereis(world),
         {:message_queue_len, n} <- Process.info(pid, :message_queue_len) do
      n
    else
      _ -> 0
    end
  end

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
  Places a thing a builder composed in the room their Character stands in,
  as one Step (#258). `composition` is a map of component names to their
  data. Whether it may be placed is the `build` Service Script's to decide
  (`mua-scripts/scripts/services/build.talk`): the Account must have a
  `builder` component and be under its `max_placed`, and the composition
  must be valid. The thing records its Maker in `made_by`.

  Returns `{:ok, %{eid, placed, max_placed}}`, or `{:error, reason}` with
  nothing written: the Script's refusal as text, or `:not_owner` and
  `:not_in_play` as `command/4` gives them.
  """
  def place(world, account, character, composition),
    do: GenServer.call(world, {:place, account, character, composition}, 30_000)

  @doc """
  The placed thing a Character has open to edit, after the `edit` Verb
  opened it (#274), as `{:ok, %{eid, composition}}`: its buildable
  components as they stand. `{:ok, nil}` when it has none open, and
  `{:error, :not_owner}` if the Account doesn't own the Character.
  """
  def editing(world, account, character),
    do: GenServer.call(world, {:editing, account, character})

  @doc """
  Saves an edit to the placed thing a Character has open, as one Step
  (#274). `patch` is `%{"put" => %{name => properties}, "remove" =>
  [name]}`. The thing must be the one the `edit` Verb opened, and still
  within the Character's reach; whether the edit may be made is the
  `build` Service Script's to decide. A saved edit closes the thing.

  Returns `{:ok, %{eid}}`, or `{:error, reason}` with nothing written: the
  refusal as text, or `:not_owner` and `:not_in_play` as `command/4` gives
  them.
  """
  def edit(world, account, character, eid, patch),
    do: GenServer.call(world, {:edit, account, character, eid, patch}, 30_000)

  @doc """
  Stores or destroys the placed thing a Character has open to edit, as the
  `store` and `destroy` Verbs do, as one Step (#284). `verb` is `"store"`
  or `"destroy"`. The thing must be the one the `edit` Verb opened, and
  still within reach, as for `edit/5`.

  Returns `{:ok, %{eid, placed, max_placed}}`, the Account's count after
  it, or `{:error, reason}` with nothing written, as `edit/5` does.
  """
  def put_away(world, account, character, eid, verb) when verb in ["store", "destroy"],
    do: GenServer.call(world, {:put_away, account, character, eid, verb}, 30_000)

  @doc "Closes the thing a Character has open to edit, if any, as one Step."
  def stop_editing(world, account, character),
    do: GenServer.call(world, {:stop_editing, account, character}, 30_000)

  @doc """
  An Account's building limits and how many things it has placed, as
  `%{placed, max_placed, max_capacity}`, or `nil` for an Account that
  doesn't build.
  """
  def builder(world, account), do: GenServer.call(world, {:builder, account})

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
  Sends the calling process `{:mua, character, line}` for each line of the
  Character's output, from now on: its text, or `%{text, suggestions}` when
  it offers Suggestions. Notices left from before a restart come
  first. It is also sent `{:mua_editing, character}` after a Step that
  changed what the Character has open to edit, for `editing/3` to read.
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

    with {:ok, places} <- Places.ensure(world, opts[:starting_room]),
         {:ok, pictures} <- pictures(world, opts[:edl]) do
      Lifecycle.record_homes(world)
      :ok = OdgnEcs.commit(world)
      state = %{state | vocabulary: Verbs.from_world(world), places: places}

      case start_talk(state, Keyword.get(opts, :limits, []), pictures) do
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
    else
      {:error, {:pictures, message}} ->
        Logger.error("World at #{path} can't start: #{message}", event: :world_not_started)
        :ok = OdgnEcs.rollback(world)
        OdgnEcs.close(world)
        Lock.release(path)
        {:stop, {:pictures, message}}

      {:error, reason} ->
        :ok = OdgnEcs.rollback(world)
        OdgnEcs.close(world)
        Lock.release(path)
        {:stop, {:invalid_starting_room, reason}}
    end
  end

  # Every place's Picture, checked against the files beside the EDL
  defp pictures(world, edl_path) do
    case MuaWorld.Pictures.load(world, edl_path) do
      {:ok, urls} -> {:ok, urls}
      {:error, message} -> {:error, {:pictures, message}}
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

  defp start_talk(state, limits, pictures) do
    table = Talk.table()
    Talk.put_pictures(table, pictures)

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
    publish_editing(state.table, changes)
  end

  # notices queued by the Step's Scripts went with it
  defp on_step(state, {:error, _}), do: Talk.take_notices(state.table)

  # A Character whose `editing` the Step changed, such as by storing or
  # destroying the thing it had open (#284), so its composer can follow
  defp publish_editing(table, changes) do
    for {character, "editing", _op, _data} <- changes,
        pid <- subscribers(table, character),
        do: send(pid, {:mua_editing, character})

    :ok
  end

  # Each mirrored Character with subscribers is sent what changed in its
  # Perception, which is then kept for the next Step. A Character the Step
  # can't have touched is skipped without reading its Perception, so a
  # Step's cost doesn't grow with everyone in play (#139).
  defp publish_changes(state, changes) do
    touched = touched(changes)

    for {{:perceived, character}, {before, held}} <-
          :ets.match_object(state.table, {{:perceived, :_}, :_}),
        not MapSet.disjoint?(touched, before.entities),
        pids = subscribers(state.table, character),
        pids != [],
        reduce: %{} do
      arounds ->
        {now, arounds} = perception(state, character, arounds)
        publish_change_set(state, character, pids, before, held, now, changes)
        arounds
    end

    :ok
  end

  defp publish_change_set(state, character, pids, before, held, now, changes) do
    {change_set, held} = MuaWorld.Mirror.change_set(state.world, before, held, now, changes)
    :ets.insert(state.table, {{:perceived, character}, {now, held}})

    if change_set,
      do: for(pid <- pids, do: send(pid, {:mua_changes, character, change_set}))
  end

  # Every entity a change set could alter a Perception through: each entity
  # that changed, and each holder something was put in. A Perception reads
  # only its entities' components and what their `location`s hold, so one
  # that includes none of these is the same after the Step.
  defp touched(changes) do
    for {eid, name, _op, data} <- changes, reduce: MapSet.new() do
      acc ->
        acc = MapSet.put(acc, eid)

        case {name, data} do
          {"location", %{"in" => holder}} when is_integer(holder) -> MapSet.put(acc, holder)
          _ -> acc
        end
    end
  end

  # A Character in Limbo perceives only itself and what it carries
  defp perception(state, character) do
    {perception, _} = perception(state, character, %{})
    perception
  end

  # As `perception/2`, reusing what is seen around each place, kept in
  # `arounds` by place, for many Characters at once
  defp perception(state, character, arounds) do
    place = location(state, character)
    place = if place == state.places.limbo, do: nil, else: place

    {around, arounds} =
      case arounds do
        %{^place => around} ->
          {around, arounds}

        _ ->
          around = MuaWorld.Perception.around(state.world, place)
          {around, Map.put(arounds, place, around)}
      end

    {MuaWorld.Perception.of(state.world, character, place, around), arounds}
  end

  defp publish(table, lines) do
    for {character, line} <- lines,
        pid <- subscribers(table, character),
        do: send(pid, {:mua, character, line})
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
  # Past its deadline its caller has given up: running it would only delay
  # what comes after it
  def handle_call({:command, account, character, text, deadline}, from, state) do
    if System.monotonic_time(:millisecond) > deadline do
      {:reply, {:error, :busy}, state}
    else
      handle_call({:command, account, character, text}, from, state)
    end
  end

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

  def handle_call({:place, account, character, composition}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character) do
      reply_result(advance_clock(state), &place_thing(&1, character, composition))
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:editing, account, character}, _from, state) do
    with :ok <- owns(state, account, character) do
      reply =
        case OdgnEcs.get(state.world, character, "editing") do
          %{"thing" => thing} when is_integer(thing) ->
            %{eid: thing, composition: composition(state.world, thing)}

          _ ->
            nil
        end

      {:reply, {:ok, reply}, state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:edit, account, character, eid, patch}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character),
         :ok <- editing_this(state, character, eid) do
      reply_result(advance_clock(state), &save_edit(&1, character, eid, patch))
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:put_away, account, character, eid, verb}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character),
         :ok <- editing_this(state, character, eid) do
      reply_result(advance_clock(state), fn state ->
        with {:ok, _} <- build(state, character, verb, [OdgnEcsTalk.handle(state.talk, eid)]) do
          builder = OdgnEcs.get(state.world, account, "builder") || %{}

          {:ok,
           %{eid: eid, placed: placed(state.world, account), max_placed: builder["max_placed"]}}
        end
      end)
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:stop_editing, account, character}, _from, state) do
    with :ok <- owns(state, account, character) do
      reply_result(state, &OdgnEcs.remove(&1.world, character, "editing"))
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:builder, account}, _from, state) do
    reply =
      case OdgnEcs.get(state.world, account, "builder") do
        nil ->
          nil

        builder ->
          %{
            placed: placed(state.world, account),
            max_placed: builder["max_placed"],
            max_capacity: builder["max_capacity"]
          }
      end

    {:reply, reply, state}
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
      # Scripts reach an Account through its Characters' `player.account`
      OdgnEcsTalk.handle(state.talk, account)
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
      OdgnEcsTalk.handle(state.talk, eid)
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

  # What a reset does is the lifecycle Service's to decide (ADR 0024), all
  # or nothing; the place's own Scripts hear of it after, if it worked.
  # Returns how many things it moved.
  defp reset_place(state, place) do
    talk = state.talk

    asked =
      Request.ask(state.step, fn ->
        delivery = %Delivery{
          to: {:service, "lifecycle"},
          message: "reset",
          args: [OdgnEcsTalk.handle(talk, place)]
        }

        {:ok, delivery, &moved/1}
      end)

    case asked do
      {:ok, moved} ->
        if OdgnEcsTalk.scripted?(talk, place) do
          system = OdgnEcsTalk.handle(talk, state.places.system)
          {:ok, _} = OdgnEcsTalk.deliver(talk, place, "reset", [system])
        end

        moved

      other ->
        Logger.error("reset of #{place} failed: #{inspect(other)}", event: :reset_failed)
        0
    end
  end

  defp moved(n) when is_number(n), do: {:ok, trunc(n)}
  defp moved(_), do: :malformed

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

  # An admin's line runs as a Request, kept only if its Run replies, so a
  # line that fails, refuses or is still waiting leaves no change, its
  # output included. What the admin is told comes after.
  defp run_admin_line(state, actor, line) do
    talk = state.talk
    service = "admin:#{actor}"

    asked =
      Request.ask(state.step, fn ->
        with :ok <- OdgnEcsTalk.put_service_script(talk, service, MuaWorld.Admin.source(line)) do
          delivery = %Delivery{
            to: {:service, service},
            message: "line",
            args: [
              OdgnEcsTalk.handle(talk, actor),
              OdgnEcsTalk.handle(talk, location(state, actor))
            ]
          }

          {:ok, delivery, &{:ok, &1}}
        end
      end)

    case asked do
      {:ok, value} ->
        tell(state, actor, "=> " <> MuaWorld.Admin.show(value))

      {:refused, reason} ->
        tell(state, actor, "!! refused: " <> reason)

      {:failed, why} ->
        # A Run still waiting is discarded with the line's code, so it can't
        # carry on in a later Step
        if why == :waiting, do: OdgnEcsTalk.put_service_script(talk, service, "")
        tell(state, actor, "!! " <> MuaWorld.Admin.failure(why, line))
    end
  end

  # A builder's thing: an empty entity the `build` Service fills in and
  # places, kept only if it did. A refusal, or a Script that fails, leaves
  # no change, the entity included.
  defp place_thing(state, actor, composition) do
    world = state.world
    talk = state.talk

    asked =
      Request.ask(state.step, fn ->
        # A rolled-back entity's id comes back for the next one made, so
        # its Handle is kept: NorthTalk won't make another with the same
        # id, and an entity made at play has no Lineage, so the Handle fits
        {:ok, thing} = OdgnEcs.create(world)

        delivery = %Delivery{
          to: {:service, "build"},
          message: "place",
          args: [
            OdgnEcsTalk.handle(talk, thing),
            OdgnEcsTalk.Values.to_value(composition),
            OdgnEcsTalk.handle(talk, actor)
          ]
        }

        {:ok, delivery, &placed_reply(thing, &1)}
      end)

    case asked do
      {:ok, {message, suggestions, reply}} ->
        tell(state, actor, message, suggestions)
        {:ok, reply}

      other ->
        not_built(other)
    end
  end

  # What the `build` Service's reply means when it placed the thing:
  # `{message, placed, max_placed}`, with any `suggestions` the message
  # offers (#275)
  defp placed_reply(thing, %NorthTalk.Map{} = value) do
    case OdgnEcsTalk.Values.from_value(value) do
      %{"message" => message, "placed" => placed, "max_placed" => max} = value
      when is_binary(message) and is_integer(placed) and is_integer(max) ->
        suggestions = Enum.filter(List.wrap(value["suggestions"]), &is_binary/1)
        {:ok, {message, suggestions, %{eid: thing, placed: placed, max_placed: max}}}

      _ ->
        :malformed
    end
  end

  defp placed_reply(_thing, _value), do: :malformed

  # Only the thing the `edit` Verb opened can be saved, and only while it
  # is still within reach, as the Verb found it
  defp editing_this(state, character, eid) do
    world = state.world

    cond do
      OdgnEcs.get(world, character, "editing") != %{"thing" => eid} ->
        {:error, "Open it with edit first."}

      not Enum.any?(Scope.in_reach(world, character, "here"), &(&1.id == eid)) ->
        {:error, "You can't reach that from here."}

      true ->
        :ok
    end
  end

  # A placed thing's buildable components, as they stand
  defp composition(world, thing) do
    for {name, %{buildable: true}} <- world.components,
        data = OdgnEcs.get(world, thing, name),
        into: %{},
        do: {name, data}
  end

  # An edit to a placed thing, which the `build` Service checks and writes
  defp save_edit(state, actor, thing, patch) do
    talk = state.talk

    args = [
      OdgnEcsTalk.handle(talk, thing),
      OdgnEcsTalk.Values.to_value(patch),
      OdgnEcsTalk.Values.to_value(composition(state.world, thing))
    ]

    with {:ok, _} <- build(state, actor, "save", args), do: {:ok, %{eid: thing}}
  end

  # Sends `message args…, actor` to the `build` Service as a Request,
  # keeping what it did only if it replied text, which the actor is told.
  # A refusal, or a Script that fails, writes nothing.
  defp build(state, actor, message, args) do
    talk = state.talk

    asked =
      Request.ask(state.step, fn ->
        delivery = %Delivery{
          to: {:service, "build"},
          message: message,
          args: args ++ [OdgnEcsTalk.handle(talk, actor)]
        }

        {:ok, delivery, &built_text/1}
      end)

    case asked do
      {:ok, text} ->
        tell(state, actor, text)
        {:ok, text}

      other ->
        not_built(other)
    end
  end

  defp built_text(text) when is_binary(text), do: {:ok, text}
  defp built_text(_), do: :malformed

  # What a builder is told when the `build` Service didn't do what they
  # asked. A write the composition doesn't fit, such as text for a number,
  # fails the Script: that is the builder's to fix, so it says why.
  defp not_built({:refused, reason}), do: {:error, reason}
  defp not_built({:failed, {:malformed, _}}), do: {:error, "Something went wrong."}

  defp not_built({:failed, why}),
    do: {:error, "That can't be built: #{MuaWorld.Admin.failure(why)}"}

  # How many things an Account has placed
  defp placed(world, account),
    do: length(OdgnEcs.query(world, where: [{"made_by", "account", account}]))

  defp tell(state, character, text, suggestions \\ []) do
    Tables.output(state.world, character, text, suggestions)
    state
  end
end
