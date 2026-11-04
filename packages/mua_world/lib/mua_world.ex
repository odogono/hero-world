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
    Actions,
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

  alias MuaWorld.Commands.{Scope, Verbs}
  alias NorthTalk.{Pending, Result, ScriptError, Verdict}

  # World time 0, as the Instant NorthTalk's Clock reads.
  @epoch ~U[2000-01-01 00:00:00Z]

  defstruct [
    :world,
    # the database's path, whose lock file the World holds
    :path,
    :talk,
    # Command contexts and notices, shared with `mua`'s callbacks.
    :table,
    # The verbs the World understands.
    :vocabulary,
    # Limbo, the system actor and the Starting room (`MuaWorld.Places`).
    :places,
    # What the input of the current Step returns to its caller.
    :result,
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
  build an empty World from (required), `starting_room`, the Definition name
  of the room Characters enter when they have nowhere to return to
  (required), `tick` in milliseconds (100 by default, or `:manual`),
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
    case OdgnEdl.load(world, File.read!(edl_path), path: edl_path) do
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
      fault: opts[:fault],
      tick: Keyword.get(opts, :tick, 100),
      world_ms: Tables.world_time(world),
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
        state = start_talk(state, Keyword.get(opts, :limits, []))
        # a test's `fault` is for the Steps that follow start-up
        state = %{start_world(%{state | fault: nil}) | fault: opts[:fault]}
        if is_integer(state.tick), do: Process.send_after(self(), :tick, state.tick)
        started(path, how, state.world_ms, abandoned)
        {:ok, state}

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

  # mua's Libraries, by the name Scripts `use` them from, and its Service
  # Scripts: its core actions, which no Message Path reaches.
  @libraries ~w(rooms things)
  @services ~w(room exit)

  defp behaviour(path), do: Path.join([:code.priv_dir(:mua_world), "behaviours", path])

  defp start_talk(state, limits) do
    world = state.world
    table = Talk.table()
    {:ok, owner} = NorthTalk.start_link(drive: :manual)
    :ok = NorthTalk.define_capability!(owner, Talk.mua(world, table))

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        owner: owner,
        grants: %{"mua" => NorthTalk.grant!(owner, "mua")},
        limits: limits,
        on_show: &Tables.tell(world, &1, &2)
      )

    for name <- @libraries,
        do:
          {:ok, _} =
            OdgnEcsTalk.add_library(talk, name, File.read!(behaviour("lib/#{name}.talk")), [], [
              "mua"
            ])

    for name <- @services,
        do:
          :ok = OdgnEcsTalk.load_service_script(talk, name, File.read!(behaviour("#{name}.talk")))

    :ok = OdgnEcsTalk.load_scripts(talk, &File.read!/1)
    %{state | talk: talk, table: table}
  end

  # Arms mua's timers, then tells every scripted thing the World has
  # started, as one Step. Scripts load fresh on every start (ADR 0014), so
  # this is where they set themselves up again.
  defp start_world(state) do
    {_, state} =
      step(state, fn state ->
        Lifecycle.arm(state.world, state.talk, instant_us(state.world_ms))
        system = OdgnEcsTalk.handle(state.talk, state.places.system)

        for eid <- OdgnEcs.query(state.world, with: ["described"]),
            OdgnEcsTalk.scripted?(state.talk, eid),
            do: {:ok, _} = OdgnEcsTalk.deliver(state.talk, eid, "start", [system])

        state
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
      state = advance_clock(state)

      {lines, state} =
        step(state, fn state ->
          if admin?,
            do: run_admin_line(state, character, String.trim(line)),
            else: tell(state, character, "You can't do that.")
        end)

      {:reply, {:ok, for({^character, t} <- lines, do: t)}, run_npcs(state)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:command, account, character, text}, _from, state) do
    with :ok <- owns(state, account, character),
         :ok <- in_play(state, character) do
      state = advance_clock(state)
      {lines, state} = step(state, fn state -> input(state, character, String.trim(text)) end)
      {:reply, {:ok, for({^character, t} <- lines, do: t)}, run_npcs(state)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:sign_in, sub, email, admin?}, _from, state) do
    {_, state} =
      step(state, fn state ->
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
        %{state | result: {:ok, account}}
      end)

    reply_result(state)
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
    {_, state} =
      step(state, fn state ->
        {:ok, eid} = OdgnEcs.create(state.world)
        :ok = OdgnEcs.put(state.world, eid, "account", %{})
        %{state | result: {:ok, eid}}
      end)

    reply_result(state)
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
        {_, state} =
          step(state, fn state ->
            world = state.world
            {:ok, eid} = OdgnEcs.create(world)
            :ok = OdgnEcs.put(world, eid, "player", %{"name" => name, "account" => account})
            :ok = OdgnEcs.put(world, eid, "meta", %{"props" => %{"id" => String.downcase(name)}})
            :ok = OdgnEcs.put(world, eid, "location", %{"in" => state.places.limbo})
            OdgnEcsTalk.handle(state.talk, eid)
            %{state | result: {:ok, eid}}
          end)

        reply_result(state)
    end
  end

  def handle_call({:enter, account, character}, _from, state) do
    with :ok <- owns(state, account, character) do
      state = advance_clock(state)
      {lines, state} = step(state, &enter_play(&1, character))
      {:reply, {:ok, for({^character, t} <- lines, do: t)}, run_npcs(state)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:leave, account, character}, _from, state) do
    with :ok <- owns(state, account, character) do
      state = advance_clock(state)
      {_, state} = step(state, &leave_play(&1, character))
      {:reply, :ok, run_npcs(state)}
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

  def handle_call({:reset, place}, _from, state) do
    state = advance_clock(state)
    {_, state} = step(state, &reset_place(&1, place))
    reply_result(state)
  end

  def handle_call({:subscribe, character, pid}, _from, state) do
    :ok = OdgnEcs.begin(state.world)
    notices = Tables.take_notices(state.world, character)
    :ok = OdgnEcs.commit(state.world)
    for t <- notices, do: send(pid, {:mua, character, t})
    live = Enum.filter(Map.get(state.subscribers, character, []), &Process.alive?/1)
    {:reply, :ok, put_in(state.subscribers[character], [pid | live -- [pid]])}
  end

  def handle_call({:unsubscribe, character, pid}, _from, state),
    do: {:reply, :ok, update_in(state.subscribers[character], &List.delete(&1 || [], pid))}

  def handle_call(:tick, _from, state), do: {:reply, :ok, run_due(advance_clock(state))}

  def handle_call(:world_time, _from, state) do
    state = advance_clock(state)
    {:reply, state.world_ms, state}
  end

  def handle_call({:advance, ms}, _from, state),
    do: {:reply, :ok, %{state | world_ms: state.world_ms + ms}}

  def handle_call({:component, eid, name}, _from, state),
    do: {:reply, OdgnEcs.get(state.world, eid, name), state}

  def handle_call({:set_component, eid, name, data}, _from, state) do
    {_, state} =
      step(state, fn state -> %{state | result: OdgnEcs.put(state.world, eid, name, data)} end)

    reply_result(state)
  end

  def handle_call({:named, name}, _from, state),
    do: {:reply, OdgnEdl.entity_named(state.world, name), state}

  def handle_call(:verbs, _from, state), do: {:reply, Verbs.list(state.vocabulary), state}

  defp reply_result(state), do: {:reply, state.result, %{state | result: nil}}

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

  defp name_taken?(world, name) do
    wanted = String.downcase(name)

    world
    |> OdgnEcs.query(with: ["player"])
    |> Enum.any?(&(String.downcase(OdgnEcs.get(world, &1, "player")["name"]) == wanted))
  end

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
        {_, state} = step(state, &fire(&1, timer))
        state
      end)

    state =
      if state.next_deadline != nil and state.next_deadline <= state.world_ms,
        do: elem(step(state, & &1), 1),
        else: state

    run_npcs(state)
  end

  # A Script's timer goes to its entity; mua's own `timers` are handled here.
  defp fire(state, %{"script" => script} = timer) do
    if script == Lifecycle.timers_script() do
      OdgnEcsTalk.remove_timer(state.talk, timer)
      owner = timer["owner"]

      state =
        cond do
          not OdgnEcs.exists?(state.world, owner) ->
            state

          timer["message"] == "reset" ->
            reset_place(state, owner)

          OdgnEcsTalk.scripted?(state.talk, owner) ->
            system = OdgnEcsTalk.handle(state.talk, state.places.system)
            {:ok, _} = OdgnEcsTalk.deliver(state.talk, owner, timer["message"], [system])
            state

          true ->
            state
        end

      Lifecycle.rearm(state.world, state.talk, timer, instant_us(state.world_ms))
      state
    else
      OdgnEcsTalk.fire_timer(state.talk, timer)
      state
    end
  end

  defp reset_place(state, place) do
    moved = Lifecycle.put_back(state.world, place)

    if OdgnEcsTalk.scripted?(state.talk, place) do
      system = OdgnEcsTalk.handle(state.talk, state.places.system)
      {:ok, _} = OdgnEcsTalk.deliver(state.talk, place, "reset", [system])
    end

    %{state | result: moved}
  end

  # The NPC commands queued so far, each a Step of its own. Any they queue
  # wait for the next run, so an NPC answering itself can't loop.
  defp run_npcs(state) do
    Enum.reduce(Tables.queued_acts(state.world), state, fn {id, actor, text}, state ->
      {_, state} =
        step(state, fn state ->
          Tables.delete_act(state.world, id)
          npc_input(state, actor, text)
        end)

      state
    end)
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
  # Steps
  # ---------------------------------------------------------------------

  # One Step: the input, pumps until idle, the results it settles, then one
  # COMMIT, and only then the output.
  defp step(state, input) do
    world = state.world
    started = System.monotonic_time()
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
      :ok ->
        :ok

      {:error, reason} ->
        Logger.error("World commit failed, restarting from the last commit: #{inspect(reason)}",
          event: :commit_failed
        )

        :telemetry.execute([:mua_world, :commit, :error], %{count: 1}, %{reason: reason})
        exit({:commit_failed, reason})
    end

    :telemetry.execute(
      [:mua_world, :step, :stop],
      %{duration: System.monotonic_time() - started},
      %{lines: length(lines)}
    )

    fault(state, :after_commit)
    publish(state, lines)
    {lines, state}
  end

  defp fault(%{fault: point}, point), do: Process.exit(self(), :kill)
  defp fault(_, _), do: :ok

  # Pumps until the Group is idle, sending the notices Scripts asked for
  # along the way.
  defp pump_idle(state) do
    {:ok, pump} = OdgnEcsTalk.pump(state.talk, instant(state.world_ms))
    state = %{state | next_deadline: deadline(pump.next_deadline)}
    notices = Talk.take_notices(state.table)

    for {place, message, who} <- notices,
        do: send_notice(state, place, message, [{:entity, who}])

    if pump.state == "sliced" or notices != [], do: pump_idle(state), else: state
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

  defp run_commands(state, _actor, [], _raw), do: state

  defp run_commands(state, actor, [command | rest], raw) do
    ctx =
      command
      |> Map.take([:verb, :target, :indirect, :target_id, :indirect_id, :direction, :text])
      |> Map.merge(%{actor: actor, raw: raw, vocabulary: state.vocabulary})

    run_dispatch(state, ctx, fn state, outcome ->
      state
      |> finish(ctx, outcome, command[:label])
      |> run_commands(actor, rest, raw)
    end)
  end

  @doc false
  # Asks the questions of `MuaWorld.Dispatch` in turn, then runs the action,
  # and calls `k` with the outcome. A Script that hasn't answered once its
  # Pumps are idle carries the rest over to a later Step.
  def run_dispatch(state, ctx, k),
    do: ask_each(state, ctx, Dispatch.questions(state.world, ctx), k)

  defp ask_each(state, ctx, [], k), do: run_action(state, ctx, k)

  defp ask_each(state, ctx, [q | rest], k) do
    cond do
      q.response != nil ->
        k.(state, Actions.refused(q.response))

      not answerable?(state, q.to) ->
        ask_each(state, ctx, rest, k)

      true ->
        ask(state, ctx, q, fn state, reply ->
          case {reply, q.kind} do
            {{:replied, message}, :receiver} ->
              k.(state, Actions.done(message || ""))

            {{:replied, message}, :veto} ->
              k.(state, Actions.refused(message || Dispatch.cannot()))

            {:failed, _} ->
              k.(state, Actions.refused("Something went wrong."))

            {:passed, _} ->
              ask_each(state, ctx, rest, k)
          end
        end)
    end
  end

  defp run_action(state, ctx, k) do
    if Dispatch.scripted?(ctx.verb) do
      case Dispatch.plan(state.world, ctx) do
        {:refused, message} ->
          k.(state, Actions.refused(message))

        {:send, to, message, args} ->
          q = %{kind: :action, asks: :offer, to: to, message: message, args: args, response: nil}

          ask(state, ctx, q, fn state, reply ->
            case reply do
              {:replied, message} ->
                after_each(
                  state,
                  ctx,
                  Dispatch.afters(state.world, ctx),
                  Actions.done(message || ""),
                  k
                )

              :failed ->
                k.(state, Actions.refused("Something went wrong."))

              :passed ->
                k.(state, Actions.refused(Dispatch.cannot()))
            end
          end)
      end
    else
      case run_built_in(state.world, ctx) do
        :pass -> k.(state, Actions.refused(Dispatch.cannot()))
        outcome -> after_each(state, ctx, Dispatch.afters(state.world, ctx), outcome, k)
      end
    end
  end

  # A built-in runs in a savepoint of its own: one that refuses, or raises,
  # leaves no partial change behind.
  defp run_built_in(world, ctx) do
    :ok = OdgnEcs.savepoint(world, "mua_action")

    outcome =
      try do
        Actions.run(world, ctx)
      rescue
        e ->
          OdgnEcs.rollback_to(world, "mua_action")
          reraise e, __STACKTRACE__
      end

    case outcome do
      %{kind: :done} -> :ok = OdgnEcs.release(world, "mua_action")
      _ -> :ok = OdgnEcs.rollback_to(world, "mua_action")
    end

    outcome
  end

  # Once an action has succeeded, `after<Verb>` goes to the same receivers,
  # whose replies are added to its message.
  defp after_each(state, _ctx, _afters, %{kind: kind} = outcome, k) when kind != :done,
    do: k.(state, outcome)

  defp after_each(state, _ctx, [], outcome, k), do: k.(state, outcome)

  defp after_each(state, ctx, [q | rest], outcome, k) do
    if answerable?(state, q.to) do
      ask(state, ctx, q, fn state, reply ->
        outcome =
          case reply do
            {:replied, line} when line not in [nil, ""] ->
              %{
                outcome
                | message:
                    Enum.join(Enum.reject([outcome.message, line], &(&1 in [nil, ""])), "\n")
              }

            _ ->
              outcome
          end

        after_each(state, ctx, rest, outcome, k)
      end)
    else
      after_each(state, ctx, rest, outcome, k)
    end
  end

  defp answerable?(_state, {:service, _}), do: true
  defp answerable?(state, eid), do: OdgnEcsTalk.scripted?(state.talk, eid)

  # Sends one question, Pumps until idle, and answers `k` now or, if its Run
  # is still waiting, in the Step that sees it end.
  defp ask(state, ctx, q, k) do
    talk = state.talk
    now = instant(state.world_ms)
    args = Enum.map(q.args, &arg(state, &1))
    Talk.note_context(state.table, :current, ctx)

    {:ok, pending} =
      case {q.asks, q.to} do
        {:offer, {:service, service}} ->
          OdgnEcsTalk.request_service(talk, service, q.message, args, now)

        {:offer, eid} ->
          OdgnEcsTalk.request(talk, eid, q.message, args, now)

        {:decide, {:service, service}} ->
          OdgnEcsTalk.decide_service(talk, service, q.message, args)

        {:decide, eid} ->
          OdgnEcsTalk.decide(talk, eid, q.message, args)
      end

    Talk.note_context(state.table, pending.id, ctx)
    state = pump_idle(state)

    answer = fn state, result ->
      Talk.drop_context(state.table, pending.id)
      k.(state, reply(q.asks, result))
    end

    case NorthTalk.await(pending, 0) do
      {:error, %NorthTalk.HostError{code: "timeout"}} ->
        wait(state, pending, ctx.actor, ctx.raw, answer)

      result ->
        NorthTalk.release_pending(pending)
        answer.(state, result)
    end
  end

  defp arg(state, {:entity, eid}), do: OdgnEcsTalk.handle(state.talk, eid)
  defp arg(_state, text), do: text

  defp reply(:offer, {:ok, %Result{value: value}}),
    do: {:replied, if(is_binary(value), do: value)}

  defp reply(:offer, {:error, %ScriptError{outcome: "unhandled"}}), do: :passed

  defp reply(:decide, {:ok, %Verdict{verdict: :vetoed, vetoes: [veto | _]}}),
    do: {:replied, if(is_binary(veto.reason), do: veto.reason)}

  defp reply(:decide, {:ok, %Verdict{verdict: :allowed}}), do: :passed
  defp reply(_, _), do: :failed

  # Tells the actor, the Scripts that notice it, and everyone else who saw it.
  defp finish(state, ctx, outcome, label) do
    message = outcome.message

    state =
      if message not in [nil, ""],
        do: tell(state, ctx.actor, if(label, do: "#{label}: #{message}", else: message)),
        else: state

    if outcome.kind == :done do
      for {place, notice, args} <- outcome.notices, do: send_notice(state, place, notice, args)

      for {place, line, except} <- outcome.broadcasts,
          do: Tables.tell(state.world, place, line, except)
    end

    state
  end

  # A notice goes to the Scripts of the things in its place, but not the one
  # it is about (its first argument), such as the actor who arrived.
  defp send_notice(state, place, message, args) do
    about = with [{:entity, eid} | _] <- args, do: eid
    values = Enum.map(args, &arg(state, &1))

    for watcher <- Scope.entities_in(state.world, place),
        watcher != about,
        OdgnEcsTalk.scripted?(state.talk, watcher),
        do: {:ok, _} = OdgnEcsTalk.deliver(state.talk, watcher, message, values)

    :ok
  end

  # An admin's line runs in a savepoint, released only if its Run
  # completes, so a line that fails or is still waiting leaves no change,
  # its output included. What the admin is told comes after.
  defp run_admin_line(state, actor, line) do
    world = state.world
    talk = state.talk
    service = "admin:#{actor}"
    :ok = OdgnEcs.savepoint(world, "mua_admin_line")

    outcome =
      with :ok <- OdgnEcsTalk.put_service_script(talk, service, MuaWorld.Admin.source(line)),
           {:ok, pending} <-
             OdgnEcsTalk.request_service(
               talk,
               service,
               "line",
               [
                 OdgnEcsTalk.handle(talk, actor),
                 OdgnEcsTalk.handle(talk, location(state, actor))
               ],
               instant(state.world_ms)
             ) do
        settle_line(state, pending, 50)
      end

    case outcome do
      {:ok, %NorthTalk.Result{value: value}} ->
        :ok = OdgnEcs.release(world, "mua_admin_line")
        tell(state, actor, "=> " <> MuaWorld.Admin.show(value))

      other ->
        :ok = OdgnEcs.rollback_to(world, "mua_admin_line")
        # A Run still waiting is discarded with the line's code, so it can't
        # carry on in a later Step
        if other == :unfinished, do: OdgnEcsTalk.put_service_script(talk, service, "")
        tell(state, actor, "!! " <> MuaWorld.Admin.failure(other, line))
    end
  end

  defp settle_line(state, pending, tries) do
    case NorthTalk.await(pending, 0) do
      {:error, %NorthTalk.HostError{code: "timeout"}} when tries > 0 ->
        {:ok, _} = OdgnEcsTalk.pump(state.talk, instant(state.world_ms))
        settle_line(state, pending, tries - 1)

      {:error, %NorthTalk.HostError{code: "timeout"}} ->
        NorthTalk.release_pending(pending)
        :unfinished

      result ->
        NorthTalk.release_pending(pending)
        result
    end
  end

  defp tell(state, character, text) do
    Tables.output(state.world, character, text)
    state
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
