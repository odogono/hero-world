defmodule MuaServer.UserSocket do
  @moduledoc """
  The WebSocket a browser plays through. It connects with the token from
  `GET /api/session`, which names the signed-in Account; an Account no longer
  admitted is refused.
  """
  use Phoenix.Socket

  channel("character:*", MuaServer.CharacterChannel)

  @max_age 24 * 60 * 60

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Phoenix.Token.verify(MuaServer.Endpoint, "socket", token, max_age: @max_age) do
      {:ok, account} -> {:ok, assign(socket, :account, account)}
      {:error, _} -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "account:#{socket.assigns.account}"
end
