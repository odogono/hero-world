defmodule OdgnEcs.Column do
  @moduledoc """
  One column of a component: a property every entity with the component has.
  `optional: false` means it must have a value, from the data or `default`.
  """
  defstruct name: nil, type: :string, optional: true, unique: false, default: nil

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
          default: term()
        }

  @types ~w(string email enum datetime date time timestamp int float boolean eid json array)a

  @doc "The column types, as atoms."
  def types, do: @types
end

defmodule OdgnEcs.Component do
  @moduledoc """
  A component definition: a name and its columns. Each component is stored in
  its own table, one row per entity that has it.
  """
  alias OdgnEcs.{Column, Error}

  defstruct name: nil, columns: []

  @type t :: %__MODULE__{name: String.t(), columns: [Column.t()]}

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

      length(Enum.uniq(names)) != length(names) ->
        {:error, Error.new(:invalid_component, "Component '#{name}' defines a column twice.")}

      true ->
        :ok
    end
  end

  defp identifier?(s), do: is_binary(s) and Regex.match?(~r/^[A-Za-z_][A-Za-z0-9_]*$/, s)

  @doc false
  def create_sql(%__MODULE__{} = c) do
    cols =
      Enum.map(c.columns, fn col ->
        OdgnEcs.SQL.ident(col.name) <>
          " " <> sql_type(col.type) <> if(col.unique, do: " UNIQUE", else: "")
      end)

    "CREATE TABLE #{OdgnEcs.SQL.ident(table(c))} (" <>
      Enum.join(
        ["eid INTEGER PRIMARY KEY REFERENCES entities(eid) ON DELETE CASCADE" | cols],
        ", "
      ) <>
      ")"
  end

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
  def to_json(%__MODULE__{columns: columns}) do
    columns
    |> Enum.map(fn c ->
      %{
        "name" => c.name,
        "type" => Atom.to_string(c.type),
        "optional" => c.optional,
        "unique" => c.unique,
        "default" => c.default
      }
    end)
    |> JSON.encode!()
  end

  @doc false
  def from_json(name, json) do
    columns =
      for c <- JSON.decode!(json) do
        %Column{
          name: c["name"],
          type: String.to_existing_atom(c["type"]),
          optional: c["optional"],
          unique: c["unique"],
          default: c["default"]
        }
      end

    %__MODULE__{name: name, columns: columns}
  end
end
