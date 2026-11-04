defmodule OdgnEcs do
  @moduledoc """
  An entity-component store in SQLite.

  A World is a plain struct over one SQLite connection: there is no process.
  Whoever holds it, such as Mua's World process (ADR 0015), is its only
  writer, and it decides where changes commit. Nothing here starts or ends a
  transaction by itself: use `begin/1`, `savepoint/2`, `release/2`,
  `rollback_to/2`, `commit/1` and `rollback/1`.

  Each component is stored in a table of its own, one typed column per
  property. Component and property names are strings.
  """

  alias OdgnEcs.{Component, Error, SQL}
  alias Exqlite.Sqlite3

  defstruct conn: nil, components: %{}

  @type eid :: pos_integer()
  @type data :: %{String.t() => term()}
  @type t :: %__MODULE__{conn: Sqlite3.db(), components: %{String.t() => Component.t()}}

  @schema """
  CREATE TABLE IF NOT EXISTS entities (eid INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS ecs_components (name TEXT PRIMARY KEY, columns TEXT NOT NULL);
  """

  # -- Opening ----------------------------------------------------------------

  @doc """
  Opens the World at `path` (or `":memory:"`), with the components already
  defined in it.

  With `exclusive: true`, the connection keeps SQLite's lock once it has
  written, until it closes, so no other process can write the World
  meanwhile, as a World process needs while it runs.
  """
  @spec open(String.t(), keyword()) :: {:ok, t()} | {:error, Error.t()}
  def open(path, opts \\ []) do
    locking = if opts[:exclusive], do: "PRAGMA locking_mode = EXCLUSIVE; ", else: ""

    with {:ok, conn} <- open_conn(path),
         :ok <-
           SQL.exec(
             conn,
             locking <>
               "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL"
           ),
         :ok <- SQL.exec(conn, @schema) do
      components =
        for [name, json] <- SQL.all!(conn, "SELECT name, columns FROM ecs_components"),
            into: %{},
            do: {name, Component.from_json(name, json)}

      {:ok, %__MODULE__{conn: conn, components: components}}
    end
  end

  defp open_conn(path) do
    case Sqlite3.open(path) do
      {:ok, conn} -> {:ok, conn}
      {:error, reason} -> {:error, Error.new(:sqlite, "Cannot open #{path}: #{inspect(reason)}")}
    end
  end

  @doc "Closes the World's connection. Changes not yet committed are lost."
  @spec close(t()) :: :ok
  def close(%__MODULE__{conn: conn}), do: Sqlite3.close(conn)

  # -- Components -------------------------------------------------------------

  @doc """
  Defines a component, creating its table. Defining one the World already has
  is fine if the definition is the same. If it differs, compatible changes
  are made to the table in place, and any other is an `:incompatible_change`
  error (see `OdgnEcs.Component.changes/2`).
  """
  @spec define(t(), Component.t()) :: {:ok, t()} | {:error, Error.t()}
  def define(%__MODULE__{} = world, %Component{} = component) do
    with :ok <- Component.validate(component),
         {:ok, world} <- define_table(world, component) do
      # Every time, so a World made before a column was indexed gets the index
      SQL.exec!(world.conn, Component.index_sql(component))
      {:ok, world}
    end
  end

  defp define_table(world, %Component{name: name} = component) do
    case world.components do
      %{^name => existing} ->
        if Component.to_json(existing) == Component.to_json(component),
          do: {:ok, world},
          else: change(world, existing, component)

      _ ->
        SQL.exec!(world.conn, Component.create_sql(component))

        SQL.run!(world.conn, "INSERT INTO ecs_components (name, columns) VALUES (?1, ?2)", [
          name,
          Component.to_json(component)
        ])

        {:ok, %{world | components: Map.put(world.components, name, component)}}
    end
  end

  # A definition that differs from the stored one: its compatible changes
  # are made to the table in place (`OdgnEcs.Component.changes/2`)
  defp change(world, existing, %Component{name: name} = component) do
    case Component.changes(existing, component) do
      {:ok, changes} ->
        table = SQL.ident(Component.table(component))

        for change <- changes do
          case change do
            {:add, col} ->
              SQL.exec!(
                world.conn,
                "ALTER TABLE #{table} ADD COLUMN #{Component.sql_column(col)}"
              )

              fill(world, table, component, col, "")

            {:fill, col} ->
              fill(world, table, component, col, " WHERE #{SQL.ident(col.name)} IS NULL")

            {:drop, column} ->
              # SQLite won't drop an indexed column
              SQL.exec!(
                world.conn,
                "DROP INDEX IF EXISTS #{SQL.ident("i_#{Component.table(component)}_#{column}")}"
              )

              case SQL.exec(world.conn, "ALTER TABLE #{table} DROP COLUMN #{SQL.ident(column)}") do
                :ok ->
                  :ok

                {:error, error} ->
                  throw(
                    {:incompatible,
                     "Component '#{name}' can't drop column '#{column}': #{error.message}"}
                  )
              end
          end
        end

        SQL.run!(world.conn, "UPDATE ecs_components SET columns = ?2 WHERE name = ?1", [
          name,
          Component.to_json(component)
        ])

        {:ok, %{world | components: Map.put(world.components, name, component)}}

      {:error, reason} ->
        {:error, Error.new(:incompatible_change, reason)}
    end
  catch
    {:incompatible, reason} -> {:error, Error.new(:incompatible_change, reason)}
  end

  defp fill(world, table, component, col, where) do
    case Component.stored_default(component, col) do
      {:ok, nil} ->
        :ok

      {:ok, value} ->
        SQL.run!(world.conn, "UPDATE #{table} SET #{SQL.ident(col.name)} = ?1#{where}", [value])
    end
  end

  @doc "The component definition called `name`, or `nil`."
  @spec component(t(), String.t()) :: Component.t() | nil
  def component(%__MODULE__{components: components}, name), do: Map.get(components, name)

  # -- Entities ---------------------------------------------------------------

  @doc "Makes an entity with no components."
  @spec create(t()) :: {:ok, eid()}
  def create(%__MODULE__{conn: conn}) do
    SQL.run!(conn, "INSERT INTO entities DEFAULT VALUES")
    [eid] = SQL.one!(conn, "SELECT last_insert_rowid()")
    {:ok, eid}
  end

  @doc "Deletes an entity and its components."
  @spec delete(t(), eid()) :: :ok
  def delete(%__MODULE__{conn: conn}, eid) do
    SQL.run!(conn, "DELETE FROM entities WHERE eid = ?1", [eid])
  end

  @doc "Whether the entity exists."
  @spec exists?(t(), eid()) :: boolean()
  def exists?(%__MODULE__{conn: conn}, eid) do
    SQL.one!(conn, "SELECT 1 FROM entities WHERE eid = ?1", [eid]) != nil
  end

  @doc """
  Gives an entity a component, replacing it whole if it has it already.
  Properties missing from `data` take their defaults.
  """
  @spec put(t(), eid(), String.t(), data()) :: :ok | {:error, Error.t()}
  def put(%__MODULE__{} = world, eid, name, data) do
    with {:ok, c} <- fetch_component(world, name),
         :ok <- check_exists(world, eid),
         {:ok, values} <- Component.encode(c, data) do
      cols = Enum.map(["eid" | Enum.map(c.columns, & &1.name)], &SQL.ident/1)
      params = Enum.map_join(1..length(cols), ", ", &"?#{&1}")

      # An upsert, not INSERT OR REPLACE, which would delete another
      # entity's row to satisfy a unique column
      updates =
        case tl(cols) do
          [] -> "NOTHING"
          rest -> "UPDATE SET " <> Enum.map_join(rest, ", ", &"#{&1} = excluded.#{&1}")
        end

      sql =
        "INSERT INTO #{SQL.ident(Component.table(c))} (#{Enum.join(cols, ", ")}) VALUES (#{params}) " <>
          "ON CONFLICT(eid) DO #{updates}"

      case Sqlite3.prepare(world.conn, sql) do
        {:ok, stmt} ->
          try do
            :ok = Sqlite3.bind(stmt, [eid | values])

            case Sqlite3.step(world.conn, stmt) do
              :done ->
                :ok

              {:error, reason} ->
                {:error, Error.new(:constraint, "Component '#{name}': #{reason}")}
            end
          after
            Sqlite3.release(world.conn, stmt)
          end

        {:error, reason} ->
          {:error, Error.new(:sqlite, inspect(reason))}
      end
    end
  end

  @doc "Takes a component from an entity."
  @spec remove(t(), eid(), String.t()) :: :ok | {:error, Error.t()}
  def remove(%__MODULE__{} = world, eid, name) do
    with {:ok, c} <- fetch_component(world, name) do
      SQL.run!(world.conn, "DELETE FROM #{SQL.ident(Component.table(c))} WHERE eid = ?1", [eid])
    end
  end

  @doc "An entity's component, or `nil` if it has none by that name."
  @spec get(t(), eid(), String.t()) :: data() | nil
  def get(%__MODULE__{} = world, eid, name) do
    case component(world, name) do
      nil ->
        nil

      c ->
        cols = Enum.map_join(c.columns, ", ", &SQL.ident(&1.name))
        select = if cols == "", do: "1", else: cols

        case SQL.one!(
               world.conn,
               "SELECT #{select} FROM #{SQL.ident(Component.table(c))} WHERE eid = ?1",
               [eid]
             ) do
          nil -> nil
          row -> Component.decode(c, if(cols == "", do: [], else: row))
        end
    end
  end

  @doc "Every component an entity has, by name."
  @spec components(t(), eid()) :: %{String.t() => data()}
  def components(%__MODULE__{} = world, eid) do
    case select(world, Map.keys(world.components), eids: [eid]) do
      [{^eid, data}] -> data
      [] -> %{}
    end
  end

  # -- Queries ----------------------------------------------------------------

  # SQLite joins at most 64 tables in one statement
  @max_joins 60

  @ops [:==, :!=, :<, :<=, :>, :>=, :in]

  @doc """
  The entities that match every option, in id order unless `:order_by` says
  otherwise. With no options, every entity.

    * `:with` - components every result has.
    * `:where` - conditions that all hold. `{component, property, value}`
      tests equality, and a `nil` value matches a missing one.
      `{component, property, op, value}` takes an `op` from `:==`, `:!=`,
      `:<`, `:<=`, `:>`, `:>=` and `:in` (with a list). A condition implies
      its component.
    * `:eids` - only these entities.
    * `:order_by` - `{component, property}` or `{component, property, :desc}`,
      or a list of them. Entity id breaks ties.
    * `:limit` - at most this many.
  """
  @spec query(t(), keyword()) :: [eid()]
  def query(%__MODULE__{} = world, opts \\ []) do
    case plan(world, [], opts) do
      nil -> []
      {sql, args, _} -> world.conn |> SQL.all!(sql, args) |> Enum.map(&hd/1)
    end
  end

  @doc """
  The entities `query/2` finds for `opts`, each with its data for the
  components in `names` that it has: `[{eid, %{name => data}}]`. One
  statement reads them all.
  """
  @spec select(t(), [String.t()], keyword()) :: [{eid(), %{String.t() => data()}}]
  def select(%__MODULE__{} = world, names, opts \\ []) do
    names = names |> Enum.uniq() |> Enum.filter(&component(world, &1))

    if length(names) > @max_joins do
      names
      |> Enum.chunk_every(@max_joins)
      |> Enum.map(&select(world, &1, opts))
      |> Enum.zip_with(fn parts ->
        {eid, _} = hd(parts)
        {eid, parts |> Enum.map(&elem(&1, 1)) |> Enum.reduce(&Map.merge/2)}
      end)
    else
      case plan(world, names, opts) do
        nil -> []
        {sql, args, read} -> world.conn |> SQL.all!(sql, args) |> Enum.map(read)
      end
    end
  end

  # The SQL for a query, its arguments, and how to read a row into
  # `{eid, data}`; `nil` when a component it requires isn't defined, so
  # nothing can match.
  defp plan(world, selected, opts) do
    where = opts |> Keyword.get(:where, []) |> Enum.map(&condition/1)
    order_by = opts |> Keyword.get(:order_by, []) |> List.wrap() |> Enum.map(&order/1)
    required = Enum.uniq(Keyword.get(opts, :with, []) ++ Enum.map(where, &elem(&1, 0)))

    if Enum.any?(required, &is_nil(component(world, &1))) do
      nil
    else
      optional =
        (selected ++ Enum.map(order_by, &elem(&1, 0)))
        |> Enum.uniq()
        |> Enum.reject(&(&1 in required))

      names = required ++ optional
      alias_of = names |> Enum.with_index() |> Map.new(fn {n, i} -> {n, "t#{i}"} end)

      joins =
        Enum.map_join(names, "", fn name ->
          kind = if name in required, do: "JOIN", else: "LEFT JOIN"
          a = alias_of[name]
          " #{kind} #{SQL.ident(Component.table(name))} #{a} ON #{a}.eid = e.eid"
        end)

      {conds, args} =
        where
        |> Enum.map(fn {name, prop, op, value} ->
          col = fetch_column!(world, name, prop)
          sql_condition("#{alias_of[name]}.#{SQL.ident(prop)}", op, col, value)
        end)
        |> Enum.unzip()

      {conds, args} =
        case Keyword.fetch(opts, :eids) do
          {:ok, eids} ->
            {conds ++ ["e.eid IN (SELECT value FROM json_each(?))"],
             args ++ [[JSON.encode!(eids)]]}

          :error ->
            {conds, args}
        end

      args = List.flatten(args)

      where_sql = if conds == [], do: "", else: " WHERE " <> Enum.join(conds, " AND ")

      order_sql =
        order_by
        |> Enum.map(fn {name, prop, dir} ->
          fetch_column!(world, name, prop)
          "#{alias_of[name]}.#{SQL.ident(prop)} #{if dir == :desc, do: "DESC", else: "ASC"}"
        end)
        |> Kernel.++(["e.eid"])
        |> Enum.join(", ")

      {limit_sql, args} =
        case Keyword.fetch(opts, :limit) do
          {:ok, n} when is_integer(n) and n >= 0 -> {" LIMIT ?", args ++ [n]}
          {:ok, n} -> raise ArgumentError, "Bad query limit: #{inspect(n)}"
          :error -> {"", args}
        end

      defs = Enum.map(selected, &component(world, &1))

      cols =
        Enum.flat_map(defs, fn c ->
          a = alias_of[c.name]
          ["#{a}.eid" | Enum.map(c.columns, &"#{a}.#{SQL.ident(&1.name)}")]
        end)

      sql =
        "SELECT #{Enum.join(["e.eid" | cols], ", ")} FROM entities e#{joins}" <>
          "#{where_sql} ORDER BY #{order_sql}#{limit_sql}"

      {sql, args, &read_row(defs, &1)}
    end
  end

  defp condition({name, prop, value}), do: {name, prop, :==, value}
  defp condition({name, prop, op, value}) when op in @ops, do: {name, prop, op, value}

  defp condition(other),
    do: raise(ArgumentError, "Unknown query condition: #{inspect(other)}")

  defp order({name, prop}), do: {name, prop, :asc}
  defp order({name, prop, dir}) when dir in [:asc, :desc], do: {name, prop, dir}
  defp order(other), do: raise(ArgumentError, "Unknown query order: #{inspect(other)}")

  defp fetch_column!(world, name, prop) do
    case component(world, name) && Enum.find(component(world, name).columns, &(&1.name == prop)) do
      nil -> raise ArgumentError, "Component '#{name}' has no property '#{prop}'."
      col -> col
    end
  end

  defp sql_condition(lhs, :==, col, value),
    do: {"#{lhs} IS ?", [Component.query_value(col, value)]}

  defp sql_condition(lhs, :!=, col, value),
    do: {"#{lhs} IS NOT ?", [Component.query_value(col, value)]}

  defp sql_condition(lhs, :in, col, values) when is_list(values) do
    {"#{lhs} IN (SELECT value FROM json_each(?))",
     [JSON.encode!(Enum.map(values, &Component.query_value(col, &1)))]}
  end

  defp sql_condition(lhs, op, col, value) when op in [:<, :<=, :>, :>=] do
    {"#{lhs} #{op} ?", [Component.query_value(col, value)]}
  end

  defp sql_condition(_lhs, op, _col, value),
    do: raise(ArgumentError, "Bad value for #{inspect(op)}: #{inspect(value)}")

  defp read_row(defs, [eid | values]) do
    {data, []} =
      Enum.reduce(defs, {%{}, values}, fn c, {acc, vals} ->
        {[present | row], rest} = Enum.split(vals, length(c.columns) + 1)
        acc = if present == nil, do: acc, else: Map.put(acc, c.name, Component.decode(c, row))
        {acc, rest}
      end)

    {eid, data}
  end

  # -- Transactions -----------------------------------------------------------

  @doc "Starts a transaction."
  def begin(%__MODULE__{conn: conn}), do: SQL.exec(conn, "BEGIN IMMEDIATE")

  @doc "Commits the transaction."
  def commit(%__MODULE__{conn: conn}), do: SQL.exec(conn, "COMMIT")

  @doc "Rolls back the transaction."
  def rollback(%__MODULE__{conn: conn}), do: SQL.exec(conn, "ROLLBACK")

  @doc """
  Opens a savepoint. Outside a transaction, a savepoint starts one, and
  releasing it commits.
  """
  def savepoint(%__MODULE__{conn: conn}, name), do: SQL.exec(conn, "SAVEPOINT #{SQL.ident(name)}")

  @doc "Keeps the changes since the savepoint, and closes it."
  def release(%__MODULE__{conn: conn}, name), do: SQL.exec(conn, "RELEASE #{SQL.ident(name)}")

  @doc "Undoes the changes since the savepoint, and closes it."
  def rollback_to(%__MODULE__{conn: conn}, name) do
    with :ok <- SQL.exec(conn, "ROLLBACK TO #{SQL.ident(name)}"),
         do: SQL.exec(conn, "RELEASE #{SQL.ident(name)}")
  end

  @doc """
  Runs `fun` inside a savepoint: released if it returns `:ok` or `{:ok, _}`,
  rolled back otherwise, or if it raises.
  """
  def in_savepoint(%__MODULE__{} = world, name, fun) do
    :ok = savepoint(world, name)

    result =
      try do
        fun.()
      rescue
        e ->
          rollback_to(world, name)
          reraise e, __STACKTRACE__
      end

    case result do
      ok when ok == :ok or (is_tuple(ok) and elem(ok, 0) == :ok) ->
        :ok = release(world, name)
        result

      other ->
        :ok = rollback_to(world, name)
        other
    end
  end

  # -- Helpers ----------------------------------------------------------------

  defp fetch_component(world, name) do
    case component(world, name) do
      nil -> {:error, Error.new(:unknown_component, "No component '#{name}' is defined.")}
      c -> {:ok, c}
    end
  end

  defp check_exists(world, eid) do
    if exists?(world, eid),
      do: :ok,
      else: {:error, Error.new(:unknown_entity, "No entity #{eid}.")}
  end
end
