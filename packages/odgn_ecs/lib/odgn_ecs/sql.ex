defmodule OdgnEcs.SQL do
  @moduledoc """
  Raw SQL over a World's connection, for libraries built on the ECS (such as
  EDL's record of a Build) that keep tables of their own in the same database.
  """
  alias Exqlite.Sqlite3

  @doc "Runs SQL with no parameters and no result."
  def exec(conn, sql) do
    case Sqlite3.execute(conn, sql) do
      :ok ->
        :ok

      {:error, reason} ->
        {:error, OdgnEcs.Error.new(:sqlite, "SQLite: #{inspect(reason)} in #{sql}")}
    end
  end

  @doc "Runs SQL with no result, raising on failure."
  def exec!(conn, sql) do
    case exec(conn, sql) do
      :ok -> :ok
      {:error, error} -> raise error
    end
  end

  @doc "Every row of a query, as lists. Raises on failure."
  def all!(conn, sql, args \\ []) do
    {:ok, stmt} = check(Sqlite3.prepare(conn, sql), sql)

    try do
      :ok = check(Sqlite3.bind(stmt, args), sql)
      {:ok, rows} = check(Sqlite3.fetch_all(conn, stmt), sql)
      rows
    after
      Sqlite3.release(conn, stmt)
    end
  end

  @doc "The first row of a query, or `nil`."
  def one!(conn, sql, args \\ []) do
    case all!(conn, sql, args) do
      [row | _] -> row
      [] -> nil
    end
  end

  @doc "Runs a statement with parameters and no result. Raises on failure."
  def run!(conn, sql, args \\ []) do
    all!(conn, sql, args)
    :ok
  end

  @doc "Quotes an identifier."
  def ident(name), do: ~s(") <> String.replace(name, ~s("), ~s("")) <> ~s(")

  defp check({:error, reason}, sql),
    do: raise(OdgnEcs.Error.new(:sqlite, "SQLite: #{inspect(reason)} in #{sql}"))

  defp check(ok, _sql), do: ok
end
