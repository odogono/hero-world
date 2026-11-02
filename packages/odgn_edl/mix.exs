defmodule OdgnEdl.MixProject do
  use Mix.Project

  def project do
    [
      app: :odgn_edl,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application, do: [extra_applications: [:logger]]

  defp deps do
    [{:nimble_parsec, "~> 1.4"}]
  end
end
