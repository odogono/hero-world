defmodule OdgnEcsEngine.Delivery do
  @moduledoc """
  One message handed to an entity's Message Path, or to a Service Script,
  from outside Scripts.

    * `:to` - an entity id, or `{:service, name}`.
    * `:message` and `:args` - what is sent; args are NorthTalk values, such
      as an entity's Handle (`OdgnEcsTalk.handle/2`).
    * `:asks` - `:deliver` (the default) sends it and moves on; `:request`
      waits for a reply and `:decide` for a Decision (`OdgnEcsEngine.ask/4`).
      A Service Script can only be asked.
    * `:host` - a term the Delivery's Capability calls see
      (`OdgnEcsTalk.delivery/2`), such as the command it is part of.
  """
  @enforce_keys [:to, :message]
  defstruct to: nil, message: nil, args: [], asks: :deliver, host: nil

  @type t :: %__MODULE__{
          to: OdgnEcs.eid() | {:service, String.t()},
          message: String.t(),
          args: list(),
          asks: :deliver | :request | :decide,
          host: term()
        }
end
