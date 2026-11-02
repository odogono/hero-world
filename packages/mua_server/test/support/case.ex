defmodule MuaServer.ChannelCase do
  @moduledoc false
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import MuaServer.ChannelCase
      @endpoint MuaServer.Endpoint
    end
  end

  @doc "An Account signed in by email, with a Character of its own."
  def player(email, name) do
    {:ok, account} = MuaServer.Admission.admit("dev:" <> email, email, true)

    character =
      case MuaWorld.characters(MuaServer.World, account) do
        [%{id: id} | _] -> id
        [] -> elem(MuaWorld.create_character(MuaServer.World, account, name), 1)
      end

    %{account: account, character: character}
  end

  def token(account), do: Phoenix.Token.sign(MuaServer.Endpoint, "socket", account)
end
