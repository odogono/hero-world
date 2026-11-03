defmodule MuaServer.HealthController do
  @moduledoc """
  `GET /health`: `200` while the World answers, with its World time and how
  many Characters are in play; `503` when it doesn't, as while it restarts.
  """
  use Phoenix.Controller, formats: [:json]

  def show(conn, _params) do
    world = Application.get_env(:mua_server, :world_name, MuaServer.World)

    try do
      body = %{
        status: "ok",
        world_time: MuaWorld.world_time(world),
        in_play: length(MuaWorld.in_play(world))
      }

      json(conn, body)
    catch
      :exit, _ -> conn |> put_status(503) |> json(%{status: "unavailable"})
    end
  end
end
