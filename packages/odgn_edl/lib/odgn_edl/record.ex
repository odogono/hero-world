defmodule OdgnEdl.Record do
  @moduledoc """
  What a Build recorded about a World's EDL, in the World's own database:
  Lineage, Script owners, Definition names, the values the EDL set on each
  entity, and the EDL's hash. A later Migration compares play against the
  recorded values (ADR 0008).

  A Definition name is a component, `edl_definition`, so an entity stays
  nothing but its id. When an entity with one is deleted, its name moves to
  `edl_deleted_name`, so a Migration knows play deleted it and doesn't make
  it again. The rest of the record is kept in tables of its own.
  """

  alias OdgnEcs.{Column, Component, SQL}

  @definition "edl_definition"

  @schema """
  CREATE TABLE IF NOT EXISTS edl_lineage (kind TEXT NOT NULL, name TEXT NOT NULL, bases TEXT NOT NULL, PRIMARY KEY (kind, name));
  CREATE TABLE IF NOT EXISTS edl_script_owner (kind TEXT NOT NULL, name TEXT NOT NULL, src TEXT NOT NULL, PRIMARY KEY (kind, name));
  CREATE TABLE IF NOT EXISTS edl_value (eid INTEGER NOT NULL, component TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (eid, component));
  CREATE TABLE IF NOT EXISTS edl_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS edl_deleted_name (name TEXT PRIMARY KEY, eid INTEGER NOT NULL);
  """

  @type script_owner ::
          %{kind: :atom, name: String.t(), src: String.t()}
          | %{kind: :entity, eid: OdgnEcs.eid(), src: String.t()}

  @doc "The component that holds an entity's Definition name."
  @spec definition_component() :: Component.t()
  def definition_component do
    %Component{
      name: @definition,
      columns: [%Column{name: "name", type: :string, optional: false, unique: true}]
    }
  end

  @doc false
  # Makes the record's tables and component, moving Definition names from
  # the table that held them before they were a component. Returns the
  # World, which then knows the component.
  def ensure(%OdgnEcs{conn: conn} = world) do
    SQL.exec!(conn, @schema)
    world = known(world)
    table = SQL.ident(Component.table(@definition))

    SQL.exec!(
      conn,
      "CREATE TRIGGER IF NOT EXISTS edl_definition_deleted BEFORE DELETE ON entities BEGIN " <>
        "INSERT OR REPLACE INTO edl_deleted_name (name, eid) " <>
        "SELECT name, eid FROM #{table} WHERE eid = OLD.eid; END;"
    )

    if SQL.one!(
         conn,
         "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'edl_definition_name'"
       ) do
      SQL.exec!(
        conn,
        "INSERT INTO #{table} (eid, name) " <>
          "SELECT eid, name FROM edl_definition_name WHERE eid IN (SELECT eid FROM entities) " <>
          "ON CONFLICT DO NOTHING; " <>
          "INSERT OR IGNORE INTO edl_deleted_name (name, eid) " <>
          "SELECT name, eid FROM edl_definition_name WHERE eid NOT IN (SELECT eid FROM entities); " <>
          "DROP TABLE edl_definition_name"
      )
    end

    world
  end

  defp known(world) do
    if OdgnEcs.component(world, @definition) do
      world
    else
      {:ok, world} = OdgnEcs.define(world, definition_component())
      world
    end
  end

  # -- Reads ------------------------------------------------------------------

  @doc "Whether the World has been built from an EDL."
  @spec built?(OdgnEcs.t()) :: boolean()
  def built?(world), do: hash(world) != nil

  @doc "The hash of the EDL the World was built from, or `nil`."
  @spec hash(OdgnEcs.t()) :: String.t() | nil
  def hash(%OdgnEcs{conn: conn} = world) do
    ensure(world)

    case SQL.one!(conn, "SELECT value FROM edl_meta WHERE key = 'hash'") do
      [hash] -> hash
      nil -> nil
    end
  end

  @doc "The atoms an atom directly extends, in order, or `nil` if there is no such atom."
  @spec atom_lineage(OdgnEcs.t(), String.t()) :: [String.t()] | nil
  def atom_lineage(world, name), do: lineage(world, "atom", name)

  @doc "The atoms an entity was built from, in order; empty if none."
  @spec entity_lineage(OdgnEcs.t(), OdgnEcs.eid()) :: [String.t()]
  def entity_lineage(world, eid), do: lineage(world, "entity", Integer.to_string(eid)) || []

  defp lineage(%OdgnEcs{conn: conn} = world, kind, name) do
    ensure(world)

    case SQL.one!(conn, "SELECT bases FROM edl_lineage WHERE kind = ?1 AND name = ?2", [
           kind,
           name
         ]) do
      [bases] -> JSON.decode!(bases)
      nil -> nil
    end
  end

  @doc "The atoms and entities that own a Script, atoms first, in EDL order."
  @spec script_owners(OdgnEcs.t()) :: [script_owner()]
  def script_owners(%OdgnEcs{conn: conn} = world) do
    ensure(world)

    conn
    |> SQL.all!("SELECT kind, name, src FROM edl_script_owner ORDER BY kind = 'entity', rowid")
    |> Enum.map(fn
      ["atom", name, src] -> %{kind: :atom, name: name, src: src}
      ["entity", eid, src] -> %{kind: :entity, eid: String.to_integer(eid), src: src}
    end)
  end

  @doc """
  Each Definition name, with its entity: the entities that have one, and
  those play has deleted, under the id they had.
  """
  @spec definition_names(OdgnEcs.t()) :: %{String.t() => OdgnEcs.eid()}
  def definition_names(world) do
    world = ensure(world)

    deleted =
      for [name, eid] <- SQL.all!(world.conn, "SELECT name, eid FROM edl_deleted_name"),
          into: %{},
          do: {name, eid}

    world
    |> OdgnEcs.select([@definition], with: [@definition])
    |> Map.new(fn {eid, %{@definition => %{"name" => name}}} -> {name, eid} end)
    |> then(&Map.merge(deleted, &1))
  end

  @doc "The entity with a Definition name, or `nil`."
  @spec entity_named(OdgnEcs.t(), String.t()) :: OdgnEcs.eid() | nil
  def entity_named(world, name) do
    case OdgnEcs.query(known(world), where: [{@definition, "name", name}]) do
      [eid] -> eid
      [] -> nil
    end
  end

  @doc """
  The components the EDL last set on an entity, each normalised as the World
  stores it and encoded as JSON with sorted keys.
  """
  @spec edl_values(OdgnEcs.t(), OdgnEcs.eid()) :: %{String.t() => String.t()}
  def edl_values(%OdgnEcs{conn: conn} = world, eid) do
    ensure(world)

    conn
    |> SQL.all!("SELECT component, value FROM edl_value WHERE eid = ?1", [eid])
    |> Map.new(fn [c, v] -> {c, v} end)
  end

  # -- Writes -----------------------------------------------------------------

  @doc false
  def put_lineage(%OdgnEcs{conn: conn}, kind, name, bases) do
    SQL.run!(conn, "INSERT OR REPLACE INTO edl_lineage (kind, name, bases) VALUES (?1, ?2, ?3)", [
      kind,
      to_string(name),
      JSON.encode!(bases)
    ])
  end

  @doc false
  def put_script(_world, _kind, _name, nil), do: :ok

  def put_script(%OdgnEcs{conn: conn}, kind, name, src) do
    SQL.run!(
      conn,
      "INSERT OR REPLACE INTO edl_script_owner (kind, name, src) VALUES (?1, ?2, ?3)",
      [
        kind,
        to_string(name),
        src
      ]
    )
  end

  @doc false
  # Gives an entity a Definition name, taking it from any other first
  def put_definition_name(world, name, eid) do
    world = known(world)

    for other <- OdgnEcs.query(world, where: [{@definition, "name", name}]),
        other != eid,
        do: :ok = OdgnEcs.remove(world, other, @definition)

    SQL.run!(world.conn, "DELETE FROM edl_deleted_name WHERE name = ?1", [name])
    :ok = OdgnEcs.put(world, eid, @definition, %{"name" => name})
  end

  @doc false
  def put_edl_value(%OdgnEcs{conn: conn}, eid, component, data) do
    SQL.run!(
      conn,
      "INSERT OR REPLACE INTO edl_value (eid, component, value) VALUES (?1, ?2, ?3)",
      [
        eid,
        component,
        stable_json(data)
      ]
    )
  end

  @doc "Every atom the record knows, by name."
  @spec atom_names(OdgnEcs.t()) :: [String.t()]
  def atom_names(%OdgnEcs{conn: conn} = world) do
    ensure(world)

    for [name] <-
          SQL.all!(conn, "SELECT name FROM edl_lineage WHERE kind = 'atom' ORDER BY rowid"),
        do: name
  end

  @doc false
  # Forgets every atom's Lineage and Script, before they are written again
  def clear_atoms(%OdgnEcs{conn: conn}) do
    SQL.exec!(
      conn,
      "DELETE FROM edl_lineage WHERE kind = 'atom'; DELETE FROM edl_script_owner WHERE kind = 'atom'"
    )
  end

  @doc false
  # Records the Script an entity owns, or that it owns none
  def replace_entity_script(%OdgnEcs{conn: conn} = world, eid, src) do
    SQL.run!(conn, "DELETE FROM edl_script_owner WHERE kind = 'entity' AND name = ?1", [
      Integer.to_string(eid)
    ])

    put_script(world, "entity", eid, src)
  end

  @doc false
  def delete_definition_name(world, name) do
    world = known(world)

    for eid <- OdgnEcs.query(world, where: [{@definition, "name", name}]),
        do: :ok = OdgnEcs.remove(world, eid, @definition)

    SQL.run!(world.conn, "DELETE FROM edl_deleted_name WHERE name = ?1", [name])
  end

  @doc false
  # Replaces the values the EDL last set on an entity
  def replace_edl_values(%OdgnEcs{conn: conn} = world, eid, values) do
    SQL.run!(conn, "DELETE FROM edl_value WHERE eid = ?1", [eid])
    for {component, data} <- values, do: put_edl_value(world, eid, component, data)
    :ok
  end

  @doc false
  def put_hash(%OdgnEcs{conn: conn}, hash) do
    SQL.run!(conn, "INSERT OR REPLACE INTO edl_meta (key, value) VALUES ('hash', ?1)", [hash])
  end

  @doc "JSON with object keys sorted, so key order never counts as a change."
  def stable_json(value), do: value |> sorted() |> IO.iodata_to_binary()

  defp sorted(map) when is_map(map) do
    pairs =
      map
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.map(fn {k, v} -> [JSON.encode!(to_string(k)), ":", sorted(v)] end)
      |> Enum.intersperse(",")

    ["{", pairs, "}"]
  end

  defp sorted(list) when is_list(list),
    do: ["[", list |> Enum.map(&sorted/1) |> Enum.intersperse(","), "]"]

  defp sorted(v), do: JSON.encode!(v)
end
