import Config

config :ais_front, :environment, :test

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :ais_front, AisFront.Repo,
  username: "postgres",
  password: "postgres",
  database: "ais_front_test#{System.get_env("MIX_TEST_PARTITION")}",
  hostname: "localhost",
  pool: Ecto.Adapters.SQL.Sandbox

config :ais_front, AisFront.RepoBack,
  username: "postgres",
  password: "postgres",
  database: "ais_test#{System.get_env("MIX_TEST_PARTITION")}",
  hostname: "localhost",
  pool: Ecto.Adapters.SQL.Sandbox,
  types: AisFront.PostgresTypes

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :ais_front, AisFrontWeb.Endpoint,
  http: [port: 4002],
  server: false

# Print only warnings and errors during test
config :logger, level: :warn
