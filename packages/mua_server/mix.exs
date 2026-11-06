defmodule MuaServer.MixProject do
  use Mix.Project

  def project do
    [
      app: :mua_server,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      elixirc_paths: elixirc_paths(Mix.env()),
      deps: deps()
    ]
  end

  def application do
    [mod: {MuaServer.Application, []}, extra_applications: [:logger, :crypto]]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # NorthTalk's Elixir Host isn't on Hex yet (odogono/odgn-talk#1983), so it
  # is pinned to the commit mua_world uses.
  defp deps do
    [
      {:mua_world, path: "../mua_world"},
      {:odgn_ecs, path: "../odgn_ecs"},
      {:odgn_edl, path: "../odgn_edl"},
      {:odgn_ecs_talk, path: "../odgn_ecs_talk"},
      {:north_talk,
       github: "odogono/odgn-talk",
       sparse: "impl/elixir",
       ref: "5bae9a9938925d7609476726b4cc8b5acd33277e"},
      {:phoenix, "~> 1.7"},
      {:bandit, "~> 1.5"},
      {:jason, "~> 1.4"},
      {:assent, "~> 0.3"},
      {:req, "~> 0.5"}
    ]
  end
end
