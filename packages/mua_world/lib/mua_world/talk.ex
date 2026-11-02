defmodule MuaWorld.Talk do
  @moduledoc """
  What the World offers its Scripts: the Object Kinds of Handles and atoms,
  and the `world`, `clock` and `timer` Capabilities.

  Every callback runs in a Task while the World process is blocked in
  `pump`, and uses the World's connection directly (ADR 0015). Writes go only
  through Segment-bound Operations, inside the Segment's `SAVEPOINT`; a
  Handle's properties are read-only.
  """
  alias MuaWorld.Store
  alias NorthTalk.{Capability, Object, ObjectKind}

  @group "world"

  def group_name, do: @group

  @doc "The Handle of an entity, as a value: every entity has one in the Group."
  def handle(eid), do: %Object{kind: "entity", id: Integer.to_string(eid), group: @group}

  def atom_object(name), do: %Object{kind: "atom", id: name, group: @group}

  @doc "The entity a Handle stands for, or nil for anything else."
  def eid(%Object{kind: "entity", id: id}), do: String.to_integer(id)
  def eid(_), do: nil

  def atom_kind, do: ObjectKind.new("atom")

  # A Handle's native is {conn, eid}.
  def entity_kind do
    ObjectKind.new("entity",
      props: %{
        "name" => [shape: "text", get: fn {conn, eid} -> {:ok, Store.entity(conn, eid).name} end],
        "description" => [
          shape: %{"optional" => "text"},
          get: fn {conn, eid} -> {:ok, Store.component(conn, eid, "description")} end
        ],
        "location" => [
          shape: %{"optional" => %{"object" => "entity"}},
          get: fn {conn, eid} ->
            {:ok, with(l when l != nil <- Store.entity(conn, eid).location, do: handle(l))}
          end
        ]
      },
      elements: [
        shape: %{"object" => "entity"},
        count: fn {conn, eid} -> {:ok, length(Store.elements(conn, eid))} end,
        at: fn {conn, eid}, i ->
          members = Store.elements(conn, eid)
          member = if i > 0, do: Enum.at(members, i - 1), else: Enum.at(members, i)
          {:ok, member && handle(member)}
        end,
        find: fn {conn, eid}, name ->
          {:ok, with(id when id != nil <- Store.named_element(conn, eid, name), do: handle(id))}
        end
      ]
    )
  end

  @doc """
  The `world` Capability, bound to the connection. `get` reads a component;
  `change`, `moveTo`, `notify`, `announce` and `startTimer` are Segment-bound, so their
  writes, output included, roll back with their Segment.
  """
  def world(conn, world_time) do
    entity = %{"object" => "entity"}

    Capability.from_functions(
      "world",
      %{
        "get" =>
          {[args: [entity, "text"], result: "any", cost: 1],
           fn [h, name], _ -> {:ok, Store.component(conn, eid(h), name)} end},
        "change" =>
          {[args: [entity, "text", "any"], cost: 1, segment_bound: true],
           fn [h, name, value], _ ->
             Store.put_component(conn, eid(h), name, plain(value))
             {:ok, nil}
           end},
        "moveTo" =>
          {[args: [entity, entity], cost: 1, segment_bound: true],
           fn [h, place], _ ->
             Store.move(conn, eid(h), eid(place))
             {:ok, nil}
           end},
        "notify" =>
          {[args: [entity, "text"], cost: 1, segment_bound: true],
           fn [who, text], _ ->
             Store.output(conn, eid(who), text)
             {:ok, nil}
           end},
        "announce" =>
          {[args: [entity, "text"], cost: 1, segment_bound: true],
           fn [place, text], _ ->
             for c <- Store.characters_at(conn, eid(place)), do: Store.output(conn, c, text)
             {:ok, nil}
           end},
        # Timers are World data (ADR 0014). This lives on `world` rather than
        # a `timer` Capability of its own: each Grant is its own Segment
        # participant, so one Segment couldn't use both.
        "startTimer" =>
          {[args: [entity, "number", "text"], cost: 1, segment_bound: true],
           fn [h, seconds, message], _ ->
             due = world_time.() + round(Decimal.to_float(Decimal.new(seconds)) * 1000)

             Store.run!(conn, "INSERT INTO timers (due, entity, message) VALUES (?, ?, ?)", [
               due,
               eid(h),
               message
             ])

             {:ok, nil}
           end}
      },
      effect: fn phase, effect -> segment(conn, phase, effect.segment) end
    )
  end

  # Each Segment is a SAVEPOINT inside the step's transaction (ADR 0015).
  defp segment(conn, phase, segment) do
    name = ~s("#{String.replace(segment, "\"", "")}")

    case phase do
      :begin -> Store.exec!(conn, "SAVEPOINT #{name}")
      :commit -> Store.exec!(conn, "RELEASE #{name}")
      :rollback -> Store.exec!(conn, "ROLLBACK TO #{name}; RELEASE #{name}")
    end

    :ok
  end

  @doc "`clock`: World time in milliseconds, which pauses while the server is down."
  def clock(world_time) do
    Capability.from_functions("clock", %{
      "now" => {[result: "number"], fn [], _ -> {:ok, world_time.()} end}
    })
  end

  defp plain(%NorthTalk.Map{entries: entries}),
    do: Map.new(entries, fn {k, v} -> {k, plain(v)} end)

  defp plain(list) when is_list(list), do: Enum.map(list, &plain/1)
  defp plain(%Decimal{} = d), do: Decimal.to_float(d)
  defp plain(%Object{} = o), do: %{"$entity" => eid(o)}
  defp plain(other), do: other
end
