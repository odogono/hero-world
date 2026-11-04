defmodule OdgnEdl.Build do
  @moduledoc false
  # A Build: the Migration of an empty World (ADR 0007), which also makes the
  # EDL's anonymous entities.

  alias OdgnEdl.{Error, Migrate, Record}

  def run(%OdgnEcs{} = world, source, definitions, opts) do
    world = Record.ensure(world)

    if Record.built?(world) do
      {:error,
       Error.new(
         :already_built,
         "This World has already been built from an EDL; a changed EDL needs a Migration"
       )}
    else
      with {:ok, world, _plan} <-
             Migrate.run(world, source, definitions, Keyword.put(opts, :build, true)),
           do: {:ok, world}
    end
  end

  @doc false
  def hash(source), do: Migrate.hash(source)
end
