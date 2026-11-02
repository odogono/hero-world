defmodule OdgnEdl.Error do
  @moduledoc """
  An EDL error. `kind` says what went wrong; `line` and `column` say where in
  the source, when that is known.
  """
  defexception [:kind, :message, :line, :column]

  @type kind ::
          :syntax
          | :command
          | :already_built
          | :migration_needed
          | :invalid_rename
          | :check_failed
          | :duplicate_name
          | :unknown_atom
          | :invalid_extend
          | :circular
          | :unknown_reference
          | :missing_component
          | :missing_property
          | :invalid_definition
          | :ecs

  @doc false
  def new(kind, message), do: %__MODULE__{kind: kind, message: message}

  @type t :: %__MODULE__{
          kind: kind(),
          message: String.t(),
          line: pos_integer() | nil,
          column: pos_integer() | nil
        }
end
