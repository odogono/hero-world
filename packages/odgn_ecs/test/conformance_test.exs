# Runs the shared, language-neutral cases in spec/ecs (ADR 0019).
defmodule OdgnEcs.ConformanceTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component, System}

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

  for file <- Path.wildcard(Path.join(@spec_dir, "changes/*.json")) do
    @external_resource file
    spec = file |> File.read!() |> JSON.decode!()

    describe Path.relative_to(file, @spec_dir) do
      for c <- spec["cases"] do
        test c["name"] do
          run_changes(unquote(Macro.escape(spec)), unquote(Macro.escape(c)))
        end
      end
    end
  end

  for file <- Path.wildcard(Path.join(@spec_dir, "systems/*.json")) do
    @external_resource file
    spec = file |> File.read!() |> JSON.decode!()

    describe Path.relative_to(file, @spec_dir) do
      for c <- spec["cases"] do
        test c["name"] do
          run_systems(unquote(Macro.escape(spec)), unquote(Macro.escape(c)))
        end
      end
    end
  end

  # Runs the case's ops against the spec's Systems, each of whose `run`
  # returns its entities
  defp run_systems(spec, c) do
    {world, ids} = build(spec)

    systems =
      Map.new(spec["systems"], fn s ->
        {s["name"],
         %System{
           name: s["name"],
           every: s["every"],
           query: s["query"] |> resolve(ids) |> options(ids),
           select: s["select"],
           run: fn entities, _ -> entities end
         }}
      end)

    named = fn names -> Enum.map(names, &Map.fetch!(systems, &1)) end
    labels = Map.new(ids, fn {label, eid} -> {eid, label} end)

    Enum.each(c["ops"], fn
      ["arm", names, now] ->
        :ok = System.arm(world, named.(names), now)

      ["due", names, now, expected] ->
        assert Enum.map(System.due(world, named.(names), now), & &1.name) == expected

      ["next_due", names, expected] ->
        assert System.next_due(world, named.(names)) == expected

      ["run", name, now, expected] ->
        ran =
          for e <- System.run(world, Map.fetch!(systems, name), now, nil) do
            case e do
              {eid, data} -> [labels[eid], data]
              eid -> labels[eid]
            end
          end

        assert ran == expected

      op ->
        op(world, op, ids)
    end)
  end

  # Builds the World, takes its change set, runs the case's ops, and takes
  # the change set again
  defp run_changes(spec, c) do
    {world, ids} = build(spec)
    OdgnEcs.take_changes(world)
    ids = Enum.reduce(c["ops"], ids, &op(world, &1, &2))

    actual =
      for {eid, name, kind, data} <- OdgnEcs.take_changes(world),
          do: [eid, name, Atom.to_string(kind), data]

    expected =
      for [label, name, kind, data] <- c["expect"],
          do: [Map.fetch!(ids, label), name, kind, resolve(data, ids)]

    assert actual == expected
  end

  defp op(world, ["create", label], ids) do
    {:ok, eid} = OdgnEcs.create(world)
    Map.put(ids, label, eid)
  end

  # `["fails", kind, op]`: the op returns an error of that kind
  defp op(world, ["fails", kind, inner], ids) do
    assert {:error, %OdgnEcs.Error{kind: actual}} = apply_op(world, inner, ids)
    assert Atom.to_string(actual) == kind
    ids
  end

  defp op(world, op, ids) do
    :ok = apply_op(world, op, ids)
    ids
  end

  defp apply_op(world, op, ids) do
    case op do
      ["put", l, name, data] ->
        OdgnEcs.put(world, ids[l], name, resolve(data, ids))

      ["put_many", name, rows] ->
        OdgnEcs.put_many(world, name, for([l, data] <- rows, do: {ids[l], resolve(data, ids)}))

      ["remove", l, name] ->
        OdgnEcs.remove(world, ids[l], name)

      ["delete", l] ->
        OdgnEcs.delete(world, ids[l])

      ["begin"] ->
        OdgnEcs.begin(world)

      ["commit"] ->
        OdgnEcs.commit(world)

      ["rollback"] ->
        OdgnEcs.rollback(world)

      ["savepoint", n] ->
        OdgnEcs.savepoint(world, n)

      ["rollback_to", n] ->
        OdgnEcs.rollback_to(world, n)
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
            index: Map.get(col, "index", false),
            on_delete: String.to_existing_atom(Map.get(col, "on_delete", "restrict"))
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
