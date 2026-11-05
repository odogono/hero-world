defmodule OdgnEcsEngine.Tables do
  @moduledoc """
  The engine's tables, beside the store's, in the World's database
  (ADR 0022): World time in `ecs_engine_meta`, and the Waiting inputs whose
  Runs had not ended at the last commit in `ecs_engine_waiting`. They are
  part of a World file's contract, so every implementation spells them the
  same.
  """
  alias OdgnEcs.SQL

  @schema """
  CREATE TABLE IF NOT EXISTS ecs_engine_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ecs_engine_waiting (id INTEGER PRIMARY KEY, actor INTEGER, input TEXT NOT NULL);
  """

  @doc "Creates the engine's tables, if they aren't there yet."
  def ensure(%OdgnEcs{conn: conn}), do: SQL.exec!(conn, @schema)

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
