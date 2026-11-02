defmodule MuaWorld.MixProject do
  use Mix.Project

  def project do
    [
      app: :mua_world,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      elixirc_paths: if(Mix.env() == :test, do: ["lib", "test/support"], else: ["lib"]),
      deps: deps()
    ]
  end

  def application, do: [extra_applications: [:logger]]

  # NorthTalk's Elixir Host isn't on Hex yet (odogono/odgn-talk#1983), so it
  # is pinned to a commit of odgn-talk.
  defp deps do
    [
      {:north_talk,
       github: "odogono/odgn-talk",
       sparse: "impl/elixir",
       ref: "dca82fcfc4988e95df2fa87781503ee3dd722eaf"},
      {:exqlite, "~> 0.27"},
      {:jason, "~> 1.4"}
    ]
  end
end
