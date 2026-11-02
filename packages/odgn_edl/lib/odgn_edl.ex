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

  # -- Build ------------------------------------------------------------------

  @doc """
  Builds an empty World from EDL: defines its components, makes its entities
  and records what the EDL set. It runs in one savepoint, so on an error
  nothing changes. Like every change, it is durable once the caller commits
  (or, outside a transaction, as soon as it returns).

  `:path` is the `.edl` file's path, which `script { src: }` values are
  resolved against.
  """
  @spec build(OdgnEcs.t(), String.t(), keyword()) :: {:ok, OdgnEcs.t()} | {:error, Error.t()}
  def build(%OdgnEcs{} = world, source, opts \\ []) do
    with {:ok, definitions} <- parse(source) do
      OdgnEdl.Build.run(world, source, definitions, opts)
    end
  end

  @doc """
  Builds the World from EDL if it is empty, or resumes it if it was built from
  this same EDL: a World is built once, then resumed (ADR 0004). A World built
  from a different EDL needs a Migration, which this does not do yet.
  """
  @spec load(OdgnEcs.t(), String.t(), keyword()) ::
          {:ok, OdgnEcs.t(), :built | :resumed} | {:error, Error.t()}
  def load(%OdgnEcs{} = world, source, opts \\ []) do
    case OdgnEdl.Record.hash(world) do
      nil ->
        with {:ok, world} <- build(world, source, opts), do: {:ok, world, :built}

      hash ->
        if hash == OdgnEdl.Build.hash(source) do
          {:ok, world, :resumed}
        else
          {:error,
           Error.new(
             :migration_needed,
             "The EDL has changed since this World was built; it needs a Migration"
           )}
        end
    end
  end

  defdelegate built?(world), to: OdgnEdl.Record
  defdelegate atom_lineage(world, name), to: OdgnEdl.Record
  defdelegate entity_lineage(world, eid), to: OdgnEdl.Record
  defdelegate script_owners(world), to: OdgnEdl.Record
  defdelegate definition_names(world), to: OdgnEdl.Record
  defdelegate entity_named(world, name), to: OdgnEdl.Record

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
