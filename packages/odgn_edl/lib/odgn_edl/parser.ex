defmodule OdgnEdl.Parser do
  @moduledoc false
  # The EDL grammar, ported rule by rule from packages/ecs/src/edl/edl.peggy.

  import NimbleParsec

  alias OdgnEdl.{Atom, Column, ComponentDef, Entity, Ref}

  # -- Whitespace and comments ------------------------------------------------

  comment = string("#") |> utf8_string([not: ?\n], min: 0)

  # `_`: any whitespace, including newlines and comments
  ws = ignore(repeat(choice([ascii_string([?\s, ?\t, ?\r, ?\n], min: 1), comment])))

  # `__`: at least one space on the same line
  sp = ignore(times(choice([ascii_string([?\s, ?\t], min: 1), comment]), min: 1))

  # -- Names and strings ------------------------------------------------------

  identifier =
    ascii_string([?A..?Z, ?a..?z, ?_], 1)
    |> ascii_string([?A..?Z, ?a..?z, ?0..?9, ?_], min: 0)
    |> reduce({Enum, :join, []})

  escapes = [
    {~S(\n), ?\n},
    {~S(\r), ?\r},
    {~S(\t), ?\t},
    {~S(\\), ?\\}
  ]

  quoted = fn quote ->
    escape_choices =
      [string("\\" <> <<quote>>) |> replace(quote)] ++
        Enum.map(escapes, fn {s, c} -> string(s) |> replace(c) end)

    ignore(string(<<quote>>))
    |> repeat(choice(escape_choices ++ [utf8_char(not: quote, not: ?\\)]))
    |> ignore(string(<<quote>>))
    |> reduce({List, :to_string, []})
  end

  string_lit = choice([quoted.(?"), quoted.(?')])
  name = choice([string_lit, identifier])

  # -- Values -----------------------------------------------------------------

  int_lit =
    optional(string("-"))
    |> ascii_string([?0..?9], min: 1)
    |> reduce({Enum, :join, []})
    |> map({String, :to_integer, []})

  float_lit =
    optional(string("-"))
    |> ascii_string([?0..?9], min: 1)
    |> string(".")
    |> ascii_string([?0..?9], min: 1)
    |> reduce({Enum, :join, []})
    |> map({String, :to_float, []})

  reference =
    ignore(string("$"))
    |> concat(identifier)
    |> repeat(
      ignore(string("."))
      |> choice([identifier, ascii_string([?0..?9], min: 1) |> map({String, :to_integer, []})])
    )
    |> reduce({__MODULE__, :to_ref, []})

  # Commas between elements are optional, and a trailing one is allowed
  sep = ws |> optional(ignore(string(","))) |> concat(ws)

  array =
    ignore(string("["))
    |> concat(ws)
    |> repeat(parsec(:value) |> concat(sep))
    |> ignore(string("]"))
    |> wrap()

  pair =
    choice([string_lit, identifier])
    |> concat(ws)
    |> ignore(string(":"))
    |> concat(ws)
    |> parsec(:value)

  object =
    ignore(string("{"))
    |> concat(ws)
    |> repeat(wrap(pair) |> concat(sep))
    |> ignore(string("}"))
    |> reduce({__MODULE__, :to_map, []})

  defcombinatorp(
    :value,
    choice([
      object,
      reference,
      array,
      string_lit,
      string("true") |> replace(true),
      string("false") |> replace(false),
      string("null") |> replace(nil),
      float_lit,
      int_lit
    ])
  )

  # -- Atoms and entities -----------------------------------------------------

  property = identifier |> concat(ws) |> ignore(string(":")) |> concat(ws) |> parsec(:value)

  component =
    identifier
    |> concat(ws)
    |> ignore(string("{"))
    |> concat(ws)
    |> repeat(wrap(property) |> concat(ws))
    |> ignore(string("}"))
    |> reduce({__MODULE__, :to_component, []})

  components =
    ignore(string("{"))
    |> concat(ws)
    |> repeat(component |> concat(ws))
    |> ignore(string("}"))
    |> reduce({__MODULE__, :to_map, []})
    |> unwrap_and_tag(:components)

  extends =
    ws
    |> ignore(string(":"))
    |> concat(ws)
    |> concat(name)
    |> repeat(ws |> concat(name))
    |> tag(:extends)

  atom_def =
    ignore(string("atom"))
    |> concat(sp)
    |> unwrap_and_tag(name, :name)
    |> optional(extends)
    |> concat(ws)
    |> concat(components)
    |> reduce({__MODULE__, :to_node, [Atom]})

  was = sp |> ignore(string("was")) |> concat(sp) |> unwrap_and_tag(name, :was)

  entity_def =
    ignore(string("entity"))
    |> choice([
      sp |> unwrap_and_tag(name, :name) |> optional(was) |> optional(extends),
      empty()
    ])
    |> concat(ws)
    |> concat(components)
    |> reduce({__MODULE__, :to_node, [Entity]})

  # -- Component definitions --------------------------------------------------

  json_column =
    identifier
    |> concat(ws)
    |> ignore(string(":"))
    |> concat(ws)
    |> string("json")
    |> concat(ws)
    |> ignore(string("default"))
    |> concat(ws)
    |> choice([object, array])
    |> reduce({__MODULE__, :to_json_column, []})

  column =
    identifier
    |> concat(ws)
    |> ignore(string(":"))
    |> concat(ws)
    |> concat(identifier)
    |> utf8_string([not: ?\n, not: ?\r, not: ?}], min: 0)
    |> reduce({__MODULE__, :to_column, []})

  component_def =
    ignore(string("def"))
    |> concat(sp)
    |> concat(identifier)
    |> concat(ws)
    |> ignore(string("{"))
    |> concat(ws)
    |> repeat(choice([json_column, column]) |> concat(ws))
    |> ignore(string("}"))
    |> reduce({__MODULE__, :to_component_def, []})

  defparsec(
    :edl,
    ws
    |> repeat(choice([atom_def, entity_def, component_def]) |> concat(ws))
    |> eos()
  )

  # -- Builders ---------------------------------------------------------------

  @doc false
  def to_ref([name | path]), do: %Ref{name: name, path: path}

  @doc false
  def to_map(pairs), do: Map.new(pairs, fn [k, v] -> {k, v} end)

  @doc false
  def to_component([name | props]), do: [name, to_map(props)]

  @doc false
  def to_node(fields, kind), do: struct(kind, fields)

  @doc false
  def to_json_column([name, type, default]), do: %Column{name: name, type: type, default: default}

  @doc false
  def to_column([name, type, rest]) do
    rest |> strip_comment() |> String.split() |> flags(%Column{name: name, type: type})
  end

  @doc false
  def to_component_def([name | columns]), do: %ComponentDef{name: name, columns: columns}

  defp flags([], col), do: col
  defp flags(["not", "null" | rest], col), do: flags(rest, %{col | optional: false})
  defp flags(["null" | rest], col), do: flags(rest, col)
  defp flags(["is_unique" | rest], col), do: flags(rest, %{col | unique: true})
  defp flags(["default"], col), do: col

  defp flags(["default" | value], col),
    do: %{col | default: default(col.type, Enum.join(value, " "))}

  defp flags([_ | rest], col), do: flags(rest, col)

  defp default("json", value) do
    case JSON.decode(value) do
      {:ok, decoded} -> decoded
      {:error, _} -> value
    end
  end

  defp default(_type, value), do: value

  @doc "Cuts a line at its first `#` outside double quotes."
  def strip_comment(line), do: strip_comment(line, false, "")

  defp strip_comment(<<>>, _q, acc), do: acc
  defp strip_comment(<<"\\\"", rest::binary>>, q, acc), do: strip_comment(rest, q, acc <> "\\\"")
  defp strip_comment(<<?", rest::binary>>, q, acc), do: strip_comment(rest, not q, acc <> "\"")
  defp strip_comment(<<?#, _::binary>>, false, acc), do: acc

  defp strip_comment(<<c::utf8, rest::binary>>, q, acc),
    do: strip_comment(rest, q, acc <> <<c::utf8>>)
end
