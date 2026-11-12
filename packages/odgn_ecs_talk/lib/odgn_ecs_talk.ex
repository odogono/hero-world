defmodule OdgnEcsTalk do
  @moduledoc """
  A NorthTalk Host Adapter for an `odgn_ecs` World: one Script Group per
  World, entities as Host Objects of the `entity` Object Kind, atoms with
  Scripts on their Message Path, and the `world` and `clock` Capabilities.
  Timers are the engine's (`OdgnEcsEngine.Timers`), which a Host adds
  through `:capabilities`.

  The caller drives it: `pump/2` with a Clock reading, inside its own
  transaction, as Mua's World process does (ADR 0015). Callbacks run in
  NorthTalk's Tasks while the caller is blocked in a Pump, and use the
  World's connection directly.

  - **Handles:** each entity's Host Object, made by `start/2` for every entity
    and by `handle/2` for one made later. Callbacks can't make Objects, so an
    entity made during play needs `handle/2` before a Script can reach it.
    Every component is a read-only property: its data, or Nothing. A
    reference field (an `:eid` column) holds the entity's Handle, or Nothing
    when it has none, so `the in of the location of x is y` compares Handles.
    `world`'s `resolve` still turns a bare id into a Handle. Elements
    are the entities whose Location field holds the entity, in id order,
    named by the naming field.
  - **Message Path:** an unhandled message climbs the scripted atoms of the
    entity's Lineage, linearized (`OdgnEcsTalk.MessagePath`). A Host Object
    has one parent, so an atom that sits on several paths with different
    atoms above it gets a Host Object for each, owning a copy of its Script
    named `atom@path`. Copies don't share Script Variables.
  - **`world`:** `change`, `remove`, `moveTo` and `destroy` are Segment-bound:
    each Segment is a SAVEPOINT, so a Segment that rolls back leaves no trace.
    `destroy` deletes the entity and every component it has, and refuses one
    that another entity's `:restrict` Reference names, such as the Location
    of something inside it. Its Handle stays, so a rollback that brings the
    entity back finds it again; until then it reads as gone. `find`,
    `resolve`, `named` and `show` are not; `show` calls the `:on_show`
    option. `named` finds an entity by its Definition name.
  - **`clock`:** `now`, the Pump's Clock reading.
  - **Deliveries:** `deliver`, `request` and `decide` (and their Service
    forms) take a `:host` option, a term of the Host's own that a Capability
    reads back with `delivery/2` while the Delivery's Runs go on. The adapter
    forgets a Delivery once NorthTalk's `causal work` report shows its work
    has ended: no live Runs and no queued messages.
  """

  alias NorthTalk.{Capability, Object, ObjectKind}
  alias OdgnEcs.{Column, Component}
  alias OdgnEcsTalk.{MessagePath, Values}

  defstruct [
    :owner,
    :group,
    :world,
    :table,
    :entity_kind,
    :atom_kind,
    :grants,
    :limits,
    :location,
    :naming
  ]

  @entity "entity"
  @atom "atom"

  @type t :: %__MODULE__{}

  @doc """
  The components the adapter needs the World to define: `location`, unless
  the `:location` option names another.
  """
  def components do
    [%Component{name: "location", play_state: true, columns: [%Column{name: "in", type: :eid}]}]
  end

  @doc """
  Starts the adapter over `world`, making a Handle for every entity.

  Options:

    * `:owner` - a NorthTalk owner; one in manual drive is started if none.
    * `:name` - the Group's name, `"world"` by default.
    * `:location` - `{component, field}` holding an entity's Location,
      `{"location", "in"}` by default.
    * `:naming` - `{component, path}` naming an Element,
      `{"meta", ["props", "id"]}` by default.
    * `:on_show` - called as `fun.(eid, text)` for `show actor, text`, inside
      the caller's transaction.
    * `:grants` - extra Grants for every Script, by name.
    * `:limits` - limits for every Script.
    * `:capabilities` - functions of the started adapter, each returning a
      `NorthTalk.Capability` that every Script is granted under its name.
      Their callbacks may call `delivery/2` with the adapter.
  """
  @spec start(OdgnEcs.t(), keyword()) :: {:ok, t()}
  def start(%OdgnEcs{} = world, opts \\ []) do
    owner =
      opts[:owner] ||
        elem(NorthTalk.start_link(drive: :manual), 1)

    talk = %__MODULE__{
      owner: owner,
      world: world,
      table: :ets.new(:odgn_ecs_talk, [:set, :public]),
      location: Keyword.get(opts, :location, {"location", "in"}),
      naming: Keyword.get(opts, :naming, {"meta", ["props", "id"]}),
      limits: Keyword.get(opts, :limits, [])
    }

    group = NorthTalk.new_group!(owner, Keyword.get(opts, :name, "world"), [])

    talk = %{
      talk
      | group: group,
        entity_kind: entity_kind(talk, group),
        atom_kind: ObjectKind.new(@atom)
    }

    :ok = NorthTalk.define_object_kind!(owner, talk.atom_kind)
    :ok = NorthTalk.define_object_kind!(owner, talk.entity_kind)

    :ok =
      NorthTalk.define_capability!(
        owner,
        world_capability(talk, Keyword.get(opts, :on_show, fn _, _ -> :ok end))
      )

    :ok = NorthTalk.define_capability!(owner, clock_capability())

    hosts =
      for build <- Keyword.get(opts, :capabilities, []), into: %{} do
        %Capability{name: name} = capability = build.(talk)
        :ok = NorthTalk.define_capability!(owner, capability)
        {name, NorthTalk.grant!(owner, name)}
      end

    grants =
      %{
        "world" => NorthTalk.grant!(owner, "world"),
        "clock" => NorthTalk.grant!(owner, "clock")
      }
      |> Map.merge(hosts)
      |> Map.merge(Keyword.get(opts, :grants, %{}))

    talk = %{talk | grants: grants}
    for eid <- OdgnEcs.query(world), do: handle(talk, eid)
    {:ok, talk}
  end

  # -- Handles ----------------------------------------------------------------

  @doc "The Handle of an entity, made the first time it is asked for."
  @spec handle(t(), OdgnEcs.eid()) :: Object.t()
  def handle(%__MODULE__{} = talk, eid) do
    case :ets.lookup(talk.table, {:handle, eid}) do
      [{_, obj}] ->
        obj

      [] ->
        parent = object_for(talk, scripted_path(talk, OdgnEdl.entity_lineage(talk.world, eid)))

        obj =
          NorthTalk.object!(talk.group, talk.entity_kind, Integer.to_string(eid), eid,
            parent: parent
          )

        :ets.insert(talk.table, {{:handle, eid}, obj})
        obj
    end
  end

  # A callback's Handle: only one already made, since callbacks can't make Objects
  defp existing_handle(talk, eid) do
    case :ets.lookup(talk.table, {:handle, eid}) do
      [{_, obj}] -> if OdgnEcs.exists?(talk.world, eid), do: obj
      [] -> nil
    end
  end

  @doc "Disposes of the Handle of an entity that has been deleted."
  def drop_handle(%__MODULE__{} = talk, eid) do
    case :ets.lookup(talk.table, {:handle, eid}) do
      [{key, obj}] ->
        :ets.delete(talk.table, key)
        NorthTalk.dispose(talk.group, obj)

      [] ->
        :ok
    end
  end

  # -- Scripts ----------------------------------------------------------------

  @doc """
  Loads a Script owned by an atom; entities built from it climb to it.
  Options: `:grants` and `:limits`, beside the adapter's.
  """
  @spec load_atom_script(t(), String.t(), String.t(), keyword()) :: :ok | {:error, term()}
  def load_atom_script(%__MODULE__{} = talk, atom, source, opts \\ []) do
    cond do
      OdgnEdl.atom_lineage(talk.world, atom) == nil ->
        {:error, "No such atom: #{atom}"}

      atom_object(talk, atom) ->
        {:error, "Atom #{atom} already has a Script"}

      true ->
        obj = NorthTalk.object!(talk.group, talk.atom_kind, atom, atom)
        :ets.insert(talk.table, {{:atom, atom}, obj})

        case load_owned(talk, atom, obj, source, opts) do
          :ok ->
            :ets.insert(talk.table, {{:source, atom}, {source, opts}})
            relink(talk)

          error ->
            :ets.delete(talk.table, {:atom, atom})
            NorthTalk.dispose(talk.group, obj)
            error
        end
    end
  end

  @doc "Loads a Script owned by an entity's Handle."
  def load_entity_script(%__MODULE__{} = talk, eid, source, opts \\ []) do
    with :ok <- load_owned(talk, "entity:#{eid}", handle(talk, eid), source, opts) do
      :ets.insert(talk.table, {{:entity_script, eid}, true})
      :ok
    end
  end

  @doc """
  Loads a Service Script, or replaces its code if it is loaded already,
  keeping its Host Object. A `NorthTalk.LoadError` leaves the Script as it
  was.
  """
  def put_service_script(%__MODULE__{} = talk, service, source, opts \\ []) do
    if :ets.member(talk.table, {:service, service}) do
      case NorthTalk.reload(talk.group, "service:" <> service, source, variables: :reset) do
        {:ok, reports} -> forget_ended(talk, reports)
        {:error, _} = error -> error
      end
    else
      load_service_script(talk, service, source, opts)
    end
  end

  @doc """
  Loads a Service Script: one owned by a Host Object of its own, so no
  entity's Message Path reaches it. Send to it with `request_service/4` and
  `decide_service/4`.
  """
  def load_service_script(%__MODULE__{} = talk, service, source, opts \\ []) do
    if :ets.member(talk.table, {:service, service}) do
      {:error, "Service #{service} already has a Script"}
    else
      # A Script that fails to load keeps its Object for the next try: an
      # Object's id can't be reused, even once it is disposed
      id = "service:" <> service

      obj =
        case NorthTalk.object_by_id(talk.group, talk.atom_kind.name, id) do
          {:ok, obj} -> obj
          :error -> NorthTalk.object!(talk.group, talk.atom_kind, id, service)
        end

      with :ok <- load_owned(talk, id, obj, source, opts) do
        :ets.insert(talk.table, {{:service, service}, obj})
        :ok
      end
    end
  end

  @doc """
  Loads the Script of every atom and entity whose EDL declares one, reading
  each source with `read`, a function of its path. Stops at the first that
  fails, as `{:error, {path, reason}}`.
  """
  def load_scripts(%__MODULE__{} = talk, read, opts \\ []) do
    Enum.reduce_while(OdgnEdl.script_owners(talk.world), :ok, fn owner, :ok ->
      result =
        case owner do
          %{kind: :atom, name: name, src: src} -> load_atom_script(talk, name, read.(src), opts)
          %{kind: :entity, eid: eid, src: src} -> load_entity_script(talk, eid, read.(src), opts)
        end

      case result do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, {owner.src, reason}}}
      end
    end)
  end

  @doc """
  Compiles a Library and adds it to the Group, for Scripts loaded after it.
  Its functions may call every Capability Scripts are granted, with their
  caller's Grants, and the defined Capabilities named in `capabilities`,
  which Scripts must be granted under those names.
  """
  def add_library(%__MODULE__{} = talk, name, source, imports \\ [], capabilities \\ []) do
    with {:ok, library} <-
           NorthTalk.compile_library(talk.owner, name, "1", source,
             imports: imports,
             capabilities: Enum.uniq(Map.keys(talk.grants) ++ capabilities)
           ),
         :ok <- NorthTalk.add_library(talk.group, library) do
      {:ok, library}
    end
  end

  @doc """
  Whether a Script sits on an entity's Message Path, or the entity owns one,
  so that sending it a message can be answered.
  """
  @spec scripted?(t(), OdgnEcs.eid()) :: boolean()
  def scripted?(%__MODULE__{} = talk, eid) do
    :ets.member(talk.table, {:entity_script, eid}) or
      scripted_path(talk, OdgnEdl.entity_lineage(talk.world, eid)) != []
  end

  defp load_owned(talk, name, obj, source, opts) do
    grants = Map.merge(talk.grants, Keyword.get(opts, :grants, %{}))
    limits = Keyword.merge(talk.limits, Keyword.get(opts, :limits, []))

    case NorthTalk.load(talk.group, name, source, owner: obj, grants: grants, limits: limits) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  # -- Message Path -----------------------------------------------------------

  defp atom_object(talk, atom) do
    case :ets.lookup(talk.table, {:atom, atom}) do
      [{_, obj}] -> obj
      [] -> nil
    end
  end

  defp scripted_path(talk, bases) do
    bases
    |> MessagePath.linearize(&OdgnEdl.atom_lineage(talk.world, &1))
    |> Enum.filter(&atom_object(talk, &1))
  end

  defp atom_path(talk, atom),
    do: scripted_path(talk, OdgnEdl.atom_lineage(talk.world, atom) || [])

  # The Host Object at the head of a path of scripted atoms. The atom's own
  # Object serves the path above the atom itself; any other position gets an
  # Object of its own, owning a copy of the atom's Script.
  defp object_for(_talk, []), do: nil

  defp object_for(talk, [atom | rest] = path) do
    if rest == atom_path(talk, atom) do
      atom_object(talk, atom)
    else
      key = Enum.join(path, " ")

      case :ets.lookup(talk.table, {:position, key}) do
        [{_, obj}] ->
          obj

        [] ->
          [{_, {source, opts}}] = :ets.lookup(talk.table, {:source, atom})

          obj =
            NorthTalk.object!(talk.group, talk.atom_kind, "#{atom} (#{key})", atom,
              parent: object_for(talk, rest)
            )

          script = "#{atom}@#{key}"
          :ok = load_owned(talk, script, obj, source, opts)
          :ets.insert(talk.table, [{{:position, key}, obj}, {{:copy, script}, atom}])
          obj
      end
    end
  end

  # Every path, after the set of scripted atoms changes
  defp relink(talk) do
    for {{:atom, atom}, obj} <- :ets.match_object(talk.table, {{:atom, :_}, :_}),
        do: NorthTalk.set_parent(talk.group, obj, object_for(talk, atom_path(talk, atom)))

    for {{:position, key}, obj} <- :ets.match_object(talk.table, {{:position, :_}, :_}),
        do:
          NorthTalk.set_parent(
            talk.group,
            obj,
            object_for(talk, key |> String.split(" ") |> tl())
          )

    for {{:handle, eid}, obj} <- :ets.match_object(talk.table, {{:handle, :_}, :_}) do
      parent = object_for(talk, scripted_path(talk, OdgnEdl.entity_lineage(talk.world, eid)))
      NorthTalk.set_parent(talk.group, obj, parent)
    end

    :ok
  end

  # -- Sending ----------------------------------------------------------------

  @doc """
  Delivers a message to an entity. Returns its delivery id. Options:
  `:host`, a term `delivery/2` gives the Delivery's Capability calls.
  """
  def deliver(%__MODULE__{} = talk, eid, message, args \\ [], opts \\ []) do
    with {:ok, id} <- NorthTalk.deliver(talk.group, handle(talk, eid), message, args) do
      note(talk, id, entry(eid, opts))
      {:ok, id}
    end
  end

  @doc """
  Sends a Request to an entity and Pumps once at `now`. Returns the
  `NorthTalk.Pending`, for `NorthTalk.await/2`. Takes `deliver/5`'s options.
  """
  def request(%__MODULE__{} = talk, eid, message, args, now, opts \\ []),
    do: send_request(talk, handle(talk, eid), entry(eid, opts), message, args, now)

  @doc """
  Asks an entity's Message Path by a Decision. Returns its `NorthTalk.Pending`.
  Takes `deliver/5`'s options.
  """
  def decide(%__MODULE__{} = talk, eid, message, args \\ [], opts \\ []) do
    with {:ok, pending} <- NorthTalk.decide(talk.group, handle(talk, eid), message, args) do
      note(talk, pending.delivery, entry(eid, opts))
      {:ok, pending}
    end
  end

  @doc "A Request to a Service Script, Pumped once at `now`. Takes `deliver/5`'s options."
  def request_service(%__MODULE__{} = talk, service, message, args, now, opts \\ []),
    do: send_request(talk, service_object!(talk, service), entry(nil, opts), message, args, now)

  @doc "A Decision asked of a Service Script. Takes `deliver/5`'s options."
  def decide_service(%__MODULE__{} = talk, service, message, args \\ [], opts \\ []) do
    with {:ok, pending} <-
           NorthTalk.decide(talk.group, service_object!(talk, service), message, args) do
      note(talk, pending.delivery, entry(nil, opts))
      {:ok, pending}
    end
  end

  defp service_object!(talk, service) do
    case :ets.lookup(talk.table, {:service, service}) do
      [{_, obj}] -> obj
      [] -> raise ArgumentError, "No Service Script named #{service}"
    end
  end

  @doc "Pumps the Group once, with the Clock at `now` (a `DateTime`)."
  def pump(%__MODULE__{} = talk, now) do
    with {:ok, %{reports: reports}} = result <- NorthTalk.pump(talk.group, now: now) do
      forget_ended(talk, reports)
      result
    end
  end

  @doc """
  Pumps the Group with the Clock at `now` until it is idle: no Run is
  sliced, and `:between`, called after each Pump, gave no more work.
  `:between` is a function of no arguments returning whether it sent more,
  such as notices a Capability queued. Returns when NorthTalk next needs
  pumping, as a `DateTime`, or `nil`.
  """
  @spec pump_until_idle(t(), DateTime.t(), keyword()) :: {:ok, DateTime.t() | nil}
  def pump_until_idle(%__MODULE__{} = talk, now, opts \\ []) do
    between = Keyword.get(opts, :between, fn -> false end)
    {:ok, pump} = pump(talk, now)
    more? = between.()

    if pump.state == "sliced" or more?,
      do: pump_until_idle(talk, now, opts),
      else: {:ok, deadline(pump.next_deadline)}
  end

  defp deadline(nil), do: nil

  defp deadline(text) do
    {:ok, dt, _} = DateTime.from_iso8601(text)
    dt
  end

  @typedoc """
  How a Request or Decision stands: its Handler `replied` with a value,
  `passed` (no Handler, or a Decision allowed), was `vetoed` with a reason,
  `failed` with an error, or is still `waiting`.
  """
  @type outcome ::
          {:replied, term()}
          | :passed
          | {:vetoed, term()}
          | {:failed, term()}
          | :waiting

  @doc """
  The outcome of a Request or Decision as the Group stands now, without
  Pumping. Once it is anything but `:waiting`, the adapter is done with it,
  and asking again is an error.
  """
  @spec outcome(term()) :: outcome()
  def outcome(%NorthTalk.Pending{} = pending) do
    case NorthTalk.await(pending, 0) do
      {:error, %NorthTalk.HostError{code: "timeout"}} ->
        :waiting

      result ->
        NorthTalk.release_pending(pending)
        normalise(result)
    end
  end

  defp normalise({:ok, %NorthTalk.Result{value: value}}), do: {:replied, value}
  defp normalise({:ok, %NorthTalk.Verdict{verdict: :allowed}}), do: :passed

  defp normalise({:ok, %NorthTalk.Verdict{verdict: :vetoed, vetoes: [veto | _]}}),
    do: {:vetoed, veto.reason}

  defp normalise({:ok, %NorthTalk.Verdict{verdict: :vetoed}}), do: {:vetoed, nil}
  defp normalise({:error, %NorthTalk.ScriptError{outcome: "unhandled"}}), do: :passed
  defp normalise({:error, error}), do: {:failed, error}
  defp normalise(other), do: {:failed, other}

  @doc """
  Gives up on a Request or Decision still waiting, so the adapter holds
  nothing for it. Its Run carries on unless its Script is replaced.
  """
  def abandon(%NorthTalk.Pending{} = pending) do
    NorthTalk.release_pending(pending)
    :ok
  end

  @doc """
  The Delivery whose work a Capability `call` is part of, as
  `%{receiver: eid, host: term}`, or `nil` for one the adapter didn't send
  or has forgotten. `receiver` is `nil` for a Service Script, and `host` is
  the `:host` option it was sent with, or `nil`.
  """
  @spec delivery(t(), NorthTalk.Call.t()) :: %{receiver: OdgnEcs.eid() | nil, host: term()} | nil
  def delivery(%__MODULE__{} = talk, %NorthTalk.Call{delivery: id}) when is_binary(id) do
    case :ets.lookup(talk.table, {:delivery, id}) do
      [{_, entry}] -> entry
      [] -> nil
    end
  end

  def delivery(%__MODULE__{}, _call), do: nil

  defp entry(eid, opts), do: %{receiver: eid, host: opts[:host]}

  defp note(talk, id, entry), do: :ets.insert(talk.table, {{:delivery, id}, entry})

  # The Request is noted before its first Pump, so its Run can find it
  defp send_request(talk, obj, entry, message, args, now) do
    with {:ok, pending} <- NorthTalk.send_request(talk.group, obj, message, args) do
      note(talk, pending.delivery, entry)
      _ = pump(talk, now)
      {:ok, pending}
    end
  end

  # A Delivery is done with once its causal work has ended
  defp forget_ended(talk, reports) do
    for %{"kind" => "causal work", "rootDelivery" => id} = report <- reports,
        Map.get(report, "liveRuns", 0) == 0 and Map.get(report, "queuedMessages", 0) == 0,
        do: :ets.delete(talk.table, {:delivery, id})

    :ok
  end

  @doc """
  The name a Script's timers and the like are scoped by: the Script's own,
  or, for a copy of an atom's Script (`atom@path`), the atom's.
  """
  def script_name(%__MODULE__{} = talk, script) do
    case :ets.lookup(talk.table, {:copy, script}) do
      [{_, atom}] -> atom
      [] -> script
    end
  end

  # -- Capabilities -----------------------------------------------------------

  defp clock_capability do
    Capability.from_functions("clock", %{
      "now" => {[result: "any", cost: 1], fn [], call -> {:ok, call_now(call)} end}
    })
  end

  defp call_now(%{now: now}) when is_binary(now),
    do:
      NorthTalk.Value.decode(
        Jason.decode!(Jason.encode!(%{"$instant" => now}), objects: :ordered_objects)
      )

  defp call_now(%{now: now}), do: now

  defp world_capability(talk, on_show) do
    world = talk.world
    entity = %{"object" => @entity}
    {location, field} = talk.location

    Capability.from_functions(
      "world",
      %{
        "change" =>
          {[args: [entity, "text", "any"], cost: 1, segment_bound: true, command: true],
           fn [thing, name, value], _ ->
             with {:ok, eid} <- live(world, thing),
                  :ok <- put(world, eid, name, Values.from_value(value)),
                  do: {:ok, nil}
           end},
        "remove" =>
          {[args: [entity, "text"], cost: 1, segment_bound: true, command: true],
           fn [thing, name], _ ->
             with {:ok, eid} <- live(world, thing),
                  :ok <- remove(world, eid, name),
                  do: {:ok, nil}
           end},
        "destroy" =>
          {[args: [entity], cost: 1, segment_bound: true, command: true],
           fn [thing], _ ->
             with {:ok, eid} <- live(world, thing),
                  :ok <- delete(world, eid),
                  do: {:ok, nil}
           end},
        "moveTo" =>
          {[args: [entity, entity], cost: 1, segment_bound: true, command: true],
           fn [thing, place], _ ->
             with {:ok, eid} <- live(world, thing),
                  {:ok, place} <- live(world, place),
                  :ok <- put(world, eid, location, %{field => place}),
                  do: {:ok, nil}
           end},
        "find" =>
          {[args: [entity, "text"], result: %{"list" => entity}, cost: 1],
           fn [place, name], _ ->
             if OdgnEcs.component(world, name) do
               found =
                 for eid <- element_ids(talk, Values.from_value(place)),
                     OdgnEcs.get(world, eid, name) != nil,
                     h = existing_handle(talk, eid),
                     do: h

               {:ok, found}
             else
               {:error, %{code: "invalid value", message: "Unknown component #{name}"}}
             end
           end},
        "resolve" =>
          {[args: ["number"], result: %{"optional" => entity}, cost: 1],
           fn [id], _ ->
             case Values.from_value(id) do
               eid when is_integer(eid) -> {:ok, existing_handle(talk, eid)}
               _ -> {:ok, nil}
             end
           end},
        "named" =>
          {[args: ["text"], result: %{"optional" => entity}, cost: 1],
           fn [name], _ ->
             case OdgnEdl.entity_named(world, name) do
               nil -> {:ok, nil}
               eid -> {:ok, existing_handle(talk, eid)}
             end
           end},
        "show" =>
          {[args: [entity, "text"], cost: 1, mode: :fire_and_forget, command: true],
           fn [actor, text], _ ->
             on_show.(Values.from_value(actor), text)
             :noreply
           end}
      },
      effect: fn phase, effect -> segment(world, phase, effect.segment) end
    )
  end

  # Each Segment is a SAVEPOINT inside the caller's transaction (ADR 0015)
  defp segment(world, phase, segment) do
    name = "talk_" <> String.replace(to_string(segment), ~r/[^A-Za-z0-9_]/, "_")

    result =
      case phase do
        :begin -> OdgnEcs.savepoint(world, name)
        :commit -> OdgnEcs.release(world, name)
        :rollback -> OdgnEcs.rollback_to(world, name)
      end

    if result == :ok, do: {:ok, :ok}, else: {:ok, {:failed, inspect(result)}}
  end

  defp live(world, %Object{kind: @entity} = obj) do
    eid = Values.from_value(obj)

    if OdgnEcs.exists?(world, eid),
      do: {:ok, eid},
      else: {:error, %{code: "object gone", message: "Entity #{eid} is gone"}}
  end

  defp put(world, eid, name, data) do
    case OdgnEcs.put(world, eid, name, data) do
      :ok -> :ok
      {:error, error} -> {:error, %{code: "invalid value", message: error.message}}
    end
  end

  defp remove(world, eid, name) do
    case OdgnEcs.remove(world, eid, name) do
      :ok -> :ok
      {:error, error} -> {:error, %{code: "invalid value", message: error.message}}
    end
  end

  defp delete(world, eid) do
    case OdgnEcs.delete(world, eid) do
      :ok -> :ok
      {:error, error} -> {:error, %{code: "invalid value", message: error.message}}
    end
  end

  # -- The entity Object Kind -------------------------------------------------

  defp entity_kind(talk, _group) do
    world = talk.world

    props =
      for {name, component} <- world.components, into: %{} do
        {name,
         [
           get_cost: 1,
           get: fn eid ->
             case OdgnEcs.exists?(world, eid) && OdgnEcs.get(world, eid, name) do
               data when is_map(data) ->
                 {:ok, Values.component(component, data, &existing_handle(talk, &1))}

               _ ->
                 {:ok, nil}
             end
           end
         ]}
      end

    ObjectKind.new(@entity,
      props: props,
      parent_kinds: [@atom],
      elements: [
        shape: %{"object" => @entity},
        count_cost: 2,
        at_cost: 2,
        find_cost: 2,
        count: fn eid -> {:ok, length(element_ids(talk, eid))} end,
        at: fn eid, i ->
          ids = element_ids(talk, eid)
          member = if i > 0, do: Enum.at(ids, i - 1), else: Enum.at(ids, i)
          {:ok, member && existing_handle(talk, member)}
        end,
        find: fn eid, name ->
          member = Enum.find(element_ids(talk, eid), &(element_name(talk, &1) == name))
          {:ok, member && existing_handle(talk, member)}
        end
      ]
    )
  end

  @doc "The entities whose Location is `eid`, in id order."
  def element_ids(%__MODULE__{world: world, location: location}, eid),
    do: elements(world, eid, location: location)

  @doc """
  The Elements of `place`: the entities whose Location it is, in id order.
  The one place a World is asked what is in a place, through the indexed
  Location Reference.

    * `:select` - component names to read with each one, giving
      `[{eid, %{name => data}}]` as `OdgnEcs.select/3` does.
    * `:with` and `:where` - narrow them, as in `OdgnEcs.query/2`.
    * `:location` - the `{component, property}` that holds a Location,
      `{"location", "in"}` by default.
  """
  def elements(%OdgnEcs{} = world, place, opts \\ []) do
    {location, field} = Keyword.get(opts, :location, {"location", "in"})

    query = [
      with: Keyword.get(opts, :with, []),
      where: [{location, field, place} | Keyword.get(opts, :where, [])]
    ]

    case {OdgnEcs.component(world, location), opts[:select]} do
      {nil, _} -> []
      {_, nil} -> OdgnEcs.query(world, query)
      {_, names} -> OdgnEcs.select(world, names, query)
    end
  end

  @doc "An Element's name, from the naming field, or `nil`."
  def element_name(%__MODULE__{world: world, naming: {component, path}}, eid) do
    case OdgnEcs.component(world, component) && OdgnEcs.get(world, eid, component) do
      data when is_map(data) -> get_in(data, path)
      _ -> nil
    end
  end
end
