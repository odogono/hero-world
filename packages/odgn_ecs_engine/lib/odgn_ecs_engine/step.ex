defmodule OdgnEcsEngine.Step do
  @moduledoc """
  The handle a Host's input gets while its Step runs: the World, its
  NorthTalk adapter, and the Step's World time (`now`, in milliseconds).
  Pass it to `OdgnEcsEngine.deliver/2`, `OdgnEcsEngine.ask/4` and
  `OdgnEcsEngine.pump/1`. It is good only for the Step it was given in.
  """
  @enforce_keys [:world, :talk, :now]
  defstruct [:world, :talk, :now, :table, :between]

  @type t :: %__MODULE__{world: OdgnEcs.t(), talk: OdgnEcsTalk.t(), now: integer()}
end
