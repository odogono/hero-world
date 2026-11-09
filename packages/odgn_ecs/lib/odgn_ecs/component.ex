defmodule OdgnEcs.Column do
  @moduledoc """
  One column of a component: a property every entity with the component has.
  `optional: false` means it must have a value, from the data or `default`.
  `index: true` makes queries on it fast; an `:eid` column (a Reference to
  another entity) is always indexed.

  `case_insensitive: true` makes a text column compare ignoring case, in
  queries and for `unique`.

  An `:eid` column must hold an entity that exists. `on_delete` says what
  deleting that entity does: `:restrict` (the default) refuses, `:nullify`
  empties the column, and `:cascade` deletes the entity holding it too.
  """
  defstruct name: nil,
            type: :string,
            optional: true,
            unique: false,
            default: nil,
            index: false,
            case_insensitive: false,
            on_delete: :restrict

  @type type ::
          :string
          | :email
          | :enum
          | :datetime
          | :date
          | :time
          | :timestamp
          | :int
          | :float
          | :boolean
          | :eid
          | :json
          | :array

  @type t :: %__MODULE__{
          name: String.t(),
          type: type(),
          optional: boolean(),
          unique: boolean(),
          default: term(),
          index: boolean(),
          case_insensitive: boolean(),
          on_delete: :restrict | :nullify | :cascade
        }

  @types ~w(string email enum datetime date time timestamp int float boolean eid json array)a
  @on_delete ~w(restrict nullify cascade)a

  @doc "The column types, as atoms."
  def types, do: @types

  @doc "What deleting a referenced entity can do, as atoms."
  def on_delete, do: @on_delete
end

