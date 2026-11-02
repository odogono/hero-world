defmodule MuaWorld.Places do
  @moduledoc """
  The places every World has, ported from `world/places.ts`, and where a
  Character goes when it enters:

  - **Limbo** holds what is out of play: Characters whose Players have left,
    and new Characters before they first enter.
  - **The system actor** acts when no Player did.
  - **The Starting room** is where a Character enters when it has nowhere
    valid to return to. It is configured by Definition name, and must be a
    top-level place: an entity that exists, isn't Limbo and has no Location.

  Limbo and the system actor are found by `meta.props.id` (`limbo`,
  `system`), and made when the EDL doesn't declare them.
  """

  @limbo "limbo"
  @system "system"

  @type t :: %{limbo: OdgnEcs.eid(), system: OdgnEcs.eid(), starting_room: OdgnEcs.eid()}

  @doc """
  Finds or makes Limbo and the system actor, and checks the Starting room.
  Call it inside a transaction.
  """
  @spec ensure(OdgnEcs.t(), String.t() | nil) :: {:ok, t()} | {:error, String.t()}
  def ensure(world, starting_room) do
    limbo = limbo(world)

    system =
      find(world, @system) ||
        make(world, %{
          "described" => %{"name" => "The world", "description" => "The world itself."},
          "location" => %{"in" => limbo},
          "meta" => %{"props" => %{"id" => @system}}
        })

    with {:ok, room} <- starting_room(world, starting_room, limbo),
         do: {:ok, %{limbo: limbo, system: system, starting_room: room}}
  end

  @doc "Finds or makes Limbo. Call it inside a transaction."
  @spec limbo(OdgnEcs.t()) :: OdgnEcs.eid()
  def limbo(world) do
    find(world, @limbo) ||
      make(world, %{
        "container" => %{"capacity" => 10_000, "is_closed" => false},
        "described" => %{"name" => "Limbo", "description" => "Nowhere at all."},
        "meta" => %{"props" => %{"id" => @limbo}}
      })
  end

  @doc "The Characters inside an entity, at any depth."
  @spec characters_within(OdgnEcs.t(), OdgnEcs.eid()) :: [OdgnEcs.eid()]
  def characters_within(world, eid, seen \\ MapSet.new()) do
    if MapSet.member?(seen, eid) do
      []
    else
      seen = MapSet.put(seen, eid)

      Enum.flat_map(OdgnEcs.query(world, where: [{"location", "in", eid}]), fn element ->
        own = if OdgnEcs.get(world, element, "player"), do: [element], else: []
        own ++ characters_within(world, element, seen)
      end)
    end
  end

  defp starting_room(_world, nil, _limbo),
    do: {:error, "no starting room is configured: start the World with `starting_room:`"}

  defp starting_room(world, name, limbo) do
    case OdgnEdl.entity_named(world, name) do
      nil ->
        {:error, "the starting room #{inspect(name)} is not an entity of the World"}

      eid ->
        if place?(world, eid, limbo),
          do: {:ok, eid},
          else: {:error, "the starting room #{inspect(name)} is not a top-level place"}
    end
  end

  @doc """
  Where a Character entering from Limbo goes: the room it left, if that is
  still a place, otherwise the Starting room.
  """
  @spec destination(OdgnEcs.t(), OdgnEcs.eid(), t()) :: OdgnEcs.eid()
  def destination(world, character, places) do
    case (OdgnEcs.get(world, character, "player") || %{})["return_to"] do
      room when is_integer(room) ->
        if place?(world, room, places.limbo), do: room, else: places.starting_room

      _ ->
        places.starting_room
    end
  end

  @doc """
  Whether an entity is a place a Character can be in: it exists, isn't Limbo,
  and isn't inside anything.
  """
  def place?(world, eid, limbo) do
    eid != limbo and OdgnEcs.exists?(world, eid) and
      (OdgnEcs.get(world, eid, "location") || %{})["in"] == nil
  end

  defp find(world, id) do
    world
    |> OdgnEcs.query(with: ["meta"])
    |> Enum.find(&(get_in(OdgnEcs.get(world, &1, "meta"), ["props", "id"]) == id))
  end

  defp make(world, components) do
    {:ok, eid} = OdgnEcs.create(world)
    for {name, data} <- components, do: :ok = OdgnEcs.put(world, eid, name, data)
    eid
  end
end
