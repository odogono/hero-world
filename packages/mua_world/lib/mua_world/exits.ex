defmodule MuaWorld.Exits do
  @moduledoc """
  Turns every room's `exits` component into exit entities, ported from
  `world/exits.ts`. Each direction is the room it leads to, or a spec:
  `exits { north: $hall, south: { msg: "The windows are barred." },
           down: { to: $cellar one_way: true } }`.

  An exit to a room also makes the way back, unless that room already has an
  exit in the opposite direction or the exit is `one_way`. An exit already
  there wins, whether declared as an entity or made earlier, so expanding
  again on every start makes nothing new.
  """

  alias MuaWorld.Commands.Verbs

  @doc "Makes the missing exits. Returns the ids of the exits it made."
  @spec expand(OdgnEcs.t()) :: [OdgnEcs.eid()]
  def expand(world) do
    rooms = OdgnEcs.query(world, with: ["exits"])

    # ways back wait until every room's own exits exist, so an exit a room
    # declares always wins over one made as another room's way back
    {made, ways_back} =
      Enum.reduce(rooms, {[], []}, fn room, {made, back} ->
        exits = OdgnEcs.get(world, room, "exits")

        Enum.reduce(Verbs.directions(), {made, back}, fn dir, {made, back} ->
          case spec(exits[dir]) do
            nil ->
              {made, back}

            spec ->
              made = made ++ List.wrap(add(world, room, dir, spec))
              opposite = Verbs.opposite(dir)

              if is_integer(spec["to"]) and spec["one_way"] != true and opposite,
                do:
                  {made,
                   back ++ [{spec["to"], opposite, %{"door" => spec["door"], "to" => room}}]},
                else: {made, back}
          end
        end)
      end)

    made ++
      Enum.flat_map(ways_back, fn {room, dir, spec} -> List.wrap(add(world, room, dir, spec)) end)
  end

  defp spec(to) when is_integer(to), do: %{"to" => to}
  defp spec(%{} = spec), do: spec
  defp spec(_), do: nil

  defp add(world, room, dir, spec) do
    if find(world, room, dir) == nil do
      {:ok, eid} = OdgnEcs.create(world)
      :ok = OdgnEcs.put(world, eid, "location", %{"in" => room})

      :ok =
        OdgnEcs.put(world, eid, "portal", %{
          "dir" => dir,
          "door" => spec["door"],
          "msg" => spec["msg"],
          "to" => spec["to"]
        })

      eid
    end
  end

  @doc "The exit from a room in a direction, or `nil`."
  def find(world, room, dir) do
    world
    |> OdgnEcsTalk.elements(room, where: [{"portal", "dir", dir}])
    |> List.first()
  end
end