defmodule OdgnEcs.Component do
  @moduledoc """
  A component definition: a name and its columns. Each component is stored in
  its own table, one row per entity that has it.

  `play_state` marks a component that play changes, such as whether a door
  is open; a Migration treats it differently from static components.
  `buildable` marks one a player may compose a new entity from, as a
  builder does in mua.
  """
  alias OdgnEcs.{Column, Error}

  defstruct name: nil, columns: [], play_state: false, buildable: false

  @type t :: %__MODULE__{
          name: String.t(),
          columns: [Column.t()],
          play_state: boolean(),
          buildable: boolean()
        }

  @reserved ~w(id eid)
  @time_now ~w(current_timestamp current_date current_time)

  @doc false
  def table(%__MODULE__{name: name}), do: table(name)
  def table(name) when is_binary(name), do: "c_" <> name

  @doc "Checks a definition before it is stored."
  def validate(%__MODULE__{name: name, columns: columns}) do
    names = Enum.map(columns, & &1.name)

    cond do
      not identifier?(name) ->
        {:error, Error.new(:invalid_component, "Component name '#{name}' is not an identifier.")}

      bad = Enum.find(columns, &(&1.name in @reserved)) ->
        {:error,
         Error.new(
           :reserved_column,
           "Component '#{name}' cannot define reserved column '#{bad.name}'."
         )}

      bad = Enum.find(columns, &(not identifier?(&1.name))) ->
        {:error,
         Error.new(
           :invalid_component,
           "Component '#{name}' column '#{bad.name}' is not an identifier."
         )}

      bad = Enum.find(columns, &(&1.type not in Column.types())) ->
        {:error,
         Error.new(
           :invalid_component,
           "Component '#{name}' column '#{bad.name}' has unknown type '#{bad.type}'."
         )}

      bad = Enum.find(columns, &(&1.on_delete not in Column.on_delete())) ->
        {:error,
         Error.new(
           :invalid_component,
           "Component '#{name}' column '#{bad.name}' has unknown on_delete '#{inspect(bad.on_delete)}'."
         )}

      length(Enum.uniq(names)) != length(names) ->
        {:error, Error.new(:invalid_component, "Component '#{name}' defines a column twice.")}

      true ->
        :ok
    end
  end

  defp identifier?(s), do: is_binary(s) and Regex.match?(~r/^[A-Za-z_][A-Za-z0-9_]*$/, s)

  @doc false
  def create_sql(%__MODULE__{} = c, table \\ nil) do
    cols =
      Enum.map(c.columns, fn col ->
        OdgnEcs.SQL.ident(col.name) <>
          " " <>
          sql_type(col.type) <>
          if(col.case_insensitive, do: " COLLATE NOCASE", else: "") <>
          if(col.unique, do: " UNIQUE", else: "") <> references(col)
      end)

    "CREATE TABLE #{OdgnEcs.SQL.ident(table || table(c))} (" <>
      Enum.join(
        ["eid INTEGER PRIMARY KEY REFERENCES entities(eid) ON DELETE CASCADE" | cols],
        ", "
      ) <>
      ")"
  end

  defp references(%Column{type: :eid, on_delete: on_delete}),
    do: " REFERENCES entities(eid) ON DELETE #{sql_action(on_delete)}"

  defp references(_col), do: ""

  # A cascade deletes the holding entity by trigger, so the key itself only
  # needs to stay out of the way
  defp sql_action(:restrict), do: "RESTRICT"
  defp sql_action(:nullify), do: "SET NULL"
  defp sql_action(:cascade), do: "CASCADE"

  @doc false
  # The foreign keys the table should have, as `{column, action}` pairs in
  # the form `PRAGMA foreign_key_list` gives them
  def foreign_keys(%__MODULE__{columns: columns}) do
    keys = for %Column{type: :eid} = col <- columns, do: {col.name, sql_action(col.on_delete)}
    MapSet.new([{"eid", "CASCADE"} | keys])
  end

  @doc false
  # Triggers that delete an entity holding a `:cascade` Reference to one
  # being deleted, and drop those of any other column, so it can run on
  # every definition
  def cascade_sql(%__MODULE__{} = c) do
    table = table(c)

    Enum.map_join(c.columns, " ", fn col ->
      trigger = OdgnEcs.SQL.ident("t_#{table}_#{col.name}")

      if col.type == :eid and col.on_delete == :cascade do
        "CREATE TRIGGER IF NOT EXISTS #{trigger} BEFORE DELETE ON entities BEGIN " <>
          "DELETE FROM entities WHERE eid IN " <>
          "(SELECT eid FROM #{OdgnEcs.SQL.ident(table)} WHERE #{OdgnEcs.SQL.ident(col.name)} = OLD.eid); END;"
      else
        "DROP TRIGGER IF EXISTS #{trigger};"
      end
    end)
  end

  @doc false
  # Temporary triggers, on this connection only, that note in
  # `temp.ecs_changes` each entity whose component is added, changed or
  # removed, and whether it had the component before (see
  # `OdgnEcs.take_changes/1`). Nothing is written to the World file.
  def change_sql(%__MODULE__{} = c) do
    table = OdgnEcs.SQL.ident(table(c))
    name = "'" <> String.replace(c.name, "'", "''") <> "'"
    trigger = &OdgnEcs.SQL.ident("ecs_changes_#{table(c)}_#{&1}")
    # The check for an entity already noted is the trigger's WHEN, not a WHERE
    # in its body: a trigger whose WHEN fails costs far less than one whose
    # body runs and inserts nothing, and most writes are to an entity already
    # noted. Not INSERT OR IGNORE: an outer statement's conflict policy
    # overrides it.
    fresh = &"NOT EXISTS (SELECT 1 FROM ecs_changes WHERE name = #{name} AND eid = #{&1})"

    note =
      &"BEGIN INSERT INTO ecs_changes (name, eid, existed) VALUES (#{name}, #{&1}, #{&2}); END;"

    differs =
      Enum.map_join(c.columns, " OR ", fn col ->
        col = OdgnEcs.SQL.ident(col.name)
        "OLD.#{col} IS NOT NEW.#{col}"
      end)

    "CREATE TEMP TRIGGER IF NOT EXISTS #{trigger.("i")} AFTER INSERT ON main.#{table} " <>
      "WHEN #{fresh.("NEW.eid")} #{note.("NEW.eid", 0)} " <>
      "CREATE TEMP TRIGGER IF NOT EXISTS #{trigger.("d")} AFTER DELETE ON main.#{table} " <>
      "WHEN #{fresh.("OLD.eid")} #{note.("OLD.eid", 1)}" <>
      if(differs == "",
        do: "",
        else:
          " CREATE TEMP TRIGGER IF NOT EXISTS #{trigger.("u")} AFTER UPDATE ON main.#{table} " <>
            "WHEN (#{differs}) AND #{fresh.("OLD.eid")} #{note.("OLD.eid", 1)}"
      )
  end

  @doc false
  # Drops the triggers of `change_sql/1`, so the table can change
  def drop_change_sql(%__MODULE__{} = c) do
    Enum.map_join(~w(i u d), " ", fn op ->
      "DROP TRIGGER IF EXISTS temp.#{OdgnEcs.SQL.ident("ecs_changes_#{table(c)}_#{op}")};"
    end)
  end

  @doc false
  # The SQL that gives each indexed column an index, and drops the index of
  # any other, so that it can run on every definition, changed or not.
  def index_sql(%__MODULE__{} = c) do
    table = table(c)

    Enum.map_join(c.columns, " ", fn col ->
      index = OdgnEcs.SQL.ident("i_#{table}_#{col.name}")

      if indexed?(col),
        do:
          "CREATE INDEX IF NOT EXISTS #{index} ON #{OdgnEcs.SQL.ident(table)} (#{OdgnEcs.SQL.ident(col.name)});",
        else: "DROP INDEX IF EXISTS #{index};"
    end)
  end

  defp indexed?(%Column{unique: true}), do: false
  defp indexed?(%Column{type: :eid}), do: true
  defp indexed?(%Column{index: index}), do: index == true

  @doc false
  def sql_column(%Column{} = col),
    do:
      OdgnEcs.SQL.ident(col.name) <>
        " " <> sql_type(col.type) <> if(col.case_insensitive, do: " COLLATE NOCASE", else: "")

  @doc """
  How the table of `existing` changes to hold `new`: `{:ok, changes}`, each
  `{:add, column}`, `{:drop, name}`, `{:fill, column}` (a column whose empty
  values take its default) or `:rebuild` (the table is made again, for a
  change SQLite can't make in place, such as to `unique`), or
  `{:error, reason}` for a change the data can't follow. Compatible: adding a column that is optional or has a default,
  removing one, making one optional, changing a default, `index` or
  `on_delete`, changing `unique` or `case_insensitive` where the data allows,
  and flipping `play_state` or `buildable`. Incompatible: changing a column's type, adding a
  unique column, and making one required with no default.
  """
  def changes(%__MODULE__{columns: old}, %__MODULE__{name: name, columns: new}) do
    old_by = Map.new(old, &{&1.name, &1})
    new_names = MapSet.new(new, & &1.name)

    new
    |> Enum.reduce_while({:ok, []}, fn col, {:ok, acc} ->
      case {Map.get(old_by, col.name), col} do
        {nil, %Column{unique: true}} ->
          {:halt, {:error, "Component '#{name}' can't add unique column '#{col.name}'."}}

        {nil, %Column{optional: false, default: nil}} ->
          {:halt,
           {:error,
            "Component '#{name}' can't add required column '#{col.name}' with no default."}}

        {nil, _} ->
          {:cont, {:ok, [{:add, col} | acc]}}

        {%Column{type: t}, %Column{type: t2}} when t != t2 ->
          {:halt,
           {:error,
            "Component '#{name}' column '#{col.name}' can't change type from #{t} to #{t2}."}}

        {%Column{unique: u, case_insensitive: ci}, %Column{unique: u2, case_insensitive: ci2}}
        when u != u2 or ci != ci2 ->
          {:cont, {:ok, [:rebuild | acc]}}

        {%Column{optional: true}, %Column{optional: false, default: nil}} ->
          {:halt,
           {:error,
            "Component '#{name}' column '#{col.name}' can't become required with no default."}}

        {%Column{optional: true}, %Column{optional: false}} ->
          {:cont, {:ok, [{:fill, col} | acc]}}

        _ ->
          {:cont, {:ok, acc}}
      end
    end)
    |> case do
      {:ok, acc} ->
        dropped = for c <- old, not MapSet.member?(new_names, c.name), do: {:drop, c.name}
        {:ok, Enum.reverse(acc) ++ dropped}

      error ->
        error
    end
  end

  @doc false
  # A column's default, as stored
  def stored_default(%__MODULE__{name: name}, %Column{} = col),
    do: encode_value(name, %{col | optional: true}, default(col))

  defp sql_type(t) when t in [:int, :eid, :boolean], do: "INTEGER"
  defp sql_type(:float), do: "REAL"
  defp sql_type(_), do: "TEXT"

  @doc """
  The component's values for `data`, in column order, ready to store:
  defaults filled in and every value checked against its column.
  """
  def encode(%__MODULE__{name: name} = c, data) when is_map(data) do
    known = MapSet.new(c.columns, & &1.name)

    case Enum.find(Map.keys(data), &(not MapSet.member?(known, &1))) do
      nil ->
        Enum.reduce_while(c.columns, {:ok, []}, fn col, {:ok, acc} ->
          case encode_value(name, col, Map.get(data, col.name, default(col))) do
            {:ok, v} -> {:cont, {:ok, [v | acc]}}
            error -> {:halt, error}
          end
        end)
        |> case do
          {:ok, values} -> {:ok, Enum.reverse(values)}
          error -> error
        end

      prop ->
        {:error, Error.new(:unknown_property, "Component '#{name}' has no property '#{prop}'.")}
    end
  end

  def encode(%__MODULE__{name: name}, _),
    do: {:error, Error.new(:invalid_value, "Component '#{name}' data must be a map.")}

  @doc "The component's data with defaults filled in, as it would be read back."
  def normalise(%__MODULE__{} = c, data) do
    with {:ok, values} <- encode(c, data), do: {:ok, decode(c, values)}
  end

  defp default(%Column{default: d}) when d in @time_now, do: now(d)
  defp default(%Column{default: d}), do: d

  defp now("current_timestamp"), do: DateTime.utc_now() |> DateTime.to_iso8601()
  defp now("current_date"), do: Date.utc_today() |> Date.to_iso8601()
  defp now("current_time"), do: Time.utc_now() |> Time.to_iso8601()

  defp encode_value(name, %Column{optional: false} = col, nil),
    do:
      {:error, Error.new(:missing_value, "Component '#{name}' needs a value for '#{col.name}'.")}

  defp encode_value(_name, _col, nil), do: {:ok, nil}

  defp encode_value(name, %Column{type: type} = col, v) do
    case {type, v} do
      {t, v} when t in [:int, :eid] and is_integer(v) ->
        {:ok, v}

      {:float, v} when is_number(v) ->
        {:ok, v / 1}

      {:boolean, v} when is_boolean(v) ->
        {:ok, if(v, do: 1, else: 0)}

      {:json, v} ->
        {:ok, JSON.encode!(v)}

      {:array, v} when is_list(v) ->
        {:ok, JSON.encode!(v)}

      {t, v}
      when t in [:string, :email, :enum, :datetime, :date, :time, :timestamp] and is_binary(v) ->
        {:ok, v}

      _ ->
        {:error,
         Error.new(
           :invalid_value,
           "Component '#{name}' '#{col.name}' must be #{type}, not #{inspect(v)}."
         )}
    end
  end

  @doc false
  # One stored value of a column, as it is compared in a query
  def query_value(%Column{type: :boolean}, v) when is_boolean(v), do: if(v, do: 1, else: 0)

  def query_value(%Column{type: t}, v) when t in [:json, :array] and not is_nil(v),
    do: JSON.encode!(v)

  def query_value(_, v), do: v

  @doc false
  def decode(%__MODULE__{columns: columns}, values) do
    columns
    |> Enum.zip(values)
    |> Map.new(fn {col, v} -> {col.name, decode_value(col.type, v)} end)
  end

  defp decode_value(_, nil), do: nil
  defp decode_value(:boolean, v), do: v == 1
  defp decode_value(:float, v), do: v / 1
  defp decode_value(t, v) when t in [:json, :array], do: JSON.decode!(v)
  defp decode_value(_, v), do: v

  @doc false
  def to_json(%__MODULE__{columns: columns, play_state: play_state, buildable: buildable}) do
    columns
    |> Enum.map(fn c ->
      %{
        "name" => c.name,
        "type" => Atom.to_string(c.type),
        "optional" => c.optional,
        "unique" => c.unique,
        "default" => c.default,
        "index" => c.index,
        "case_insensitive" => c.case_insensitive,
        "on_delete" => Atom.to_string(c.on_delete)
      }
    end)
    |> then(&%{"columns" => &1, "play_state" => play_state, "buildable" => buildable})
    |> JSON.encode!()
  end

  @doc false
  def from_json(name, json) do
    # Definitions stored before `play_state` are a bare list of columns, and
    # those stored before `buildable` don't say
    {stored, play_state, buildable} =
      case JSON.decode!(json) do
        %{"columns" => columns} = d -> {columns, d["play_state"] == true, d["buildable"] == true}
        columns when is_list(columns) -> {columns, false, false}
      end

    columns =
      for c <- stored do
        %Column{
          name: c["name"],
          type: String.to_existing_atom(c["type"]),
          optional: c["optional"],
          unique: c["unique"],
          default: c["default"],
          index: c["index"] == true,
          case_insensitive: c["case_insensitive"] == true,
          on_delete: String.to_existing_atom(c["on_delete"] || "restrict")
        }
      end

    %__MODULE__{name: name, columns: columns, play_state: play_state, buildable: buildable}
  end
end
