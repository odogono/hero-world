defmodule MuaWorld.Perception do
  @moduledoc """
  What a Character can currently know about the World (see GLOSSARY.md): its
  place, the Elements there that it can see, and what it carries. It is the
  one gate on what the server tells a Player about the World. The view, the
  client mirror and the change sets sent after each Step all read through it,
  because anything sent to a browser can be read by its user.

  A Character sees:

    * itself and its place;
    * the Elements of its place, other Characters among them;
    * the doors of its place's exits;
    * what it carries;
    * what is inside any open container it can see, at any depth.

  It sees nothing inside a closed container or another Character, and nothing
  anywhere else.
  """

  defstruct character: nil, place: nil, entities: MapSet.new()

  @type t :: %__MODULE__{
          character: integer(),
          place: integer() | nil,
          entities: MapSet.t(integer())
        }

  # The components a Perception is worked out from
  @read ~w(container player portal)

  @doc "The Perception of `character`, whose place is `place` (`nil` for none)."
  @spec of(OdgnEcs.t(), integer(), integer() | nil) :: t()
  def of(world, character, place) do
    carried = contents(world, character)

    around =
      if place do
        elements = contents(world, place)
        [place | elements] ++ doors(world, place)
      else
        []
      end

    %__MODULE__{
      character: character,
      place: place,
      entities: MapSet.new([character | carried ++ around])
    }
  end

  @doc "Whether `eid` is within the Perception."
  @spec perceives?(t(), integer()) :: boolean()
  def perceives?(%__MODULE__{entities: entities}, eid), do: MapSet.member?(entities, eid)

  @doc """
  The entities directly in `holder` that the Perception includes, each with
  the components named in `select`, in id order.
  """
  def elements(%__MODULE__{} = perception, world, holder, select) do
    if perceives?(perception, holder) do
      world
      |> OdgnEcsTalk.elements(holder, select: select)
      |> Enum.filter(fn {eid, _} -> perceives?(perception, eid) end)
    else
      []
    end
  end

  # The Elements of a holder, and those of any open container among them,
  # never those of another Character
  defp contents(world, holder) do
    world
    |> OdgnEcsTalk.elements(holder, select: @read)
    |> Enum.flat_map(fn {eid, data} ->
      if open_container?(data) and not Map.has_key?(data, "player"),
        do: [eid | contents(world, eid)],
        else: [eid]
    end)
  end

  defp open_container?(%{"container" => %{} = container}), do: container["is_closed"] != true
  defp open_container?(_), do: false

  # The doors of a place's exits
  defp doors(world, place) do
    for {_eid, %{"portal" => %{"door" => door}}} <-
          OdgnEcsTalk.elements(world, place, select: ["portal"], with: ["portal"]),
        is_integer(door),
        uniq: true,
        do: door
  end
end
