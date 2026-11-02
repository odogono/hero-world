defmodule OdgnEdl do
  @moduledoc """
  The Entity Definition Language: atoms, entities and component definitions
  written as text.

  `parse/1` turns EDL source into `OdgnEdl.Atom`, `OdgnEdl.Entity` and
  `OdgnEdl.ComponentDef` structs, in source order. Component and property
  names are kept exactly as written, and references are `OdgnEdl.Ref`s, left
  for Build to resolve.
  """

  alias OdgnEdl.{Error, Parser}

  @type value ::
          String.t()
          | number()
          | boolean()
          | nil
          | OdgnEdl.Ref.t()
          | [value()]
          | %{String.t() => value()}
  @type components :: %{String.t() => %{String.t() => value()}}
  @type definition :: OdgnEdl.Atom.t() | OdgnEdl.Entity.t() | OdgnEdl.ComponentDef.t()

  @doc "Parses EDL source into its definitions."
  @spec parse(String.t()) :: {:ok, [definition()]} | {:error, Error.t()}
  def parse(source) when is_binary(source) do
    with :ok <- reject_commands(source) do
      case Parser.edl(source) do
        {:ok, definitions, "", _, _, _} ->
          {:ok, definitions}

        {:error, _reason, rest, _, {line, line_offset}, offset} ->
          column = offset - line_offset + 1
          near = rest |> String.split("\n", parts: 2) |> hd() |> String.trim()

          {:error,
           %Error{
             kind: :syntax,
             line: line,
             column: column,
             message: "EDL syntax error at line #{line}, column #{column}: #{near}"
           }}
      end
    end
  end

  @doc "Parses EDL source, raising `OdgnEdl.Error` if it is invalid."
  @spec parse!(String.t()) :: [definition()]
  def parse!(source) do
    case parse(source) do
      {:ok, definitions} -> definitions
      {:error, error} -> raise error
    end
  end

  # EDL commands were removed (ADR 0007); name the line rather than report a
  # bare syntax error.
  defp reject_commands(source) do
    source
    |> String.split(~r/\r?\n/)
    |> Enum.with_index(1)
    |> Enum.find_value(:ok, fn {line, n} ->
      trimmed = line |> Parser.strip_comment() |> String.trim()

      if String.starts_with?(trimmed, "!") do
        {:error,
         %Error{
           kind: :command,
           line: n,
           column: 1,
           message:
             "EDL has no commands, at line #{n}: #{trimmed}\n" <>
               "write the value inline on the entity or atom instead"
         }}
      end
    end)
  end
end
