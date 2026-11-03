defmodule MuaWorld.Backup do
  @moduledoc """
  Copies of a World's database, and restoring one into a clean instance.

  A copy is made with SQLite's `VACUUM INTO`, which writes a consistent,
  compact snapshot of the database as it stands. exqlite offers no binding
  for SQLite's online backup API, and `VACUUM INTO` needs none. A running
  World makes it from its own process between Steps (`MuaWorld.backup/2`),
  so the copy holds only committed Steps while play carries on. A stopped
  World is copied with `offline/2`.
  """

  alias MuaWorld.Lock
  alias OdgnEcs.SQL

  @doc """
  Writes a snapshot of the open database `conn` to `dest`, which must not
  exist yet. Runs outside any transaction.
  """
  @spec vacuum_into(Exqlite.Sqlite3.db(), Path.t()) :: {:ok, Path.t()} | {:error, String.t()}
  def vacuum_into(conn, dest) do
    dest = Path.expand(dest)

    cond do
      File.exists?(dest) ->
        {:error, "#{dest} already exists"}

      true ->
        File.mkdir_p!(Path.dirname(dest))

        try do
          SQL.run!(conn, "VACUUM INTO ?1", [dest])
          {:ok, dest}
        rescue
          e in OdgnEcs.Error -> {:error, e.message}
        end
    end
  end

  @doc "Copies the database of a stopped World at `db` to `dest`."
  @spec offline(Path.t(), Path.t()) :: {:ok, Path.t()} | {:error, String.t()}
  def offline(db, dest) do
    with_lock(db, fn ->
      with {:ok, conn} <- open(db) do
        try do
          vacuum_into(conn, dest)
        after
          Exqlite.Sqlite3.close(conn)
        end
      end
    end)
  end

  @doc """
  Restores the backup at `backup` as the World's database at `db`, which must
  not exist yet: restore into a clean instance, then start the World on it.
  The backup is checked with `PRAGMA integrity_check` first.
  """
  @spec restore(Path.t(), Path.t()) :: {:ok, Path.t()} | {:error, String.t()}
  def restore(backup, db) do
    cond do
      not File.exists?(backup) ->
        {:error, "There is no backup at #{backup}"}

      File.exists?(db) ->
        {:error, "#{db} already exists: restore into a clean instance"}

      true ->
        with :ok <- check(backup) do
          File.mkdir_p!(Path.dirname(db))

          with_lock(db, fn ->
            File.cp!(backup, db)
            {:ok, db}
          end)
        end
    end
  end

  @doc "Checks a database file's integrity."
  @spec check(Path.t()) :: :ok | {:error, String.t()}
  def check(path) do
    with {:ok, conn} <- open(path) do
      try do
        case SQL.all!(conn, "PRAGMA integrity_check") do
          [["ok"]] -> :ok
          rows -> {:error, "#{path} failed its integrity check: #{inspect(rows)}"}
        end
      after
        Exqlite.Sqlite3.close(conn)
      end
    end
  end

  defp open(path) do
    case Exqlite.Sqlite3.open(path) do
      {:ok, conn} -> {:ok, conn}
      {:error, reason} -> {:error, "Cannot open #{path}: #{inspect(reason)}"}
    end
  end

  defp with_lock(db, fun) do
    case Lock.acquire(db) do
      :ok ->
        try do
          fun.()
        after
          Lock.release(db)
        end

      {:error, :locked} ->
        {:error, "Another process holds the World at #{db}: stop it first"}
    end
  end
end
