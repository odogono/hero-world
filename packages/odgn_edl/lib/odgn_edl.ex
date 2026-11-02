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
  Brings a World built from an EDL up to date with a changed one, keeping
  its players, Play state and time (ADR 0005, 0006, 0008). Returns the World
  and an `OdgnEdl.Plan` of what changed.

  - A component still as the EDL last set it gets the EDL's new value; one
    play changed since is kept, and listed in the plan's `kept`.
  - A static component the EDL no longer sets is removed; a Play state one
    stays.
  - `entity b was a` renames `a`, keeping its id and state.
  - Entities the EDL doesn't name, such as those made in play, are never
    touched, and neither is anything outside the ECS.

  It runs in one savepoint, so on an error nothing changes. Options:

    * `:path` - the `.edl` file's path, as for `build/3`.
    * `:dry_run` - work out the plan, then roll everything back.
    * `:prune` - a function called with each entity whose Definition name is
      gone from the EDL, to take it out of play; its Definition name is then
      forgotten. Without it such entities are only listed.
    * `:finish` - a function of the migrated World and the plan, run inside
      the savepoint before it is kept (or, on a dry run, rolled back), for a
      caller's own changes and checks. Returning `{:error, reason}` rolls the
      Migration back and returns a `:check_failed` error.
  """
  @spec migrate(OdgnEcs.t(), String.t(), keyword()) ::
          {:ok, OdgnEcs.t(), OdgnEdl.Plan.t()} | {:error, Error.t()}
  def migrate(%OdgnEcs{} = world, source, opts \\ []) do
    with {:ok, definitions} <- parse(source) do
      OdgnEdl.Migrate.run(world, source, definitions, Keyword.delete(opts, :build))
    end
  end

  @doc "Whether `source` differs from the EDL the World was built or last migrated from."
  @spec changed?(OdgnEcs.t(), String.t()) :: boolean()
  def changed?(%OdgnEcs{} = world, source),
    do: OdgnEdl.Record.hash(world) != OdgnEdl.Migrate.hash(source)

  @doc """
  Builds the World from EDL if it is empty, or resumes it if it was built or
  last migrated from this same EDL: a World is built once, then resumed
  (ADR 0004). A World whose EDL has changed needs `migrate/3` first, so this
  is a `:migration_needed` error.
  """
  @spec load(OdgnEcs.t(), String.t(), keyword()) ::
          {:ok, OdgnEcs.t(), :built | :resumed} | {:error, Error.t()}
  def load(%OdgnEcs{} = world, source, opts \\ []) do
    case OdgnEdl.Record.hash(world) do
      nil ->
        with {:ok, world} <- build(world, source, opts), do: {:ok, world, :built}

      hash ->
        if hash == OdgnEdl.Migrate.hash(source) do
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
