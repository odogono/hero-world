defmodule MuaWorld.Store do
  @moduledoc """
  The World's SQLite database, through one raw `Exqlite.Sqlite3` connection.

  The World process opens it and is its only writer (ADR 0015). Script
  callbacks use the same connection from their Tasks while the World process
  is blocked in `pump`, so there is never more than one user at a time.
  """
  alias Exqlite.Sqlite3

  @schema """
  CREATE TABLE IF NOT EXISTS atoms (
    name TEXT PRIMARY KEY,
    parent TEXT,
    script TEXT
  );
  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    atom TEXT,
    location INTEGER,
    character INTEGER NOT NULL DEFAULT 0,
    script TEXT
  );
  CREATE TABLE IF NOT EXISTS components (
    entity INTEGER NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (entity, name)
  );
  CREATE TABLE IF NOT EXISTS timers (
    id INTEGER PRIMARY KEY,
    due INTEGER NOT NULL,
    entity INTEGER NOT NULL,
    message TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS waiting (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, command TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notices (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
  """

  def open(path) do
    with {:ok, conn} <- Sqlite3.open(path),
         :ok <- Sqlite3.execute(conn, "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL"),
         :ok <- Sqlite3.execute(conn, @schema) do
      {:ok, conn}
    end
  end

  def close(conn), do: Sqlite3.close(conn)

  @doc "Runs SQL with no result, raising on failure."
  def exec!(conn, sql) do
    case Sqlite3.execute(conn, sql) do
      :ok -> :ok
      {:error, reason} -> raise "SQLite: #{inspect(reason)} in #{sql}"
    end
  end

  @doc "Every row of a query, as lists."
  def all(conn, sql, args \\ []) do
    {:ok, stmt} = Sqlite3.prepare(conn, sql)

    try do
      :ok = Sqlite3.bind(stmt, args)
      {:ok, rows} = Sqlite3.fetch_all(conn, stmt)
      rows
    after
      Sqlite3.release(conn, stmt)
    end
  end

  def one(conn, sql, args \\ []) do
    case all(conn, sql, args) do
      [row | _] -> row
      [] -> nil
    end
  end

  @doc "Runs a statement with arguments."
  def run!(conn, sql, args \\ []) do
    _ = all(conn, sql, args)
    :ok
  end

  def last_id(conn) do
    {:ok, id} = Sqlite3.last_insert_rowid(conn)
    id
  end

  def empty?(conn), do: one(conn, "SELECT count(*) FROM entities") == [0]

  def world_time(conn) do
    case one(conn, "SELECT value FROM meta WHERE key = 'world_time'") do
      [value] -> String.to_integer(value)
      nil -> 0
    end
  end

  def put_world_time(conn, ms),
    do:
      run!(
        conn,
        "INSERT INTO meta (key, value) VALUES ('world_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [Integer.to_string(ms)]
      )

  def component(conn, eid, name) do
    case one(conn, "SELECT value FROM components WHERE entity = ? AND name = ?", [eid, name]) do
      [json] -> Jason.decode!(json)
      nil -> nil
    end
  end

  def put_component(conn, eid, name, value),
    do:
      run!(
        conn,
        "INSERT INTO components (entity, name, value) VALUES (?, ?, ?) ON CONFLICT(entity, name) DO UPDATE SET value = excluded.value",
        [eid, name, Jason.encode!(value)]
      )

  def entity(conn, eid) do
    case one(
           conn,
           "SELECT id, name, atom, location, character, script FROM entities WHERE id = ?",
           [eid]
         ) do
      [id, name, atom, location, character, script] ->
        %{
          id: id,
          name: name,
          atom: atom,
          location: location,
          character: character == 1,
          script: script
        }

      nil ->
        nil
    end
  end

  def entities(conn) do
    for [id] <- all(conn, "SELECT id FROM entities ORDER BY id"), do: entity(conn, id)
  end

  def atoms(conn) do
    for [name, parent, script] <-
          all(conn, "SELECT name, parent, script FROM atoms ORDER BY name"),
        do: %{name: name, parent: parent, script: script}
  end

  @doc "The entities whose Location is `eid`, in id order: its Elements."
  def elements(conn, eid),
    do:
      for(
        [id] <- all(conn, "SELECT id FROM entities WHERE location = ? ORDER BY id", [eid]),
        do: id
      )

  def named_element(conn, eid, name) do
    case one(conn, "SELECT id FROM entities WHERE location = ? AND name = ? ORDER BY id", [
           eid,
           name
         ]) do
      [id] -> id
      nil -> nil
    end
  end

  def move(conn, eid, place),
    do: run!(conn, "UPDATE entities SET location = ? WHERE id = ?", [place, eid])

  @characters_at "SELECT id FROM entities WHERE location = ? AND character = 1"

  def characters_at(conn, place), do: for([id] <- all(conn, @characters_at, [place]), do: id)

  def output(conn, character, text),
    do: run!(conn, "INSERT INTO outbox (character, text) VALUES (?, ?)", [character, text])

  @doc "Takes the step's output: read and cleared inside the step's transaction."
  def take_outbox(conn) do
    rows = for [c, t] <- all(conn, "SELECT character, text FROM outbox ORDER BY id"), do: {c, t}
    run!(conn, "DELETE FROM outbox")
    rows
  end

  @doc "Seeds an empty World: `atoms` and `entities`, each a list of maps."
  def seed(conn, %{atoms: atoms, entities: entities}) do
    for a <- atoms,
        do:
          run!(conn, "INSERT INTO atoms (name, parent, script) VALUES (?, ?, ?)", [
            a.name,
            a[:parent],
            a[:script]
          ])

    for e <- entities do
      run!(
        conn,
        "INSERT INTO entities (id, name, atom, location, character, script) VALUES (?, ?, ?, ?, ?, ?)",
        [
          e.id,
          e.name,
          e[:atom],
          e[:location],
          if(e[:character], do: 1, else: 0),
          e[:script]
        ]
      )

      for {k, v} <- Map.get(e, :components, %{}), do: put_component(conn, e.id, to_string(k), v)
    end

    :ok
  end
end
