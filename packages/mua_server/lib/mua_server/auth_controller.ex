defmodule MuaServer.AuthController do
  @moduledoc """
  Google sign-in (ADR 0010), through `assent`'s OpenID Connect strategy. Only
  the identity's stable `sub` and its verified email are kept; an identity
  not on the allowlist is refused. Signing out drops the session.
  """
  use Phoenix.Controller, formats: [:json]

  alias MuaServer.Admission

  def google(conn, _params) do
    case strategy().authorize_url(google_config()) do
      {:ok, %{url: url, session_params: params}} ->
        conn |> put_session(:oauth, params) |> redirect(external: url)

      {:error, _} ->
        conn |> put_status(:bad_gateway) |> json(%{error: "sign-in unavailable"})
    end
  end

  def callback(conn, params) do
    config = Keyword.put(google_config(), :session_params, get_session(conn, :oauth))

    with {:ok, %{user: %{"sub" => sub} = user}} <- strategy().callback(config, params),
         {:ok, account} <- Admission.admit(sub, user["email"], user["email_verified"] == true) do
      conn |> delete_session(:oauth) |> signed_in(account)
    else
      {:error, :not_admitted} -> conn |> put_status(:forbidden) |> json(%{error: "not admitted"})
      _ -> conn |> put_status(:unauthorized) |> json(%{error: "sign-in failed"})
    end
  end

  @doc "The fake sign-in: an email stands in for a Google identity."
  def dev(conn, %{"email" => email}) do
    case Admission.admit("dev:" <> String.downcase(email), email, true) do
      {:ok, account} -> signed_in(conn, account)
      {:error, :not_admitted} -> conn |> put_status(:forbidden) |> json(%{error: "not admitted"})
    end
  end

  def sign_out(conn, _params), do: conn |> configure_session(drop: true) |> json(%{ok: true})

  defp signed_in(conn, account) do
    conn
    |> configure_session(renew: true)
    |> put_session(:account, account)
    |> json(%{account: account})
  end

  defp strategy, do: Application.fetch_env!(:mua_server, :oauth_strategy)
  defp google_config, do: Application.get_env(:mua_server, :google, [])
end
