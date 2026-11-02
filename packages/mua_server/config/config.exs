import Config

config :mua_server, MuaServer.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  pubsub_server: MuaServer.PubSub,
  render_errors: [formats: [json: MuaServer.ErrorJSON], layout: false]

config :mua_server,
  # how long a Character stays in play after its Connection drops
  grace_ms: 30_000,
  oauth_strategy: Assent.Strategy.Google,
  # the fake sign-in route, for local development and tests only
  dev_sign_in: false

config :phoenix, :json_library, Jason
config :logger, level: :info

import_config "#{config_env()}.exs"
