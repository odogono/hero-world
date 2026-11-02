defmodule MuaServer.FakeGoogle do
  @moduledoc false
  # Stands in for `Assent.Strategy.Google`: the callback's `code` names the
  # user it signs in, as `email` or `email:unverified`.

  def authorize_url(_config),
    do: {:ok, %{url: "https://accounts.example/auth", session_params: %{state: "s"}}}

  def callback(config, %{"code" => code}) do
    if config[:session_params] == %{state: "s"} do
      [email | flags] = String.split(code, ":")

      {:ok,
       %{
         user: %{
           "sub" => "google-" <> email,
           "email" => email,
           "email_verified" => flags != ["unverified"]
         }
       }}
    else
      {:error, :bad_state}
    end
  end

  def callback(_config, _params), do: {:error, :no_code}
end
