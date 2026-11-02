defmodule MuaServer.PageController do
  @moduledoc """
  Serves the browser client (`packages/mua_client`), which `bun run build`
  writes into `priv/static`.
  """
  use Phoenix.Controller, formats: [:html]

  def index(conn, _params) do
    path = Application.app_dir(:mua_server, "priv/static/index.html")

    if File.exists?(path) do
      conn |> put_resp_content_type("text/html") |> send_file(200, path)
    else
      send_resp(
        conn,
        404,
        "The browser client isn't built: run `bun run build` in packages/mua_client."
      )
    end
  end
end
