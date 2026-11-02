import Config

# The World and sign-in, from the environment. Tests set their own.
if config_env() != :test do
  config :mua_server,
    world: [
      path: System.get_env("MUA_DB", "data/world.db"),
      edl: System.get_env("MUA_EDL") || Path.join(:code.priv_dir(:mua_world), "edl/main.edl"),
      starting_room: System.get_env("MUA_STARTING_ROOM", "west_of_house")
    ],
    allowlist:
      System.get_env("MUA_ALLOWLIST", "")
      |> String.split(",", trim: true)
      |> Enum.map(&(&1 |> String.trim() |> String.downcase())),
    google: [
      client_id: System.get_env("GOOGLE_CLIENT_ID"),
      client_secret: System.get_env("GOOGLE_CLIENT_SECRET"),
      redirect_uri:
        System.get_env("GOOGLE_REDIRECT_URI", "http://localhost:4000/auth/google/callback")
    ]
end

if config_env() == :prod do
  config :mua_server, MuaServer.Endpoint,
    http: [port: String.to_integer(System.get_env("PORT", "4000"))],
    secret_key_base: System.fetch_env!("SECRET_KEY_BASE"),
    server: true
end
