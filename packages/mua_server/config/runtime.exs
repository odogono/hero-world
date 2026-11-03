import Config

# Configuration from the environment, read when the server starts. Tests set
# their own.

env = config_env()

list = fn name ->
  System.get_env(name, "")
  |> String.split(",", trim: true)
  |> Enum.map(&(&1 |> String.trim() |> String.downcase()))
end

# In a release every one of these must be set; elsewhere they have defaults.
required = fn name, default ->
  case System.get_env(name) do
    value when value not in [nil, ""] ->
      value

    _ when env == :prod ->
      raise "environment variable #{name} is missing; see packages/mua_server/README.md"

    _ ->
      default
  end
end

if config_env() != :test do
  host = required.("PHX_HOST", "localhost")
  scheme = System.get_env("PHX_SCHEME", if(config_env() == :prod, do: "https", else: "http"))

  public_port =
    String.to_integer(
      System.get_env("PHX_URL_PORT", if(scheme == "https", do: "443", else: "4000"))
    )

  origin =
    if public_port in [80, 443],
      do: "#{scheme}://#{host}",
      else: "#{scheme}://#{host}:#{public_port}"

  config :mua_server,
    world: [
      path: required.("DATABASE_PATH", "data/world.db"),
      edl: System.get_env("MUA_EDL") || Path.join(:code.priv_dir(:mua_world), "edl/main.edl"),
      starting_room: required.("MUA_STARTING_ROOM", "west_of_house")
    ],
    allowlist: list.("MUA_ALLOWLIST"),
    admins: list.("MUA_ADMINS"),
    google: [
      client_id: required.("GOOGLE_CLIENT_ID", nil),
      client_secret: required.("GOOGLE_CLIENT_SECRET", nil),
      redirect_uri: System.get_env("GOOGLE_REDIRECT_URI", origin <> "/auth/google/callback")
    ]

  if config_env() == :prod do
    config :mua_server, MuaServer.Endpoint,
      http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT", "4000"))],
      url: [host: host, scheme: scheme, port: public_port],
      check_origin: [origin],
      secret_key_base: required.("SECRET_KEY_BASE", nil),
      server: true
  end
end
