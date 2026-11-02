import Config

config :mua_server, MuaServer.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  secret_key_base: String.duplicate("dev-only-secret-key-base-", 4),
  server: true

config :mua_server, dev_sign_in: true
