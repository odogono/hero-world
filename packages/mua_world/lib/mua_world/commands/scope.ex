defmodule MuaWorld.Commands.Scope do
  @moduledoc """
  What a player can refer to by name, ported from `queries/scope.ts`. A
  candidate is a map of `id`, `name`, `words` (lowercase words that name it:
  its `noun` words and its name's), `player?`, `takeable?`, `location` and
  `container` (`%{closed?: bool}` or `nil`).

  Scopes: `inv` is what the actor carries, `room` the actor's room but not
  what they carry, and `here` both.
  """

  @doc "The entities located directly in a place, in id order."
  def entities_in(world, place), do: OdgnEcs.query(world, where: [{"location", "in", place}])

  @doc "The entity this one is located in, or `nil`."
  def location(world, eid) do
    case eid && OdgnEcs.get(world, eid, "location") do
      %{"in" => place} -> place
      _ -> nil
    end
  end

  @doc """
  The named Elements of a place, and those of any open containers among
  them. Players are listed but never searched.
  """
  def elements(world, place, exclude \\ nil) do
    world
    |> entities_in(place)
    |> Enum.reject(&(&1 == exclude or OdgnEcs.get(world, &1, "portal") != nil))
    |> Enum.flat_map(fn eid ->
      candidate = candidate(world, eid)

      inside =
        if candidate && candidate.container && !candidate.container.closed? && !candidate.player?,
          do: elements(world, eid, exclude),
          else: []

      List.wrap(candidate) ++ inside
    end)
  end

  @doc "The candidates in `scope` for an actor."
  def in_scope(world, actor, scope) do
    carried = if scope == "room", do: [], else: elements(world, actor)

    if scope == "inv" do
      carried
    else
      case location(world, actor) do
        nil -> carried
        room -> carried ++ elements(world, room, actor) ++ doors(world, room)
      end
    end
  end

  @doc "An entity as a candidate, or `nil` if it has no name or location."
  def candidate(world, eid) do
    described = OdgnEcs.get(world, eid, "described")
    player = OdgnEcs.get(world, eid, "player")
    name = (described && described["name"]) || (player && player["name"])
    place = location(world, eid)

    if name && place do
      container = OdgnEcs.get(world, eid, "container")
      item = OdgnEcs.get(world, eid, "item")

      %{
        id: eid,
        name: name,
        words: words(world, eid, name),
        player?: player != nil,
        takeable?: (item && item["is_takeable"]) || false,
        location: place,
        container: container && %{closed?: container["is_closed"] == true}
      }
    end
  end

  # The doors of a room's exits, named as if they were in the room.
  defp doors(world, room) do
    world
    |> entities_in(room)
    |> Enum.flat_map(fn eid ->
      case OdgnEcs.get(world, eid, "portal") do
        %{"door" => door} when is_integer(door) -> [door]
        _ -> []
      end
    end)
    |> Enum.uniq()
    |> Enum.flat_map(fn door ->
      with %{"name" => name} <- OdgnEcs.get(world, door, "described"),
           %{} <- OdgnEcs.get(world, door, "door") do
        [
          %{
            id: door,
            name: name,
            words: words(world, door, name),
            player?: false,
            takeable?: false,
            location: room,
            container: nil
          }
        ]
      else
        _ -> []
      end
    end)
  end

  defp words(world, eid, name) do
    nouns =
      case OdgnEcs.get(world, eid, "noun") do
        %{"words" => words} when is_list(words) -> Enum.map(words, &String.downcase/1)
        _ -> []
      end

    Enum.uniq(nouns ++ String.split(String.downcase(name)))
  end

  @doc ~s("the mailbox", or a player's name as written.)
  def the_name(%{player?: true, name: name}), do: name
  def the_name(%{name: name}), do: "the " <> String.downcase(name)

  @doc "What to call an entity in a message: a player's name, or its own."
  def name_of(world, eid) do
    case eid && (OdgnEcs.get(world, eid, "player") || OdgnEcs.get(world, eid, "described")) do
      %{"name" => name} when is_binary(name) -> name
      _ -> "Someone"
    end
  end
end
