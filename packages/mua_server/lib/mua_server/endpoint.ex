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

  plug(Plug.RequestId)
  plug(Plug.Parsers, parsers: [:urlencoded, :json], pass: ["*/*"], json_decoder: Jason)
  plug(Plug.MethodOverride)
  plug(Plug.Head)
  plug(Plug.Session, @session)
  plug(MuaServer.Router)
end
