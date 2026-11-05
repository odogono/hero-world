defmodule MuaWorld.Commands.Scope do
  @moduledoc """
  What a player can refer to by name, ported from `queries/scope.ts`. A
  candidate is a map of `id`, `name`, `words` (lowercase words that name it:
  its `noun` words and its name's), `player?`, `takeable?`, `location` and
  `container` (`%{closed?: bool}` or `nil`).

  Scopes: `inv` is what the actor carries, `room` the actor's room but not
  what they carry, and `here` both.
  """

  # The components a candidate is made from
  @read ~w(described player container item location noun portal)

  @doc "The entities located directly in a place, in id order."
  def entities_in(world, place), do: OdgnEcsTalk.elements(world, place)

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
    |> OdgnEcsTalk.elements(place, select: @read)
    |> Enum.reject(fn {eid, data} -> eid == exclude or Map.has_key?(data, "portal") end)
    |> Enum.flat_map(fn {eid, data} ->
      candidate = to_candidate(eid, data)

      inside =
        if candidate && candidate.container && !candidate.container.closed? && !candidate.player?,
          do: elements(world, eid, exclude),
          else: []

      List.wrap(candidate) ++ inside
    end)
  end

  @doc "The candidates within a Reach (`here`, `carried` or `room`) for an actor."
  def in_reach(world, actor, reach) do
    carried = if reach == "room", do: [], else: elements(world, actor)

    if reach == "carried" do
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
    case OdgnEcs.select(world, @read, eids: [eid]) do
      [{^eid, data}] -> to_candidate(eid, data)
      [] -> nil
    end
  end

  defp to_candidate(eid, data) do
    described = data["described"]
    player = data["player"]
    name = (described && described["name"]) || (player && player["name"])
    place = data["location"] && data["location"]["in"]

    if name && place do
      container = data["container"]
      item = data["item"]

      %{
        id: eid,
        name: name,
        words: words(data["noun"], name),
        player?: player != nil,
        takeable?: (item && item["is_takeable"]) || false,
        location: place,
        container: container && %{closed?: container["is_closed"] == true}
      }
    end
  end

  # The doors of a room's exits, named as if they were in the room.
  defp doors(world, room) do
    doors =
      world
      |> OdgnEcsTalk.elements(room, select: ["portal"], with: ["portal"])
      |> Enum.flat_map(fn
        {_eid, %{"portal" => %{"door" => door}}} when is_integer(door) -> [door]
        _ -> []
      end)
      |> Enum.uniq()

    world
    |> OdgnEcs.select(["described", "noun"], eids: doors, with: ["described", "door"])
    |> Enum.sort_by(fn {eid, _} -> Enum.find_index(doors, &(&1 == eid)) end)
    |> Enum.flat_map(fn
      {door, %{"described" => %{"name" => name}} = data} when is_binary(name) ->
        [
          %{
            id: door,
            name: name,
            words: words(data["noun"], name),
            player?: false,
            takeable?: false,
            location: room,
            container: nil
          }
        ]

      _ ->
        []
    end)
  end

  defp words(noun, name) do
    nouns =
      case noun do
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
