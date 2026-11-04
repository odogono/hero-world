# Runs the shared, language-neutral cases in spec/ecs (ADR 0019).
defmodule OdgnEcs.ConformanceTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component}

  @spec_dir Path.expand("../../../spec/ecs", __DIR__)

  for file <- Path.wildcard(Path.join(@spec_dir, "query/*.json")) do
    @external_resource file
    spec = file |> File.read!() |> JSON.decode!()

    describe Path.relative_to(file, @spec_dir) do
      for c <- spec["cases"] do
        test c["name"] do
          run_case(unquote(Macro.escape(spec)), unquote(Macro.escape(c)))
        end
      end
    end
  end

  defp run_case(spec, c) do
    {world, ids} = build(spec)
    query = c["query"] |> resolve(ids) |> options(ids)

    actual =
      case c["select"] do
        nil ->
          OdgnEcs.query(world, query)

        names ->
          for {eid, data} <- OdgnEcs.select(world, names, query), do: [eid, data]
      end

    assert actual == expected(c, ids)
  end

  defp build(spec) do
    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce(spec["components"], world, fn c, w ->
        {:ok, w} = OdgnEcs.define(w, component(c))
        w
      end)

    ids =
      Enum.reduce(spec["entities"], %{}, fn e, ids ->
        {:ok, eid} = OdgnEcs.create(world)
        Map.put(ids, e["id"], eid)
      end)

    for e <- spec["entities"], {name, data} <- e["components"] || %{} do
      :ok = OdgnEcs.put(world, ids[e["id"]], name, resolve(data, ids))
    end

    {world, ids}
  end

  defp component(%{"name" => name, "columns" => columns}) do
    %Component{
      name: name,
      columns:
        for col <- columns do
          %Column{
            name: col["name"],
            type: String.to_existing_atom(col["type"]),
            optional: Map.get(col, "optional", true),
            unique: Map.get(col, "unique", false),
            default: col["default"],
            index: Map.get(col, "index", false)
          }
        end
    }
  end

  # `{"$ref": label}` anywhere becomes that entity's id
  defp resolve(%{"$ref" => label}, ids), do: Map.fetch!(ids, label)
  defp resolve(map, ids) when is_map(map), do: Map.new(map, fn {k, v} -> {k, resolve(v, ids)} end)
  defp resolve(list, ids) when is_list(list), do: Enum.map(list, &resolve(&1, ids))
  defp resolve(v, _ids), do: v

  defp options(query, ids) do
    Enum.flat_map(query, fn
      {"with", names} -> [with: names]
      {"where", conds} -> [where: Enum.map(conds, &condition/1)]
      {"eids", labels} -> [eids: Enum.map(labels, &Map.get(ids, &1, &1))]
      {"order_by", orders} -> [order_by: Enum.map(orders, &order/1)]
      {"limit", n} -> [limit: n]
    end)
  end

  defp condition([c, p, v]), do: {c, p, v}
  defp condition([c, p, op, v]), do: {c, p, String.to_existing_atom(op), v}

  defp order([c, p]), do: {c, p}
  defp order([c, p, dir]), do: {c, p, String.to_existing_atom(dir)}

  # `expect` names entities by label
  defp expected(%{"select" => _, "expect" => rows}, ids),
    do: for([label, data] <- rows, do: [Map.fetch!(ids, label), resolve(data, ids)])

  defp expected(%{"expect" => labels}, ids), do: Enum.map(labels, &Map.fetch!(ids, &1))
end
