defmodule MuaServer.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        {Phoenix.PubSub, name: MuaServer.PubSub},
        {Registry, keys: :unique, name: MuaServer.Connections},
        {DynamicSupervisor, name: MuaServer.ConnectionSupervisor, strategy: :one_for_one}
      ] ++
        if(Application.get_env(:mua_server, :start_world, true), do: world_children(), else: []) ++
        [MuaServer.Endpoint]

    Supervisor.start_link(children, strategy: :rest_for_one, name: MuaServer.Supervisor)
  end

  @doc """
  The World, and a task that gives every Character still in play its grace
  once the World has started: after a restart no Connection controls them.
  """
  def world_children(opts \\ Application.fetch_env!(:mua_server, :world)) do
    File.mkdir_p!(Path.dirname(Keyword.fetch!(opts, :path)))

    [
      %{
        id: MuaWorld,
        start: {MuaWorld, :start_link, [Keyword.put(opts, :name, MuaServer.World)]}
      },
      {Task, &MuaServer.Connection.grace_all/0}
    ]
  end

  @impl true
  def config_change(changed, _new, removed) do
    MuaServer.Endpoint.config_change(changed, removed)
    :ok
  end
end
