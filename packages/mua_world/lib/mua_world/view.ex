defmodule MuaWorld.View do
  @moduledoc """
  What a Character can see, for clients to show beside the text: its room,
  what it carries and the commands it could type next. Ported from
  `packages/mua/src/server/mua-world/queries/view.ts`, with the inventory and
  actions added. It holds only what the Character could learn by looking, by
  name, never ids or components.

      %{
        room: %{name: "West of House", description: "...", exits: ["north", "east (closed)"],
                items: ["mailbox"], players: ["Bob", "Hollis"]},
        inventory: ["leaflet"],
        actions: ["north", "take mailbox", "examine leaflet", "drop leaflet"]
      }
  """

  @doc "The view for a Character in `room`, or `nil` when it has no room to see."
  def for_character(world, character, room) do
    case room && OdgnEcs.get(world, room, "described") do
      %{} = described ->
        contents = Enum.reject(entities_in(world, room), &(elem(&1, 0) == character))
        exits = for {_e, %{"portal" => portal}} <- contents, do: portal
        closed = closed_doors(world, exits)
        things = for {e, data} <- contents, thing?(data), n = name(data), do: {e, data, n}
        carried = for {_e, data} <- entities_in(world, character), n = name(data), do: n

        %{
          room: %{
            name: described["name"],
            description: described["description"],
            exits: Enum.map(exits, &exit_label(&1, closed)),
            items: Enum.map(things, &elem(&1, 2)),
            players: for({_e, data} <- contents, person?(data), n = name(data), do: n)
          },
          inventory: carried,
          actions:
            Enum.map(exits, & &1["dir"]) ++
              for({_e, data, n} <- things, takeable?(data), do: "take " <> String.downcase(n)) ++
              Enum.flat_map(
                carried,
                &["examine " <> String.downcase(&1), "drop " <> String.downcase(&1)]
              )
        }

      _ ->
        nil
    end
  end

  @read ~w(portal item container player npc described)

  # The entities in a place, each with the components the view reads
  defp entities_in(world, place),
    do: OdgnEcsTalk.elements(world, place, select: @read)

  # The exits' doors that are closed
  defp closed_doors(world, exits) do
    doors = for %{"door" => door} <- exits, is_integer(door), do: door

    world
    |> OdgnEcs.select(["door"], eids: doors, where: [{"door", "is_closed", true}])
    |> MapSet.new(&elem(&1, 0))
  end

  defp exit_label(%{"dir" => dir, "door" => door}, closed) when is_integer(door) do
    if MapSet.member?(closed, door), do: dir <> " (closed)", else: dir
  end

  defp exit_label(%{"dir" => dir}, _closed), do: dir

  defp thing?(data), do: Map.has_key?(data, "item") or Map.has_key?(data, "container")

  defp takeable?(data), do: (data["item"] || %{})["is_takeable"] == true

  defp person?(data), do: Map.has_key?(data, "player") or Map.has_key?(data, "npc")

  defp name(data) do
    case data["player"] || data["described"] do
      %{"name" => n} when is_binary(n) -> n
      _ -> nil
    end
  end
end
