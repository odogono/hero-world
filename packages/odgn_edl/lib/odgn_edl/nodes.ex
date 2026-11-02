defmodule OdgnEdl.Atom do
  @moduledoc "A named template of components that entities and other atoms extend."
  defstruct name: nil, extends: [], components: %{}

  @type t :: %__MODULE__{
          name: String.t(),
          extends: [String.t()],
          components: OdgnEdl.components()
        }
end

defmodule OdgnEdl.Entity do
  @moduledoc """
  An entity the EDL describes. `name` is its Definition name, or `nil` for an
  anonymous entity; `was` is the name it had before a rename.
  """
  defstruct name: nil, was: nil, extends: [], components: %{}

  @type t :: %__MODULE__{
          name: String.t() | nil,
          was: String.t() | nil,
          extends: [String.t()],
          components: OdgnEdl.components()
        }
end

defmodule OdgnEdl.ComponentDef do
  @moduledoc "A component definition: a `def` block declaring a component's columns."
  defstruct name: nil, columns: []

  @type t :: %__MODULE__{name: String.t(), columns: [OdgnEdl.Column.t()]}
end

defmodule OdgnEdl.Column do
  @moduledoc """
  One column of a component definition. `default` is kept as written (a raw
  string), except for a `json` column, whose default is the decoded value.
  """
  defstruct name: nil, type: nil, optional: true, unique: false, default: nil

  @type t :: %__MODULE__{
          name: String.t(),
          type: String.t(),
          optional: boolean(),
          unique: boolean(),
          default: term()
        }
end

defmodule OdgnEdl.Ref do
  @moduledoc """
  A reference to another definition: `$name` is the entity itself, and
  `$name.component.property` (with integer steps into arrays) is a value of it.
  """
  defstruct name: nil, path: []

  @type t :: %__MODULE__{name: String.t(), path: [String.t() | non_neg_integer()]}
end
