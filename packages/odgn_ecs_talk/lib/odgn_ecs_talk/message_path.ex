defmodule OdgnEcsTalk.MessagePath do
  @moduledoc """
  The Message Path above a definition's bases: each base, rightmost first,
  followed by its own bases, with an atom reached more than once kept only at
  its last place, so a shared ancestor comes after every atom built on it.
  `vase: box fragile`, both built on `thing`, climbs fragile, box, thing.
  """

  @doc "The linearized atoms above `bases`, where `lineage` gives an atom's own bases."
  @spec linearize([String.t()], (String.t() -> [String.t()] | nil)) :: [String.t()]
  def linearize(bases, lineage) do
    order = visit(bases, MapSet.new(), lineage, [])
    last = order |> Enum.with_index() |> Map.new()

    order
    |> Enum.with_index()
    |> Enum.filter(fn {a, i} -> last[a] == i end)
    |> Enum.map(&elem(&1, 0))
  end

  # Each atom, then its bases, depth first; `climbing` breaks a cycle
  defp visit(atoms, climbing, lineage, acc) do
    atoms
    |> Enum.reverse()
    |> Enum.reduce(acc, fn atom, acc ->
      if MapSet.member?(climbing, atom) do
        acc
      else
        visit(lineage.(atom) || [], MapSet.put(climbing, atom), lineage, acc ++ [atom])
      end
    end)
  end
end
