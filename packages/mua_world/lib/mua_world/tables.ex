defmodule MuaWorld.Tables do
  @moduledoc """
  mua's own tables, beside the ECS's and the engine's, in the World's
  database: each Step's outbox, notices left from a restart, the sign-in
  identities that map to Accounts (ADR 0016) and the NPC queue. None of
  them are game data, so they aren't components. World time and Waiting
  inputs are the engine's (`OdgnEcsEngine.Tables`, ADR 0022).
  """
  alias OdgnEcs.SQL

  @schema """
  CREATE TABLE IF NOT EXISTS mua_outbox (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mua_notices (id INTEGER PRIMARY KEY, character INTEGER NOT NULL, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mua_identities (sub TEXT PRIMARY KEY, email TEXT, account INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS mua_npc_queue (id INTEGER PRIMARY KEY, actor INTEGER NOT NULL, text TEXT NOT NULL);
  """

  @doc """
  Creates mua's tables and the engine's, moving World time and Waiting
  inputs out of `mua_meta` and `mua_waiting` in a World made before the
  engine had tables of its own (ADR 0022).
  """
  def ensure(%OdgnEcs{conn: conn} = world) do
    OdgnEcsEngine.Tables.ensure(world)
    SQL.exec!(conn, @schema)

    if table?(conn, "mua_meta") or table?(conn, "mua_waiting") do
      :ok = OdgnEcs.begin(world)

      if table?(conn, "mua_meta") do
        SQL.exec!(conn, """
        INSERT OR IGNORE INTO ecs_engine_meta (key, value)
          SELECT key, value FROM mua_meta WHERE key = 'world_time';
        DROP TABLE mua_meta;
        """)
      end

      if table?(conn, "mua_waiting") do
        SQL.exec!(conn, """
        INSERT INTO ecs_engine_waiting (actor, input)
          SELECT character, command FROM mua_waiting ORDER BY id;
        DROP TABLE mua_waiting;
        """)
      end

      :ok = OdgnEcs.commit(world)
    end

    :ok
  end

  defp table?(conn, name),
    do:
      SQL.one!(conn, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [name]) !=
        nil

  @doc "The Characters (entities with `player`) whose Location is `place`."
  def characters_at(world, place) do
    OdgnEcsTalk.elements(world, place, with: ["player"])
  end

  @doc """
  Tells an entity something: a Character hears it; any other entity (a room,
  a box) passes it to the Characters inside it, but for `except`.
  """
  def tell(world, to, text, except \\ nil) do
    if OdgnEcs.get(world, to, "player") do
      output(world, to, text)
    else
      for c <- characters_at(world, to), c != except, do: output(world, c, text)
    end

    :ok
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

  @doc """
  Turns every input left waiting at the last stop
  (`OdgnEcsEngine.Tables.take_waiting/1`) into a notice for its Character,
  and clears the outbox. Returns how many were abandoned.
  """
  def abandon_waiting(%OdgnEcs{conn: conn} = world) do
    waiting = OdgnEcsEngine.Tables.take_waiting(world)

    for %{actor: character, input: command} <- waiting, character != nil do
      SQL.run!(conn, "INSERT INTO mua_notices (character, text) VALUES (?1, ?2)", [
        character,
        "The world was restarted, and \"#{command}\" was abandoned."
      ])
    end

    SQL.exec!(conn, "DELETE FROM mua_outbox")
    length(waiting)
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

  @doc """
  Queues a command an NPC's Script asked it to carry out (`mua act`): a
  line of text, or a bound command as a map, kept as JSON.
  """
  def queue_act(%OdgnEcs{conn: conn}, actor, command) do
    text = if is_map(command), do: Jason.encode!(%{"bound" => command}), else: command
    SQL.run!(conn, "INSERT INTO mua_npc_queue (actor, text) VALUES (?1, ?2)", [actor, text])
  end

  @doc "The queued NPC commands, oldest first, as `{id, actor, command}`."
  def queued_acts(%OdgnEcs{conn: conn}) do
    for [id, actor, text] <-
          SQL.all!(conn, "SELECT id, actor, text FROM mua_npc_queue ORDER BY id"),
        do: {id, actor, decode_act(text)}
  end

  defp decode_act("{" <> _ = text) do
    case Jason.decode(text) do
      {:ok, %{"bound" => %{} = command}} -> command
      _ -> text
    end
  end

  defp decode_act(text), do: text

  def delete_act(%OdgnEcs{conn: conn}, id),
    do: SQL.run!(conn, "DELETE FROM mua_npc_queue WHERE id = ?1", [id])

  @doc "The Account a sign-in identity (`sub`) maps to, or `nil`."
  def account_for(%OdgnEcs{conn: conn}, sub) do
    case SQL.one!(conn, "SELECT account FROM mua_identities WHERE sub = ?1", [sub]) do
      [account] -> account
      nil -> nil
    end
  end

  def put_identity(%OdgnEcs{conn: conn}, sub, email, account) do
    SQL.run!(
      conn,
      "INSERT INTO mua_identities (sub, email, account) VALUES (?1, ?2, ?3) " <>
        "ON CONFLICT(sub) DO UPDATE SET email = excluded.email",
      [sub, email, account]
    )
  end
end
