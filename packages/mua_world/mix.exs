defmodule MuaWorld.MixProject do
  use Mix.Project

  def project do
    [
      app: :mua_world,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application, do: [extra_applications: [:logger]]

  # NorthTalk's Elixir Host isn't on Hex yet (odogono/odgn-talk#1983), so it
  # is pinned to the commit odgn_ecs_talk uses.
  defp deps do
    [
      {:odgn_ecs, path: "../odgn_ecs"},
      {:odgn_edl, path: "../odgn_edl"},
      {:odgn_ecs_talk, path: "../odgn_ecs_talk"},
      {:north_talk,
       github: "odogono/odgn-talk",
       sparse: "impl/elixir",
       ref: "3216b61b5540a6bd3de3cfb4c6911b9c106f2a32"},
      {:telemetry, "~> 1.2"}
    ]
  end
end
