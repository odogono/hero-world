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
        contents = Enum.reject(entities_in(world, room), &(&1 == character))
        exits = for e <- contents, portal = OdgnEcs.get(world, e, "portal"), do: {portal, e}
        things = for e <- contents, thing?(world, e), n = name(world, e), do: {e, n}
        carried = for e <- entities_in(world, character), n = name(world, e), do: n

        %{
          room: %{
            name: described["name"],
            description: described["description"],
            exits: Enum.map(exits, fn {p, _} -> exit_label(world, p) end),
            items: Enum.map(things, &elem(&1, 1)),
            players: for(e <- contents, person?(world, e), n = name(world, e), do: n)
          },
          inventory: carried,
          actions:
            Enum.map(exits, fn {p, _} -> p["dir"] end) ++
              for({e, n} <- things, takeable?(world, e), do: "take " <> String.downcase(n)) ++
              Enum.flat_map(
                carried,
                &["examine " <> String.downcase(&1), "drop " <> String.downcase(&1)]
              )
        }

      _ ->
        nil
    end
  end

  defp entities_in(world, place), do: OdgnEcs.query(world, where: [{"location", "in", place}])

  defp exit_label(world, %{"dir" => dir, "door" => door}) when is_integer(door) do
    if (OdgnEcs.get(world, door, "door") || %{})["is_closed"] == true,
      do: dir <> " (closed)",
      else: dir
  end

  defp exit_label(_world, %{"dir" => dir}), do: dir

  defp thing?(world, e),
    do: OdgnEcs.get(world, e, "item") != nil or OdgnEcs.get(world, e, "container") != nil

  defp takeable?(world, e), do: (OdgnEcs.get(world, e, "item") || %{})["is_takeable"] == true

  defp person?(world, e),
    do: OdgnEcs.get(world, e, "player") != nil or OdgnEcs.get(world, e, "npc") != nil

  defp name(world, e) do
    case OdgnEcs.get(world, e, "player") || OdgnEcs.get(world, e, "described") do
      %{"name" => n} when is_binary(n) -> n
      _ -> nil
    end
  end
end
