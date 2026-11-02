defmodule OdgnEcs.Error do
  @moduledoc "An ECS error. `kind` says what went wrong."
  defexception [:kind, :message]

  @type t :: %__MODULE__{kind: atom(), message: String.t()}

  @doc false
  def new(kind, message), do: %__MODULE__{kind: kind, message: message}
end
