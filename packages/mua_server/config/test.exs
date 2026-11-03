import Config

config :mua_server, MuaServer.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: String.duplicate("test-only-secret-key-base-", 4),
  server: false

config :mua_server,
  # the tests start the World themselves, on a fresh database
  start_world: false,
  grace_ms: 100,
  dev_sign_in: true,
  oauth_strategy: MuaServer.FakeGoogle,
  allowlist: ["ada@example.com", "bob@example.com"],
  admins: ["ada@example.com"]

config :logger, level: :warning
