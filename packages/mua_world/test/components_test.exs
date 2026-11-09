# Both Hosts define mua's components alike (spec/mua/components): the
# TypeScript Host checks itself against the same file.
defmodule MuaWorld.ComponentsTest do
  use ExUnit.Case, async: true

  @spec_file Path.expand("../../../spec/mua/components/components.json", __DIR__)

  # each definition as stored, with its columns sorted by name
  defp defined do
    edl = MapSet.new(OdgnEdl.components(), & &1.name)

    for c <- MuaWorld.Components.all(), not MapSet.member?(edl, c.name), into: %{} do
      stored = c |> OdgnEcs.Component.to_json() |> JSON.decode!()
      {c.name, Map.update!(stored, "columns", &Enum.sort_by(&1, fn col -> col["name"] end))}
    end
  end

  test "mua's components are those both Hosts agree on" do
    assert defined() == @spec_file |> File.read!() |> JSON.decode!()
  end

  test "a builder composes from described, noun, item, container and readable" do
    buildable = for c <- MuaWorld.Components.all(), c.buildable, do: c.name
    assert Enum.sort(buildable) == ~w(container described item noun readable)
  end
end
