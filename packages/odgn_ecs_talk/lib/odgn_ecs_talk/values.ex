defmodule OdgnEcsTalk.Values do
  @moduledoc false
  # Between component data and NorthTalk Values. NorthTalk refuses floats and
  # takes ordered maps, so floats become Decimals and maps NorthTalk.Maps; an
  # entity's Handle stands for its id.

  alias NorthTalk.Object

  @doc "Component data for a Script, as a map in column order."
  def component(%OdgnEcs.Component{columns: columns}, data) do
    NorthTalk.Map.new(for c <- columns, do: {c.name, to_value(Map.get(data, c.name))})
  end

  def to_value(f) when is_float(f), do: Decimal.from_float(f)

  def to_value(map) when is_map(map) and not is_struct(map),
    do:
      NorthTalk.Map.new(
        map
        |> Enum.sort_by(&elem(&1, 0))
        |> Enum.map(fn {k, v} -> {to_string(k), to_value(v)} end)
      )

  def to_value(list) when is_list(list), do: Enum.map(list, &to_value/1)
  def to_value(v), do: v

  @doc "A Script's Value as plain data for a component."
  def from_value(%NorthTalk.Map{entries: entries}),
    do: Map.new(entries, fn {k, v} -> {k, from_value(v)} end)

  def from_value(map) when is_map(map) and not is_struct(map),
    do: Map.new(map, fn {k, v} -> {k, from_value(v)} end)

  def from_value(list) when is_list(list), do: Enum.map(list, &from_value/1)

  def from_value(%Decimal{} = d) do
    if Decimal.integer?(d), do: Decimal.to_integer(d), else: Decimal.to_float(d)
  end

  def from_value(%Object{kind: "entity", id: id}), do: String.to_integer(id)
  def from_value(v), do: v

  @doc "Values in their storage form, as JSON text."
  def encode(values), do: values |> NorthTalk.Value.encode() |> Jason.encode!()

  def decode(json),
    do: json |> Jason.decode!(objects: :ordered_objects) |> NorthTalk.Value.decode()
end
