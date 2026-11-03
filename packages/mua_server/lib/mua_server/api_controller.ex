defmodule MuaServer.ApiController do
  @moduledoc """
  The signed-in Account's session (its email, whether it is an admin, its
  Characters, and a token for the Channel socket), and making its Character.
  """
  use Phoenix.Controller, formats: [:json]

  def session(conn, _params) do
    with_account(conn, fn account ->
      email = get_session(conn, :email)

      json(conn, %{
        account: account,
        email: email,
        admin: MuaServer.Admission.admin?(email),
        characters: MuaWorld.characters(MuaServer.World, account),
        socket_token: Phoenix.Token.sign(MuaServer.Endpoint, "socket", account)
      })
    end)
  end

  @doc "Makes the Account's Character with a chosen public name; one per Account for now."
  def create_character(conn, %{"name" => name}) do
    with_account(conn, fn account ->
      if MuaWorld.characters(MuaServer.World, account) != [] do
        conn |> put_status(:conflict) |> json(%{error: "already_has_character"})
      else
        case MuaWorld.create_character(MuaServer.World, account, name) do
          {:ok, eid} -> conn |> put_status(:created) |> json(%{id: eid, name: String.trim(name)})
          {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end
      end
    end)
  end

  def create_character(conn, _),
    do: conn |> put_status(:bad_request) |> json(%{error: "name_required"})

  defp with_account(conn, fun) do
    case get_session(conn, :account) do
      account when is_integer(account) -> fun.(account)
      _ -> conn |> put_status(:unauthorized) |> json(%{error: "not_signed_in"})
    end
  end
end
