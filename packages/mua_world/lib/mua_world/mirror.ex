defmodule MuaWorld.Mirror do
  @moduledoc """
  The part of the World a browser may hold: a Character's
  `MuaWorld.Perception`, as rows in the shared layout (ADR 0019): one list of
  rows per Component Definition, each row its fields and its `eid`.

  A client fetches a `snapshot/2` when it connects, and is sent a
  `change_set/5` after each Step that changed what it perceives. A reconnect
  fetches a fresh snapshot; nothing is replayed.

  Only the components and fields below are shown. Everything else, such as
  Scripts, Accounts, locks and where a portal leads, stays on the server.
  """

  alias MuaWorld.Perception

  # The components a mirror holds, and the fields of each it shows
  @shown %{
    "container" => ~w(is_closed),
    "described" => ~w(name description),
    "door" => ~w(is_closed),
    "item" => ~w(is_takeable),
    "location" => ~w(in),
    "noun" => ~w(words),
    "npc" => [],
    "player" => ~w(name),
    "portal" => ~w(dir door)
  }

  @names Map.keys(@shown)

  @type rows :: %{String.t() => [map()]}

  @doc "The names of the components a mirror holds."
  def components, do: @names

  @doc """
  Every perceived entity's shown components:
  `%{character:, place:, components: %{name => [row]}}`.
  """
  def snapshot(world, %Perception{} = perception) do
    %{
      character: perception.character,
      place: perception.place,
      components: rows(world, MapSet.to_list(perception.entities))
    }
  end

  @doc """
  The rows a snapshot holds, by `{eid, name}`: what the server keeps of a
  client's mirror, so a change set sends only what the client lacks.
  """
  def held(%{components: components}), do: held(%{}, components)

  defp held(acc, components) do
    for {name, rows} <- components, row <- rows, into: acc, do: {{row["eid"], name}, row}
  end

  @doc """
  What a mirror of `before`, holding `held`, must do to become one of `now`,
  given the Step's change set (`OdgnEcs.take_changes/1`). Returns
  `{change_set, held}` with what the mirror then holds; `change_set` is
  `nil` when nothing it holds changed:

      %{place:, gone: [eid], put: %{name => [row]}, remove: %{name => [eid]}}

  `gone` are the entities no longer perceived, whose components the mirror
  drops. `put` holds every shown component of a newly perceived entity, and
  each shown component a perceived entity gained or changed. `remove` lists
  the shown components perceived entities lost.
  """
  def change_set(world, %Perception{} = before, held, %Perception{} = now, changes) do
    gone = MapSet.difference(before.entities, now.entities)
    entered = MapSet.difference(now.entities, before.entities)

    kept =
      for {eid, name, op, data} <- changes,
          name in @names,
          Perception.perceives?(now, eid),
          not MapSet.member?(entered, eid),
          do: {eid, name, op, data}

    put =
      kept
      |> Enum.reject(&(elem(&1, 2) == :removed))
      |> Enum.map(fn {eid, name, _, data} -> {name, row(name, eid, data)} end)
      # a change only to fields the mirror doesn't show sends nothing
      |> Enum.reject(fn {name, row} -> held[{row["eid"], name}] == row end)
      |> Enum.concat(
        for {name, rs} <- rows(world, MapSet.to_list(entered)), r <- rs, do: {name, r}
      )
      |> group()

    remove =
      kept
      |> Enum.filter(&(elem(&1, 2) == :removed))
      |> Enum.map(fn {eid, name, _, _} -> {name, eid} end)
      |> group()

    held =
      held
      |> Map.reject(fn {{eid, _}, _} -> MapSet.member?(gone, eid) end)
      |> Map.drop(for {name, eids} <- remove, eid <- eids, do: {eid, name})
      |> held(put)

    change_set =
      if gone == MapSet.new() and put == %{} and remove == %{} and before.place == now.place,
        do: nil,
        else: %{place: now.place, gone: Enum.sort(gone), put: put, remove: remove}

    {change_set, held}
  end

  defp rows(_world, []), do: %{}

  defp rows(world, eids) do
    world
    |> OdgnEcs.select(@names, eids: eids)
    |> Enum.flat_map(fn {eid, data} -> for {name, d} <- data, do: {name, row(name, eid, d)} end)
    |> group()
  end

  defp row(name, eid, data), do: data |> Map.take(@shown[name]) |> Map.put("eid", eid)

  defp group(pairs) do
    pairs
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
    |> Map.new(fn {name, values} -> {name, Enum.sort_by(values, &sort_key/1)} end)
  end

  defp sort_key(%{"eid" => eid}), do: eid
  defp sort_key(eid), do: eid
end
