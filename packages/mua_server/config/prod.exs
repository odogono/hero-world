import Config

# One line per event, with what it was about, for `docker logs` and the like
config :logger, :default_formatter,
  format: "$time [$level] $message $metadata\n",
  metadata: [:event, :request_id]
