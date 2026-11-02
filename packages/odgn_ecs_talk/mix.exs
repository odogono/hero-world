defmodule OdgnEcsTalk.MixProject do
  use Mix.Project

  def project do
    [
      app: :odgn_ecs_talk,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application, do: [extra_applications: [:logger]]

  # NorthTalk's Elixir Host isn't on Hex yet (odogono/odgn-talk#1983), so it
  # is pinned to a commit of odgn-talk: for now odogono/odgn-talk#1993, which adds
  # Host Commands and Library declarations.
  defp deps do
    [
      {:odgn_ecs, path: "../odgn_ecs"},
      {:odgn_edl, path: "../odgn_edl"},
      {:north_talk, github: "odogono/odgn-talk", sparse: "impl/elixir", ref: "caa87845"}
    ]
  end
end
