defmodule OdgnEdl.Record do
  @moduledoc """
  What a Build recorded about a World's EDL, in the World's own database:
  Lineage, Script owners, Definition names, the values the EDL set on each
  entity, and the EDL's hash. A later Migration compares play against the
  recorded values (ADR 0008).
  """

  alias OdgnEcs.SQL

  @schema """
  CREATE TABLE IF NOT EXISTS edl_lineage (kind TEXT NOT NULL, name TEXT NOT NULL, bases TEXT NOT NULL, PRIMARY KEY (kind, name));
  CREATE TABLE IF NOT EXISTS edl_script_owner (kind TEXT NOT NULL, name TEXT NOT NULL, src TEXT NOT NULL, PRIMARY KEY (kind, name));
  CREATE TABLE IF NOT EXISTS edl_definition_name (name TEXT PRIMARY KEY, eid INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS edl_value (eid INTEGER NOT NULL, component TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (eid, component));
  CREATE TABLE IF NOT EXISTS edl_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  """

  @type script_owner ::
          %{kind: :atom, name: String.t(), src: String.t()}
          | %{kind: :entity, eid: OdgnEcs.eid(), src: String.t()}

  @doc false
  def ensure(%OdgnEcs{conn: conn}), do: SQL.exec!(conn, @schema)

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

  @doc "Each Definition name, with its entity."
  @spec definition_names(OdgnEcs.t()) :: %{String.t() => OdgnEcs.eid()}
  def definition_names(%OdgnEcs{conn: conn} = world) do
    ensure(world)

    conn
    |> SQL.all!("SELECT name, eid FROM edl_definition_name")
    |> Map.new(fn [n, e] -> {n, e} end)
  end

  @doc "The entity with a Definition name, or `nil`."
  @spec entity_named(OdgnEcs.t(), String.t()) :: OdgnEcs.eid() | nil
  def entity_named(%OdgnEcs{conn: conn} = world, name) do
    ensure(world)

    case SQL.one!(conn, "SELECT eid FROM edl_definition_name WHERE name = ?1", [name]) do
      [eid] -> eid
      nil -> nil
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
  def put_definition_name(%OdgnEcs{conn: conn}, name, eid) do
    SQL.run!(conn, "INSERT OR REPLACE INTO edl_definition_name (name, eid) VALUES (?1, ?2)", [
      name,
      eid
    ])
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
  def delete_definition_name(%OdgnEcs{conn: conn}, name) do
    SQL.run!(conn, "DELETE FROM edl_definition_name WHERE name = ?1", [name])
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
