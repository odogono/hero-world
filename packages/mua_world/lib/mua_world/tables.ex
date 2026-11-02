defmodule MuaWorld.Tables do
  @moduledoc """
  mua's own tables, beside the ECS's, in the World's database: World time,
  each Step's outbox, inputs still waiting, and notices left from a restart.
  None of them are game data, so they aren't components.
  """
  alias OdgnEcs.SQL

  @schema """
  CREATE TABLE IF NOT EXISTS mua_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mua_waiting (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, command TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mua_outbox (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mua_notices (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
  """

  def ensure(%OdgnEcs{conn: conn}), do: SQL.exec!(conn, @schema)

  def world_time(%OdgnEcs{conn: conn}) do
    case SQL.one!(conn, "SELECT value FROM mua_meta WHERE key = 'world_time'") do
      [value] -> String.to_integer(value)
      nil -> 0
    end
  end

  def put_world_time(%OdgnEcs{conn: conn}, ms) do
    SQL.run!(
      conn,
      "INSERT INTO mua_meta (key, value) VALUES ('world_time', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [Integer.to_string(ms)]
    )
  end

  @doc "The Characters (entities with `player`) whose Location is `place`."
  def characters_at(world, place) do
    OdgnEcs.query(world, with: ["player"], where: [{"location", "in", place}])
  end

  def output(%OdgnEcs{conn: conn}, character, text),
    do:
      SQL.run!(conn, "INSERT INTO mua_outbox (character, text) VALUES (?1, ?2)", [character, text])

  @doc "Takes the Step's output: read and cleared inside the Step's transaction."
  def take_outbox(%OdgnEcs{conn: conn}) do
    rows =
      for [c, t] <- SQL.all!(conn, "SELECT character, text FROM mua_outbox ORDER BY id"),
          do: {c, t}

    SQL.run!(conn, "DELETE FROM mua_outbox")
    rows
  end

  def insert_waiting(%OdgnEcs{conn: conn}, character, command) do
    SQL.run!(conn, "INSERT INTO mua_waiting (character, command) VALUES (?1, ?2)", [
      character,
      command
    ])

    [id] = SQL.one!(conn, "SELECT last_insert_rowid()")
    id
  end

  def delete_waiting(%OdgnEcs{conn: conn}, id),
    do: SQL.run!(conn, "DELETE FROM mua_waiting WHERE id = ?1", [id])

  @doc "Turns every input still waiting into a notice for its Character, and clears the outbox."
  def abandon_waiting(%OdgnEcs{conn: conn}) do
    for [character, command] <-
          SQL.all!(conn, "SELECT character, command FROM mua_waiting ORDER BY id") do
      SQL.run!(conn, "INSERT INTO mua_notices (character, text) VALUES (?1, ?2)", [
        character,
        "The world was restarted, and \"#{command}\" was abandoned."
      ])
    end

    SQL.exec!(conn, "DELETE FROM mua_waiting; DELETE FROM mua_outbox")
  end

  def take_notices(%OdgnEcs{conn: conn}, character) do
    notices =
      for [t] <-
            SQL.all!(conn, "SELECT text FROM mua_notices WHERE character = ?1 ORDER BY id", [
              character
            ]),
          do: t

    SQL.run!(conn, "DELETE FROM mua_notices WHERE character = ?1", [character])
    notices
  end
end
