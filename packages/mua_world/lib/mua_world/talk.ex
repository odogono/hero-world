defmodule MuaWorld.Talk do
  @moduledoc """
  mua's own Capability for Scripts, beside `odgn_ecs_talk`'s `world`, `clock`
  and `timer`, ported from `scripts/mua-capability.ts`:

  - `buildable`: the names of the components a builder may compose a new
    entity from, as their definitions mark them (#259), in name order.
  - `announce place, text, except`: tells every Character in `place` but
    `except` (which may be Nothing).
  - `command`: the command the Script is handling, as a map of `verb`,
    `actor`, `target`, `indirect`, `text` and `direction` (Nothing for any it
    doesn't have), or Nothing outside a command.
  - `homed place`: the things whose `home` is `place`, for a reset.
  - `limbo`: Limbo, where a stored thing waits (#282).
  - `editors thing`: the Characters who have `thing` open in the composer.
  - `placed account`: how many things the Account has placed, by their
    `made_by`, for a builder's quota (#258).
  - `picture place, actor`: shows `place`'s Picture to `actor`, if it is a
    Character and the place has one (ADR 0027). The `rooms` Library's
    `describe` sends it, so it arrives just before the description.
  - `notice place, message, who, text`: sends `message who` (or
    `message who, text` when `text` is given) to the Scripts of the things
    in a place but `who`, once the Run's Pump ends.
  - `verbs`: the World's Verbs, as a map of `names` (each Verb's first
    name) and `aliases` (the Direction Aliases), for `help`.

  - `act actor, command`: has an NPC carry out a command as a Character
    would, as a Step of its own after the current one commits (ADR 0003).
    The command is a line to parse, or one already bound: a map of `verb`
    and any of `target`, `indirect`, `direction` and `text`, which skips
    the parser (ADR 0024).

  Scripts fill in message templates themselves, with the `messages`
  Library; the Host formats no text (ADR 0024).

  Callbacks run in NorthTalk's Tasks while the World process is blocked in a
  Pump (ADR 0015). They write the outbox inside the World's transaction, and
  share the World process's table for queued notices. The command a Run
  handles is the host term of its Delivery (`OdgnEcsTalk.delivery/2`).
  """
  alias NorthTalk.{Capability, Object}
  alias OdgnEcsTalk.Values

  # odgn_ecs_talk's default Group, whose Handles are `entity` Objects
  @group "world"

  @doc "A table for queued notices, shared with callbacks."
  def table, do: :ets.new(:mua_talk, [:set, :public])

  @doc "Keeps the World's Pictures (`MuaWorld.Pictures.load/2`) for callbacks."
  def put_pictures(table, urls), do: :ets.insert(table, {:pictures, urls})

  defp pictures(table) do
    case :ets.lookup(table, :pictures) do
      [{:pictures, urls}] -> urls
      [] -> %{}
    end
  end

  @doc "The notices Scripts asked for since the last call, oldest first."
  def take_notices(table) do
    notices =
      for {{:notice, n}, notice} <- :ets.match_object(table, {{:notice, :_}, :_}), do: {n, notice}

    :ets.match_delete(table, {{:notice, :_}, :_})
    notices |> Enum.sort() |> Enum.map(&elem(&1, 1))
  end

  # The command a Run handles, or `nil` for a Delivery sent without one
  defp context(talk, call) do
    case OdgnEcsTalk.delivery(talk, call) do
      %{host: context} -> context
      nil -> nil
    end
  end

  defp handle(nil), do: nil
  defp handle(eid), do: %Object{kind: "entity", id: Integer.to_string(eid), group: @group}

  @doc """
  Sends a notice to the Scripts of the things in a place, but not the one
  it is about (its first argument), such as the actor who arrived.
  """
  def notify(talk, world, place, message, args) do
    about = with [{:entity, eid} | _] <- args, do: eid
    values = Enum.map(args, &value(talk, &1))

    for watcher <- MuaWorld.Commands.Scope.entities_in(world, place),
        watcher != about,
        OdgnEcsTalk.scripted?(talk, watcher),
        do: {:ok, _} = OdgnEcsTalk.deliver(talk, watcher, message, values)

    :ok
  end

  @doc "An argument for a Script: an entity's Handle, or text as it is."
  def value(talk, {:entity, eid}), do: OdgnEcsTalk.handle(talk, eid)
  def value(_talk, text), do: text

  @doc """
  The engine's `:between` hook: sends the notices Scripts asked for since
  the last Pump, and says whether there were any.
  """
  def between(talk, world, table) do
    fn ->
      notices = take_notices(table)
      for {place, message, args} <- notices, do: notify(talk, world, place, message, args)
      notices != []
    end
  end

  @doc "The `mua` Capability, for `OdgnEcsTalk.start/2`'s `:capabilities`."
  def mua(world, table, talk) do
    entity = %{"object" => "entity"}
    optional = %{"optional" => entity}

    Capability.from_functions("mua", %{
      "act" =>
        {[args: [entity, "any"], cost: 1, mode: :fire_and_forget, command: true],
         fn [actor, command], _ ->
           MuaWorld.Tables.queue_act(world, Values.from_value(actor), Values.from_value(command))
           :noreply
         end},
      "announce" =>
        {[args: [entity, "text", optional], cost: 1, mode: :fire_and_forget, command: true],
         fn [place, text, except], _ ->
           except = except && Values.from_value(except)

           for c <- MuaWorld.Tables.characters_at(world, Values.from_value(place)),
               c != except,
               do: MuaWorld.Tables.output(world, c, text)

           :noreply
         end},
      "buildable" =>
        {[args: [], result: %{"list" => "text"}, cost: 1],
         fn [], _ ->
           {:ok, for({name, %{buildable: true}} <- Enum.sort(world.components), do: name)}
         end},
      "command" =>
        {[args: [], result: "any", cost: 1],
         fn [], call ->
           case context(talk, call) do
             nil ->
               {:ok, nil}

             ctx ->
               {:ok,
                NorthTalk.Map.new([
                  {"actor", handle(ctx.actor)},
                  {"direction", ctx[:direction]},
                  {"indirect", handle(ctx[:indirect_id])},
                  {"target", handle(ctx[:target_id])},
                  {"text", ctx[:text]},
                  {"verb", ctx.verb}
                ])}
           end
         end},
      "editors" =>
        {[args: [entity], result: %{"list" => entity}, cost: 1],
         fn [thing], _ ->
           thing = Values.from_value(thing)
           {:ok, Enum.map(OdgnEcs.query(world, where: [{"editing", "thing", thing}]), &handle/1)}
         end},
      "limbo" =>
        {[args: [], result: entity, cost: 1],
         fn [], _ -> {:ok, handle(MuaWorld.Places.limbo(world))} end},
      "homed" =>
        {[args: [entity], result: %{"list" => entity}, cost: 1],
         fn [place], _ ->
           place = Values.from_value(place)
           {:ok, Enum.map(OdgnEcs.query(world, where: [{"home", "in", place}]), &handle/1)}
         end},
      "placed" =>
        {[args: [entity], result: "number", cost: 1],
         fn [account], _ ->
           account = Values.from_value(account)
           {:ok, length(OdgnEcs.query(world, where: [{"made_by", "account", account}]))}
         end},
      # an Account's Signature: the Character that speaks for it wherever
      # it is shown as a Maker, its first while it has one (#276)
      "signature" =>
        {[args: [entity], result: optional, cost: 1],
         fn [account], _ ->
           account = Values.from_value(account)

           case OdgnEcs.query(world, where: [{"player", "account", account}]) do
             [] -> {:ok, nil}
             characters -> {:ok, handle(Enum.min(characters))}
           end
         end},
      "picture" =>
        {[args: [entity, entity], cost: 1, mode: :fire_and_forget, command: true],
         fn [place, actor], _ ->
           place = Values.from_value(place)
           actor = Values.from_value(actor)

           with true <- OdgnEcs.get(world, actor, "player") != nil,
                %{} = line <- MuaWorld.Pictures.line(world, place, pictures(table)),
                do: MuaWorld.Tables.picture(world, actor, line)

           :noreply
         end},
      "notice" =>
        {[
           args: [entity, "text", entity, %{"optional" => "text"}],
           cost: 1,
           mode: :fire_and_forget,
           command: true
         ],
         fn [place, message, who | rest], _ ->
           n = :erlang.unique_integer([:monotonic])
           args = [{:entity, Values.from_value(who)} | Enum.reject(rest, &is_nil/1)]
           :ets.insert(table, {{:notice, n}, {Values.from_value(place), message, args}})
           :noreply
         end},
      "verbs" =>
        {[args: [], result: "any", cost: 1],
         fn [], call ->
           case context(talk, call) do
             %{vocabulary: vocabulary} ->
               {:ok,
                NorthTalk.Map.new([
                  {"aliases", vocabulary.aliases |> Map.keys() |> Enum.sort()},
                  {"names", vocabulary.defs |> Enum.map(&hd(&1.names)) |> Enum.uniq()}
                ])}

             _ ->
               {:ok, nil}
           end
         end}
    })
  end

  # mua's Libraries, by the name Scripts `use` them from, and its Service
  # Scripts: its core actions, which no Message Path reaches.
  @libraries ~w(things messages rooms)

  defp behaviour(path), do: MuaWorld.Scripts.path(Path.join("scripts", path))

  @doc """
  Starts NorthTalk for `world` with mua's Capability, sharing `table` for
  notices, and loads mua's Libraries, Service Scripts and the World's
  Scripts. Returns `{:ok, talk}`, or `{:error, {path, reason}}` naming the
  first Script that failed to load.
  """
  def start(world, table, limits \\ []) do
    {:ok, owner} = NorthTalk.start_link(drive: :manual)

    {:ok, talk} =
      OdgnEcsTalk.start(world,
        owner: owner,
        capabilities: [&OdgnEcsEngine.Timers.capability/1, &mua(world, table, &1)],
        limits: limits,
        on_show: &MuaWorld.Tables.tell(world, &1, &2)
      )

    libraries =
      for name <- @libraries do
        path = behaviour("lib/#{name}.talk")
        {path, fn -> OdgnEcsTalk.add_library(talk, name, File.read!(path), [], ["mua"]) end}
      end

    services =
      for name <- MuaWorld.Dispatch.services() do
        path = behaviour("services/#{name}.talk")
        {path, fn -> OdgnEcsTalk.load_service_script(talk, name, File.read!(path)) end}
      end

    # Each Script loads in turn, and the first that fails stops, naming its file
    loaded =
      Enum.reduce_while(libraries ++ services, :ok, fn {path, load}, :ok ->
        case load.() do
          {:error, reason} -> {:halt, {:error, {path, reason}}}
          _ -> {:cont, :ok}
        end
      end)

    with :ok <- loaded,
         :ok <- OdgnEcsTalk.load_scripts(talk, &File.read!/1) do
      {:ok, talk}
    end
  end
end
