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
      # a browser arrives here from Google, so it goes back to the client
      conn |> delete_session(:oauth) |> sign_in(account, user["email"]) |> redirect(to: "/")
    else
      # a browser arrives here from Google, so it gets a page, not JSON
      {:error, :not_admitted} -> conn |> put_status(:forbidden) |> html(not_admitted_page())
      _ -> conn |> put_status(:unauthorized) |> json(%{error: "sign-in failed"})
    end
  end

  @doc "The fake sign-in: an email stands in for a Google identity."
  def dev(conn, %{"email" => email}) do
    case Admission.admit("dev:" <> String.downcase(email), email, true) do
      {:ok, account} -> conn |> sign_in(account, email) |> json(%{account: account})
      {:error, :not_admitted} -> conn |> put_status(:forbidden) |> json(%{error: "not admitted"})
    end
  end

  def sign_out(conn, _params), do: conn |> configure_session(drop: true) |> json(%{ok: true})

  defp sign_in(conn, account, email) do
    conn
    |> configure_session(renew: true)
    |> put_session(:account, account)
    |> put_session(:email, String.downcase(email))
  end

  defp not_admitted_page do
    """
    <!doctype html>
    <html lang="en">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Not invited</title>
    <style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
    </head>
    <body>
    <h1>This account isn't invited</h1>
    <p>mua is an invite-only alpha, and the Google account you signed in with isn't on its list.
    If you should be able to play, ask whoever invited you to add that address.</p>
    <p><a href="/auth/google">Try a different Google account</a></p>
    </body>
    </html>
    """
  end

  defp strategy, do: Application.fetch_env!(:mua_server, :oauth_strategy)
  defp google_config, do: Application.get_env(:mua_server, :google, [])
end
