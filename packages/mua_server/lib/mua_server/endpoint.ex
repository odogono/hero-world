defmodule MuaServer.Endpoint do
  use Phoenix.Endpoint, otp_app: :mua_server

  # Lax keeps the session cookie off cross-site POSTs, so the JSON API needs
  # no CSRF token.
  @session [
    store: :cookie,
    key: "_mua_session",
    signing_salt: "mua-session",
    same_site: "Lax",
    http_only: true
  ]

  socket("/socket", MuaServer.UserSocket, websocket: true, longpoll: false)

  # Every page is cross-origin isolated, so a Local World's Worker may use
  # sqlite-wasm in OPFS, which needs SharedArrayBuffer (ADR 0023). The client
  # loads nothing from another origin.
  plug(:isolate)

  # The browser client's bundle, built by packages/mua_client, and a Local
  # World's Worker beside it, in `local`
  plug(Plug.Static, at: "/", from: :mua_server, only: ~w(assets local))

  plug(Plug.RequestId)
  plug(Plug.Parsers, parsers: [:urlencoded, :json], pass: ["*/*"], json_decoder: Jason)
  plug(Plug.MethodOverride)
  plug(Plug.Head)
  plug(Plug.Session, @session)
  plug(MuaServer.Router)

  defp isolate(conn, _opts) do
    conn
    |> Plug.Conn.put_resp_header("cross-origin-opener-policy", "same-origin")
    |> Plug.Conn.put_resp_header("cross-origin-embedder-policy", "require-corp")
  end
end
