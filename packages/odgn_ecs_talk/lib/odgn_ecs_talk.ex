defmodule OdgnEcsTalk do
  @moduledoc """
  A NorthTalk Host Adapter for an `odgn_ecs` World: one Script Group per
  World, entities as Host Objects of the `entity` Object Kind, atoms with
  Scripts on their Message Path, and the `world`, `clock` and `timer`
  Capabilities.

  The caller drives it: `pump/2` with a Clock reading, inside its own
  transaction, as Mua's World process does (ADR 0015). Callbacks run in
  NorthTalk's Tasks while the caller is blocked in a Pump, and use the
  World's connection directly.

  - **Handles:** each entity's Host Object, made by `start/2` for every entity
    and by `handle/2` for one made later. Callbacks can't make Objects, so an
    entity made during play needs `handle/2` before a Script can reach it.
    Every component is a read-only property: its data, or Nothing. Elements
    are the entities whose Location field holds the entity, in id order,
    named by the naming field.
  - **Message Path:** an unhandled message climbs the scripted atoms of the
    entity's Lineage, linearized (`OdgnEcsTalk.MessagePath`). A Host Object
    has one parent, so an atom that sits on several paths with different
    atoms above it gets a Host Object for each, owning a copy of its Script
    named `atom@path`. Copies don't share Script Variables.
  - **`world`:** `change` and `moveTo` are Segment-bound: each Segment is a
    SAVEPOINT, so a Segment that rolls back leaves no trace. `find`,
    `resolve` and `show` are not; `show` calls the `:on_show` option.
  - **`clock`:** `now`, the Pump's Clock reading.
  - **`timer`:** `schedule name, at, message, args` and `cancel name` keep
    durable timers in the World, owned by the entity the Run was delivered
    to, scoped to it and the Script (an atom's name, for a copy).
    `due_timers/2` and `fire_timer/2` deliver them.
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
  @timer "talk_timer"

  @type t :: %__MODULE__{}

  @doc """
  The components the adapter needs the World to define: `location` (unless
  the `:location` option names another) and `talk_timer`.
  """
  def components do
    [
      %Component{name: "location", play_state: true, columns: [%Column{name: "in", type: :eid}]},
      %Component{
        name: @timer,
        play_state: true,
        columns: [
          %Column{name: "owner", type: :eid, optional: false},
          %Column{name: "script", type: :string, optional: false},
          %Column{name: "name", type: :string, optional: false},
          %Column{name: "at", type: :int, optional: false},
          %Column{name: "message", type: :string, optional: false},
          %Column{name: "args", type: :string, optional: false}
        ]
      }
    ]
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
    :ok = NorthTalk.define_capability!(owner, timer_capability(talk))

    grants =
      Map.merge(
        %{
          "world" => NorthTalk.grant!(owner, "world"),
          "clock" => NorthTalk.grant!(owner, "clock"),
          "timer" => NorthTalk.grant!(owner, "timer")
        },
        Keyword.get(opts, :grants, %{})
      )

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
  Loads a Service Script: one owned by a Host Object of its own, so no
  entity's Message Path reaches it. Send to it with `request_service/4` and
  `decide_service/4`.
  """
  def load_service_script(%__MODULE__{} = talk, service, source, opts \\ []) do
    if :ets.member(talk.table, {:service, service}) do
      {:error, "Service #{service} already has a Script"}
    else
      obj = NorthTalk.object!(talk.group, talk.atom_kind, "service:" <> service, service)

      case load_owned(talk, "service:" <> service, obj, source, opts) do
        :ok ->
          :ets.insert(talk.table, {{:service, service}, obj})
          :ok

        error ->
          NorthTalk.dispose(talk.group, obj)
          error
      end
    end
  end

  @doc """
  Loads the Script of every atom and entity whose EDL declares one, reading
  each source with `read`, a function of its path.
  """
  def load_scripts(%__MODULE__{} = talk, read, opts \\ []) do
    Enum.reduce_while(OdgnEdl.script_owners(talk.world), :ok, fn owner, :ok ->
      result =
        case owner do
          %{kind: :atom, name: name, src: src} -> load_atom_script(talk, name, read.(src), opts)
          %{kind: :entity, eid: eid, src: src} -> load_entity_script(talk, eid, read.(src), opts)
        end

      if result == :ok, do: {:cont, :ok}, else: {:halt, result}
    end)
  end

  @doc """
  Compiles a Library and adds it to the Group, for Scripts loaded after it.
  Its functions may call `world`, `clock` and `timer` with their caller's
  Grants, and the defined Capabilities named in `capabilities`, which
  Scripts must be granted under those names.
  """
  def add_library(%__MODULE__{} = talk, name, source, imports \\ [], capabilities \\ []) do
    with {:ok, library} <-
           NorthTalk.compile_library(talk.owner, name, "1", source,
             imports: imports,
             capabilities: ["world", "clock", "timer" | capabilities]
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

  @doc "Delivers a message to an entity. Returns its delivery id."
  def deliver(%__MODULE__{} = talk, eid, message, args \\ []) do
    with {:ok, id} <- NorthTalk.deliver(talk.group, handle(talk, eid), message, args) do
      note(talk, id, eid)
      {:ok, id}
    end
  end

  @doc """
  Sends a Request to an entity and Pumps once at `now`. Returns the
  `NorthTalk.Pending`, for `NorthTalk.await/2`.
  """
  def request(%__MODULE__{} = talk, eid, message, args, now) do
    # `request_pump` runs the Run before it returns the delivery id, so the
    # receiver being admitted stands in for an id not yet noted
    obj = handle(talk, eid)
    :ets.insert(talk.table, {:admitting, eid})

    try do
      with {:ok, %NorthTalk.Pumped{pending: pending}} <-
             NorthTalk.request_pump(talk.group, obj, message, args, now: now) do
        note(talk, pending.id, eid)
        {:ok, pending}
      end
    after
      :ets.delete(talk.table, :admitting)
    end
  end

  @doc "Asks an entity's Message Path by a Decision. Returns its `NorthTalk.Pending`."
  def decide(%__MODULE__{} = talk, eid, message, args \\ []) do
    with {:ok, pending} <- NorthTalk.decide(talk.group, handle(talk, eid), message, args) do
      note(talk, pending.id, eid)
      {:ok, pending}
    end
  end

  @doc "A Request to a Service Script, Pumped once at `now`."
  def request_service(%__MODULE__{} = talk, service, message, args, now) do
    with {:ok, %NorthTalk.Pumped{pending: pending}} <-
           NorthTalk.request_pump(talk.group, service_object!(talk, service), message, args,
             now: now
           ),
         do: {:ok, pending}
  end

  @doc "A Decision asked of a Service Script."
  def decide_service(%__MODULE__{} = talk, service, message, args \\ []),
    do: NorthTalk.decide(talk.group, service_object!(talk, service), message, args)

  defp service_object!(talk, service) do
    case :ets.lookup(talk.table, {:service, service}) do
      [{_, obj}] -> obj
      [] -> raise ArgumentError, "No Service Script named #{service}"
    end
  end

  @doc "Pumps the Group once, with the Clock at `now` (a `DateTime`)."
  def pump(%__MODULE__{} = talk, now), do: NorthTalk.pump(talk.group, now: now)

  # A timer a Run sets belongs to the entity its delivery went to
  defp note(talk, id, eid), do: :ets.insert(talk.table, {{:delivery, id}, eid})

  # -- Timers -----------------------------------------------------------------

  @doc "The timers due at or before `now_us` (microseconds), earliest first."
  def due_timers(%__MODULE__{world: world}, now_us) do
    world
    |> OdgnEcs.query(with: [@timer])
    |> Enum.map(&Map.put(OdgnEcs.get(world, &1, @timer), "eid", &1))
    |> Enum.filter(&(&1["at"] <= now_us))
    |> Enum.sort_by(&{&1["at"], &1["eid"]})
  end

  @doc "Removes a due timer and delivers its message to its entity, if that still exists."
  def fire_timer(%__MODULE__{world: world} = talk, %{"eid" => eid, "owner" => owner} = timer) do
    :ok = OdgnEcs.delete(world, eid)

    if OdgnEcs.exists?(world, owner),
      do: deliver(talk, owner, timer["message"], Values.decode(timer["args"])),
      else: :ok
  end

  defp find_timer(world, owner, script, name) do
    OdgnEcs.query(world,
      where: [{@timer, "owner", owner}, {@timer, "script", script}, {@timer, "name", name}]
    )
  end

  defp timer_owner(talk, call) do
    case call.delivery && :ets.lookup(talk.table, {:delivery, call.delivery}) do
      [{_, eid}] ->
        {:ok, eid}

      [] ->
        case :ets.lookup(talk.table, :admitting) do
          [{_, eid}] -> {:ok, eid}
          [] -> no_timer_owner()
        end

      _ ->
        no_timer_owner()
    end
  end

  defp no_timer_owner,
    do: {:error, %{code: "invalid value", message: "A timer needs a Run delivered to an entity"}}

  defp timer_script(talk, script) do
    case :ets.lookup(talk.table, {:copy, script}) do
      [{_, atom}] -> atom
      [] -> script
    end
  end

  defp timer_capability(talk) do
    world = talk.world

    Capability.from_functions("timer", %{
      "schedule" =>
        {[args: ["text", "any", "text", "any"], cost: 1, mode: :fire_and_forget],
         fn [name, at, message, args], call ->
           with {:ok, owner} <- timer_owner(talk, call),
                {:ok, at_us} <- instant_us(at) do
             script = timer_script(talk, call.script)
             for eid <- find_timer(world, owner, script, name), do: OdgnEcs.delete(world, eid)
             {:ok, eid} = OdgnEcs.create(world)

             :ok =
               OdgnEcs.put(world, eid, @timer, %{
                 "owner" => owner,
                 "script" => script,
                 "name" => name,
                 "at" => at_us,
                 "message" => message,
                 "args" => Values.encode(args || [])
               })

             :noreply
           end
         end},
      "cancel" =>
        {[args: ["text"], cost: 1, mode: :fire_and_forget],
         fn [name], call ->
           with {:ok, owner} <- timer_owner(talk, call) do
             for eid <- find_timer(world, owner, timer_script(talk, call.script), name),
                 do: OdgnEcs.delete(world, eid)

             {:ok, nil}
           end
         end}
    })
  end

  defp instant_us(%NorthTalk.Instant{unix_us: us}), do: {:ok, us}
  defp instant_us(%DateTime{} = dt), do: {:ok, DateTime.to_unix(dt, :microsecond)}

  defp instant_us(other),
    do: {:error, %{code: "invalid value", message: "#{inspect(other)} is not an Instant"}}

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
               data when is_map(data) -> {:ok, Values.component(component, data)}
               _ -> {:ok, nil}
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
  def element_ids(%__MODULE__{world: world, location: {location, field}}, eid) do
    if OdgnEcs.component(world, location),
      do: OdgnEcs.query(world, where: [{location, field, eid}]),
      else: []
  end

  @doc "An Element's name, from the naming field, or `nil`."
  def element_name(%__MODULE__{world: world, naming: {component, path}}, eid) do
    case OdgnEcs.component(world, component) && OdgnEcs.get(world, eid, component) do
      data when is_map(data) -> get_in(data, path)
      _ -> nil
    end
  end
end
