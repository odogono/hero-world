defmodule OdgnEdl.Error do
  @moduledoc """
  An EDL error. `kind` says what went wrong; `line` and `column` say where in
  the source, when that is known.
  """
  defexception [:kind, :message, :line, :column]

  @type kind :: :syntax | :command
  @type t :: %__MODULE__{
          kind: kind(),
          message: String.t(),
          line: pos_integer() | nil,
          column: pos_integer() | nil
        }
end
