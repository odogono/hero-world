defmodule MuaWorld.Scripts do
  @moduledoc """
  Where `packages/mua-scripts` is: the Base Verbs and Service Scripts every
  World shares (ADR 0024). It is `MUA_SCRIPTS_DIR` when set, else the
  `:scripts_dir` application setting, else its place beside this package in
  the repository.
  """

  @default Path.expand("../../../mua-scripts", __DIR__)

  @doc "The mua-scripts directory."
  def dir,
    do:
      System.get_env("MUA_SCRIPTS_DIR") || Application.get_env(:mua_world, :scripts_dir, @default)

  @doc "The EDL include roots a World is read with: `mua-scripts:`."
  def roots, do: %{"mua-scripts" => dir()}

  @doc "A file in mua-scripts."
  def path(relative), do: Path.join(dir(), relative)
end
