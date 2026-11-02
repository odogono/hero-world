defmodule OdgnEdl.Migrate do
  @moduledoc false
  # A Migration: bringing a World up to date with a changed EDL while keeping
  # its players, Play state and time (ADR 0005, 0006, 0008), ported from
  # packages/ecs/src/edl/migrate.ts. A Build is the Migration of an empty
  # World (ADR 0007), which also makes the EDL's anonymous entities.
  #
  # It runs in one savepoint: an error, a failed `:finish`, or a dry run
  # rolls it back, so the World is left as it was.

  alias OdgnEdl.{Atom, ComponentDef, Entity, Error, Plan, Record, Ref}
  alias OdgnEcs.{Column, Component}

  @script "script"
  @savepoint "odgn_edl_migrate"

  def run(%OdgnEcs{} = world, source, definitions, opts) do
    Record.ensure(world)
    :ok = OdgnEcs.savepoint(world, @savepoint)

    result =
      try do
        {migrated, plan} = migrate(world, source, definitions, opts)

        case finish(opts[:finish], migrated, plan) do
          :ok -> {:ok, migrated, plan}
          {:error, %Error{}} = error -> error
          {:error, reason} -> {:error, Error.new(:check_failed, to_string(reason))}
        end
      rescue
        e ->
          :ok = OdgnEcs.rollback_to(world, @savepoint)
          reraise e, __STACKTRACE__
      catch
        {:edl_error, %Error{} = error} -> {:error, error}
      end

    case result do
      {:ok, migrated, plan} ->
        if opts[:dry_run] do
          :ok = OdgnEcs.rollback_to(world, @savepoint)
          {:ok, world, plan}
        else
          :ok = OdgnEcs.release(world, @savepoint)
          {:ok, migrated, plan}
        end

      error ->
        :ok = OdgnEcs.rollback_to(world, @savepoint)
        error
    end
  end

  defp finish(nil, _world, _plan), do: :ok
  defp finish(fun, world, plan), do: fun.(world, plan)

  @doc false
  def hash(source), do: :crypto.hash(:sha256, source) |> Base.encode16(case: :lower)

  defp migrate(world, source, definitions, opts) do
    build? = Keyword.get(opts, :build, false)
    path = Keyword.get(opts, :path)
    defs = for %ComponentDef{} = d <- definitions, do: d
    atoms = for %Atom{} = a <- definitions, do: a
    entities = for %Entity{} = e <- definitions, do: e

    check_names(atoms, entities)
    world = Enum.reduce(defs, world, &define(&2, &1))

    atom_map = Map.new(atoms, &{&1.name, &1})
    named = Enum.filter(entities, & &1.name)
    edl_names = MapSet.new(named, & &1.name)
    check_extends(atoms ++ entities, atom_map, edl_names)
    resolved_atoms = Enum.reduce(atoms, %{}, &resolve_atom(&1.name, atom_map, &2, []))

    plan = %Plan{atoms: plan_atoms(world, atoms, atom_map)}

    # Match each EDL entity to the entity it made, if it is still in play
    {stored, existing, plan} =
      Enum.reduce(named, {Record.definition_names(world), %{}, plan}, fn %Entity{
                                                                           name: name,
                                                                           was: was
                                                                         },
                                                                         {stored, existing, plan} ->
        {eid, stored, plan} =
          case {Map.get(stored, name), was} do
            {nil, was} when is_binary(was) ->
              if MapSet.member?(edl_names, was),
                do:
                  fail(
                    :invalid_rename,
                    "'#{name}' was '#{was}', but the EDL still defines '#{was}'"
                  )

              case Map.fetch(stored, was) do
                {:ok, eid} ->
                  renamed = %{eid: eid, from: was, to: name}

                  {eid, stored |> Map.delete(was) |> Map.put(name, eid),
                   %{plan | renamed: plan.renamed ++ [renamed]}}

                :error ->
                  {nil, stored, plan}
              end

            {eid, _} ->
              {eid, stored, plan}
          end

        cond do
          eid == nil -> {stored, existing, %{plan | created: plan.created ++ [name]}}
          OdgnEcs.exists?(world, eid) -> {stored, Map.put(existing, name, eid), plan}
          true -> {stored, existing, %{plan | missing: plan.missing ++ [%{eid: eid, name: name}]}}
        end
      end)

    gone =
      for {name, eid} <- Enum.sort_by(stored, &elem(&1, 1)),
          not MapSet.member?(edl_names, name),
          do: %{eid: eid, name: name}

    plan = %{plan | gone: gone}
    to_create = MapSet.new(plan.created)

    # Make every new entity first, in EDL order, so references can point
    # forwards; a Build numbers them in that order
    ids =
      Enum.map(entities, fn %Entity{name: name} ->
        cond do
          name != nil and Map.has_key?(existing, name) ->
            {:existing, existing[name]}

          (name != nil and MapSet.member?(to_create, name)) or (name == nil and build?) ->
            {:created, create(world)}

          true ->
            {:skip, nil}
        end
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
      |> Map.new(fn {e, {{_, eid}, p}} -> {e.name, {eid, p}} end)

    plan =
      entities
      |> Enum.zip(Enum.zip(ids, planned))
      |> Enum.reduce(plan, fn {entity, {{how, eid}, planned}}, plan ->
        case how do
          :skip ->
            plan

          :created ->
            desired = resolve(planned, by_name, MapSet.new())
            for {name, data} <- desired, do: ecs!(OdgnEcs.put(world, eid, name, data))
            Record.put_lineage(world, "entity", eid, entity.extends)
            Record.replace_entity_script(world, eid, script_src(entity.components, path))
            if entity.name, do: Record.put_definition_name(world, entity.name, eid)
            record_values(world, entity, eid, desired)
            plan

          :existing ->
            desired = resolve(planned, by_name, MapSet.new())
            plan = update(world, entity, eid, desired, plan)
            Record.replace_entity_script(world, eid, script_src(entity.components, path))
            record_values(world, entity, eid, desired)
            plan
        end
      end)

    for %{eid: eid, from: from, to: to} <- plan.renamed do
      Record.delete_definition_name(world, from)
      Record.put_definition_name(world, to, eid)
    end

    # Atoms' Lineage and Script owners are written again from the EDL
    Record.clear_atoms(world)

    for atom <- atoms do
      Record.put_lineage(world, "atom", atom.name, atom.extends)
      Record.put_script(world, "atom", atom.name, script_src(atom.components, path))
    end

    plan =
      case opts[:prune] do
        prune when is_function(prune, 1) and gone != [] ->
          for %{eid: eid, name: name} <- gone do
            prune.(eid)
            Record.delete_definition_name(world, name)
          end

          %{plan | pruned: true}

        _ ->
          plan
      end

    Record.put_hash(world, hash(source))
    {world, plan}
  end

  defp create(world) do
    {:ok, eid} = OdgnEcs.create(world)
    eid
  end

  # What the EDL now sets is what later Migrations compare play against
  defp record_values(_world, %Entity{name: nil}, _eid, _desired), do: :ok

  defp record_values(world, _entity, eid, desired) do
    values =
      for {name, data} <- desired, into: %{} do
        {:ok, normalised} = Component.normalise(OdgnEcs.component(world, name), data)
        {name, normalised}
      end

    Record.replace_edl_values(world, eid, values)
  end

  defp plan_atoms(world, atoms, atom_map) do
    recorded = Record.atom_names(world)

    %{
      added: for(a <- atoms, Record.atom_lineage(world, a.name) == nil, do: a.name),
      changed:
        for(
          a <- atoms,
          (lineage = Record.atom_lineage(world, a.name)) != nil,
          lineage != a.extends,
          do: a.name
        ),
      removed: for(name <- recorded, not Map.has_key?(atom_map, name), do: name)
    }
  end

  # One entity already in the World: each component the EDL now sets is
  # set where the World still holds what the EDL last set it to; one changed
  # since is kept and reported. Without a saved value, static components are
  # set and Play state is kept. Static components the EDL no longer sets are
  # removed; Play state ones stay.
  defp update(world, %Entity{name: name} = entity, eid, desired, plan) do
    current = OdgnEcs.components(world, eid)
    last_set = Record.edl_values(world, eid)

    {added, changed, kept} =
      desired
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.reduce({[], [], []}, fn {component, data}, {added, changed, kept} ->
        case Map.fetch(current, component) do
          :error ->
            {added ++ [component], changed, kept}

          {:ok, now} ->
            {:ok, wanted} = Component.normalise(OdgnEcs.component(world, component), data)
            stored = Record.stable_json(now)

            cond do
              Record.stable_json(wanted) == stored ->
                {added, changed, kept}

              untouched?(world, component, Map.get(last_set, component), stored) ->
                {added, changed ++ [component], kept}

              true ->
                {added, changed, kept ++ [component]}
            end
        end
      end)

    removed =
      for {component, _} <- Enum.sort_by(current, &elem(&1, 0)),
          not Map.has_key?(desired, component),
          not play_state?(world, component),
          do: component

    lineage = Record.entity_lineage(world, eid)
    lineage_change = if lineage != entity.extends, do: %{from: lineage, to: entity.extends}

    for component <- added ++ changed,
        do: ecs!(OdgnEcs.put(world, eid, component, desired[component]))

    for component <- removed, do: ecs!(OdgnEcs.remove(world, eid, component))
    if lineage_change, do: Record.put_lineage(world, "entity", eid, entity.extends)

    plan =
      if kept != [],
        do: %{plan | kept: plan.kept ++ [%{components: kept, eid: eid, name: name}]},
        else: plan

    if added ++ changed ++ removed != [] or lineage_change do
      change = %{
        eid: eid,
        name: name,
        added: added,
        changed: changed,
        removed: removed,
        lineage: lineage_change
      }

      %{plan | updated: plan.updated ++ [change]}
    else
      plan
    end
  end

  defp untouched?(world, component, nil, _stored), do: not play_state?(world, component)
  defp untouched?(_world, _component, saved, stored), do: saved == stored

  defp play_state?(world, component) do
    case OdgnEcs.component(world, component) do
      %Component{play_state: true} -> true
      _ -> false
    end
  end

  # -- Component definitions --------------------------------------------------

  defp define(world, %ComponentDef{name: name, columns: columns}) do
    component = %Component{name: name, columns: Enum.map(columns, &column(name, &1))}

    # a definition the World already has keeps whether it is Play state,
    # which EDL can't say
    component =
      case OdgnEcs.component(world, name) do
        %Component{play_state: play_state} -> %{component | play_state: play_state}
        nil -> component
      end

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
