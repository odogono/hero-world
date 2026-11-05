defmodule OdgnEcsEngine.Tables do
  @moduledoc """
  The engine's tables, beside the store's, in the World's database
  (ADR 0022): World time in `ecs_engine_meta`, timers in
  `ecs_engine_timers` (`OdgnEcsEngine.Timers`), and the Waiting inputs
  whose Runs had not ended at the last commit in `ecs_engine_waiting`. They
  are part of a World file's contract, so every implementation spells them
  the same.
  """
  alias OdgnEcs.SQL

  @schema """
  CREATE TABLE IF NOT EXISTS ecs_engine_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ecs_engine_waiting (id INTEGER PRIMARY KEY, actor INTEGER, input TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ecs_engine_timers (
    id INTEGER PRIMARY KEY,
    owner INTEGER NOT NULL REFERENCES entities (eid) ON DELETE CASCADE,
    script TEXT NOT NULL,
    name TEXT NOT NULL,
    at INTEGER NOT NULL,
    message TEXT NOT NULL,
    args TEXT NOT NULL,
    UNIQUE (owner, script, name)
  );
  CREATE INDEX IF NOT EXISTS ecs_engine_timers_at ON ecs_engine_timers (at);
  """

  @doc """
  Creates the engine's tables, if they aren't there yet, and moves the
  timers of a World made before the engine kept them, `talk_timer`
  entities, into `ecs_engine_timers`. Run it inside the caller's
  transaction, or on start, before anything else writes: running it again
  after a crash part way finishes the move.
  """
  def ensure(%OdgnEcs{conn: conn} = world) do
    SQL.exec!(conn, @schema)
    if OdgnEcs.component(world, "talk_timer"), do: move_talk_timers(conn)
    :ok
  end

  # Each timer entity becomes a row; the `talk_timer` definition stays,
  # empty, since the store can't drop one
  defp move_talk_timers(conn) do
    SQL.exec!(conn, """
    INSERT OR IGNORE INTO ecs_engine_timers (owner, script, name, at, message, args)
      SELECT owner, script, name, at, message, args FROM c_talk_timer ORDER BY at, eid;
    DELETE FROM entities WHERE eid IN (SELECT eid FROM c_talk_timer);
    """)
  end

  @doc "World time at the last commit, in milliseconds: 0 for a new World."
  def world_time(%OdgnEcs{conn: conn}) do
    case SQL.one!(conn, "SELECT value FROM ecs_engine_meta WHERE key = 'world_time'") do
      [value] -> String.to_integer(value)
      nil -> 0
    end
  end

  def put_world_time(%OdgnEcs{conn: conn}, ms) do
    SQL.run!(
      conn,
      "INSERT INTO ecs_engine_meta (key, value) VALUES ('world_time', ?1) " <>
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [Integer.to_string(ms)]
    )
  end

  @doc false
  def insert_waiting(%OdgnEcs{conn: conn}, actor, input) do
    SQL.run!(conn, "INSERT INTO ecs_engine_waiting (actor, input) VALUES (?1, ?2)", [actor, input])

    [id] = SQL.one!(conn, "SELECT last_insert_rowid()")
    id
  end

  @doc false
  def delete_waiting(%OdgnEcs{conn: conn}, id),
    do: SQL.run!(conn, "DELETE FROM ecs_engine_waiting WHERE id = ?1", [id])

  @doc """
  Takes the Waiting inputs left from before a restart, oldest first, as
  `%{actor: eid | nil, input: text}`, and clears them: their Runs ended with
  the process that ran them, so the Host decides what to tell their actors
  (ADR 0014).
  """
  def take_waiting(%OdgnEcs{conn: conn}) do
    waiting =
      for [actor, input] <-
            SQL.all!(conn, "SELECT actor, input FROM ecs_engine_waiting ORDER BY id"),
          do: %{actor: actor, input: input}

    SQL.run!(conn, "DELETE FROM ecs_engine_waiting")
    waiting
  end
end
