defmodule OdgnEdl.Build do
  @moduledoc false
  # A Build: the Migration of an empty World (ADR 0007). It runs in one
  # savepoint, so a Build that fails leaves the World as it was.

  alias OdgnEdl.{Atom, ComponentDef, Entity, Error, Record, Ref}
  alias OdgnEcs.{Column, Component}

  @script "script"

  def run(%OdgnEcs{} = world, source, definitions, opts) do
    Record.ensure(world)

    if Record.built?(world) do
      {:error,
       Error.new(
         :already_built,
         "This World has already been built from an EDL; a changed EDL needs a Migration"
       )}
    else
      OdgnEcs.in_savepoint(world, "odgn_edl_build", fn ->
        try do
          {:ok, build(world, source, definitions, opts)}
        catch
          {:edl_error, %Error{} = error} -> {:error, error}
        end
      end)
    end
  end

  defp build(world, source, definitions, opts) do
    defs = for %ComponentDef{} = d <- definitions, do: d
    atoms = for %Atom{} = a <- definitions, do: a
    entities = for %Entity{} = e <- definitions, do: e

    check_names(atoms, entities)
    world = Enum.reduce(defs, world, &define(&2, &1))

    atom_map = Map.new(atoms, &{&1.name, &1})
    entity_names = entities |> Enum.map(& &1.name) |> Enum.reject(&is_nil/1) |> MapSet.new()
    check_extends(atoms ++ entities, atom_map, entity_names)
    resolved_atoms = Enum.reduce(atoms, %{}, &resolve_atom(&1.name, atom_map, &2, []))

    # Make every entity first, so references can point forwards
    ids =
      Enum.map(entities, fn _ ->
        {:ok, eid} = OdgnEcs.create(world)
        eid
      end)

    planned =
      Enum.map(entities, fn e ->
        e.extends
        |> Enum.map(&resolved_atoms[&1])
        |> Enum.reduce(%{}, &merge(&2, &1))
        |> merge(e.components)
      end)

    by_name =
      entities
      |> Enum.zip(Enum.zip(ids, planned))
      |> Enum.filter(fn {e, _} -> e.name end)
      |> Map.new(fn {e, ip} -> {e.name, ip} end)

    path = Keyword.get(opts, :path)

    for {entity, eid, plan} <- Enum.zip([entities, ids, planned]) do
      components = resolve(plan, by_name, MapSet.new())

      for {name, data} <- components do
        ecs!(OdgnEcs.put(world, eid, name, data))
        {:ok, normalised} = Component.normalise(OdgnEcs.component(world, name), data)
        if entity.name, do: Record.put_edl_value(world, eid, name, normalised)
      end

      Record.put_lineage(world, "entity", eid, entity.extends)
      Record.put_script(world, "entity", eid, script_src(entity.components, path))
      if entity.name, do: Record.put_definition_name(world, entity.name, eid)
    end

    for atom <- atoms do
      Record.put_lineage(world, "atom", atom.name, atom.extends)
      Record.put_script(world, "atom", atom.name, script_src(atom.components, path))
    end

    Record.put_hash(world, hash(source))
    world
  end

  @doc false
  def hash(source), do: :crypto.hash(:sha256, source) |> Base.encode16(case: :lower)

  # -- Component definitions --------------------------------------------------

  defp define(world, %ComponentDef{name: name, columns: columns}) do
    component = %Component{name: name, columns: Enum.map(columns, &column(name, &1))}

    case OdgnEcs.define(world, component) do
      {:ok, world} -> world
      {:error, error} -> fail(:ecs, error.message)
    end
  end

  defp column(component, %OdgnEdl.Column{} = c) do
    type =
      Enum.find(Column.types(), &(Elixir.Atom.to_string(&1) == c.type)) ||
        fail(
          :invalid_definition,
          "Component '#{component}' column '#{c.name}' has unknown type '#{c.type}'."
        )

    %Column{
      name: c.name,
      type: type,
      optional: c.optional,
      unique: c.unique,
      default: default(c.default)
    }
  end

  # An EDL default is written raw; read it as the literal it looks like
  defp default(value) when is_binary(value) do
    s = String.trim(value)

    cond do
      s == "true" -> true
      s == "false" -> false
      Regex.match?(~r/^-?\d+$/, s) -> String.to_integer(s)
      Regex.match?(~r/^-?\d*\.\d+$/, s) -> elem(Float.parse(s), 0)
      Regex.match?(~r/^(".*"|'.*')$/s, s) -> String.slice(s, 1..-2//1)
      true -> s
    end
  end

  defp default(value), do: value

  # -- Inheritance ------------------------------------------------------------

  defp check_names(atoms, entities) do
    names =
      Enum.map(atoms, & &1.name) ++ (entities |> Enum.map(& &1.name) |> Enum.reject(&is_nil/1))

    case names -- Enum.uniq(names) do
      [] -> :ok
      [dup | _] -> fail(:duplicate_name, "'#{dup}' is defined more than once")
    end
  end

  defp check_extends(definitions, atom_map, entity_names) do
    for d <- definitions, base <- d.extends do
      cond do
        Map.has_key?(atom_map, base) ->
          :ok

        MapSet.member?(entity_names, base) ->
          fail(:invalid_extend, "'#{d.name}' cannot extend '#{base}': only atoms may be extended")

        true ->
          fail(:unknown_atom, "'#{d.name}' extends '#{base}', which is not an atom")
      end
    end
  end

  defp resolve_atom(name, atom_map, resolved, stack) do
    cond do
      Map.has_key?(resolved, name) ->
        resolved

      name in stack ->
        fail(
          :circular,
          "circular inheritance: #{Enum.join(Enum.reverse([name | stack]), " -> ")}"
        )

      true ->
        atom = atom_map[name]

        resolved =
          Enum.reduce(atom.extends, resolved, &resolve_atom(&1, atom_map, &2, [name | stack]))

        inherited = atom.extends |> Enum.map(&resolved[&1]) |> Enum.reduce(%{}, &merge(&2, &1))
        Map.put(resolved, name, merge(inherited, atom.components))
    end
  end

  # Later components win property by property: rightmost atom, then the
  # definition's own
  defp merge(base, extension) do
    Map.merge(base, extension, fn _component, a, b -> Map.merge(a, b) end)
  end

  # -- References -------------------------------------------------------------

  defp resolve(%Ref{} = ref, by_name, seen), do: resolve_ref(ref, by_name, seen)

  defp resolve(map, by_name, seen) when is_map(map),
    do: Map.new(map, fn {k, v} -> {k, resolve(v, by_name, seen)} end)

  defp resolve(list, by_name, seen) when is_list(list),
    do: Enum.map(list, &resolve(&1, by_name, seen))

  defp resolve(value, _by_name, _seen), do: value

  defp resolve_ref(%Ref{name: name, path: path} = ref, by_name, seen) do
    if MapSet.member?(seen, ref), do: fail(:circular, "circular reference: #{show(ref)}")

    case {Map.fetch(by_name, name), path} do
      {:error, _} ->
        fail(:unknown_reference, "#{show(ref)} refers to '#{name}', which is not a named entity")

      {{:ok, {eid, _}}, []} ->
        eid

      {{:ok, {_, plan}}, [component | props]} ->
        value =
          case Map.fetch(plan, component) do
            {:ok, data} ->
              Enum.reduce(props, data, &step(&2, &1, ref))

            :error ->
              fail(:missing_component, "#{show(ref)}: '#{name}' has no component '#{component}'")
          end

        resolve(value, by_name, MapSet.put(seen, ref))
    end
  end

  defp step(map, key, _ref) when is_map(map) and is_map_key(map, key), do: Map.fetch!(map, key)

  defp step(list, i, _ref) when is_list(list) and is_integer(i) and i < length(list),
    do: Enum.at(list, i)

  defp step(_, _, ref), do: fail(:missing_property, "#{show(ref)}: no such property")

  defp show(%Ref{name: name, path: path}),
    do: Enum.join(["$" <> name | Enum.map(path, &to_string/1)], ".")

  # -- Scripts ----------------------------------------------------------------

  defp script_src(components, path) do
    case components do
      %{@script => %{"src" => src}} when is_binary(src) and src != "" ->
        if path, do: Path.expand(src, Path.dirname(path)), else: src

      _ ->
        nil
    end
  end

  defp ecs!(:ok), do: :ok
  defp ecs!({:error, %OdgnEcs.Error{message: message}}), do: fail(:ecs, message)

  defp fail(kind, message), do: throw({:edl_error, Error.new(kind, message)})
end
