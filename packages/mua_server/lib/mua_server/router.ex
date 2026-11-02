defmodule MuaServer.Router do
  use Phoenix.Router

  pipeline :browser do
    plug(:accepts, ["html", "json"])
    plug(:fetch_session)
  end

  pipeline :api do
    plug(:accepts, ["json"])
    plug(:fetch_session)
  end

  scope "/auth", MuaServer do
    pipe_through(:browser)

    get("/google", AuthController, :google)
    get("/google/callback", AuthController, :callback)
    delete("/", AuthController, :sign_out)

    # A sign-in by email alone, for local development and tests; it is never
    # compiled into a release
    if Application.compile_env(:mua_server, :dev_sign_in, false) do
      post("/dev", AuthController, :dev)
    end
  end

  scope "/api", MuaServer do
    pipe_through(:api)

    get("/session", ApiController, :session)
    post("/character", ApiController, :create_character)
  end
end
