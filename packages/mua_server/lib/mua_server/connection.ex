defmodule MuaServer.Connection do
  @moduledoc """
  The one Connection that controls a Character (docs/mua-next.md):

    * **Takeover:** a new Channel takes over; the old one is told it was
      replaced and loses its command authority. Its closing later moves
      nothing.
    * **Grace:** when the controlling Channel goes away unexpectedly, the
      Character stays in play for the grace period (30 s), then leaves for
      Limbo. Coming back within it resumes control.
    * **Logout:** leaves for Limbo at once.
    * **Restart:** every Character in play when the World starts gets its
      grace, since no Connection controls it (`grace_all/0`).

  One process per Character, registered in `MuaServer.Connections`.
  """
  use GenServer, restart: :temporary

  @world MuaServer.World

  @doc "Makes `pid` the controlling Channel of a Character, taking over from any other."
  def attach(account, character, pid),
    do: GenServer.call(ensure(account, character), {:attach, pid})

  @doc "Whether `pid` controls the Character."
  def controls?(character, pid) do
    case Registry.lookup(MuaServer.Connections, character) do
      [{conn, _}] -> GenServer.call(conn, {:controls?, pid})
      [] -> false
    end
  end

  @doc """
  Runs `fun` only if `pid` controls the Character, else `{:error, :replaced}`.
  It runs in the Connection's process, so a takeover waits for a command
  already running and a stale Channel's command can't run after one.
  """
  def run(character, pid, fun) do
    case Registry.lookup(MuaServer.Connections, character) do
      [{conn, _}] -> GenServer.call(conn, {:run, pid, fun}, 30_000)
      [] -> {:error, :replaced}
    end
  catch
    # the Connection stopped, as after logging out
    :exit, {:noproc, _} -> {:error, :replaced}
    :exit, {:normal, _} -> {:error, :replaced}
  end

  @doc "Takes the Character out of play at once, if `pid` controls it."
  def logout(character, pid) do
    case Registry.lookup(MuaServer.Connections, character) do
      [{conn, _}] -> GenServer.call(conn, {:logout, pid}, 30_000)
      [] -> {:error, :not_controlling}
    end
  end

  @doc "Gives every Character in play its grace: for when the World starts."
  def grace_all do
    for {account, character} <- MuaWorld.in_play(@world),
        do: GenServer.cast(ensure(account, character), :grace)

    :ok
  end

  defp ensure(account, character) do
    spec = {__MODULE__, {account, character}}

    case DynamicSupervisor.start_child(MuaServer.ConnectionSupervisor, spec) do
      {:ok, pid} -> pid
      {:error, {:already_started, pid}} -> pid
    end
  end

  def start_link({account, character}),
    do:
      GenServer.start_link(__MODULE__, {account, character},
        name: {:via, Registry, {MuaServer.Connections, character}}
      )

  @impl true
  def init({account, character}),
    do: {:ok, %{account: account, character: character, pid: nil, monitor: nil, timer: nil}}

  @impl true
  def handle_call({:attach, pid}, _from, state) do
    if state.pid && state.pid != pid do
      Process.demonitor(state.monitor, [:flush])
      send(state.pid, {:replaced, state.character})
    end

    state = cancel(state)
    {:reply, :ok, %{state | pid: pid, monitor: Process.monitor(pid)}}
  end

  def handle_call({:controls?, pid}, _from, state), do: {:reply, state.pid == pid, state}

  def handle_call({:run, pid, fun}, _from, %{pid: pid} = state) when pid != nil,
    do: {:reply, fun.(), state}

  def handle_call({:run, _pid, _fun}, _from, state), do: {:reply, {:error, :replaced}, state}

  def handle_call({:logout, pid}, _from, %{pid: pid} = state) when pid != nil do
    Process.demonitor(state.monitor, [:flush])
    :ok = MuaWorld.leave(@world, state.account, state.character)
    {:stop, :normal, :ok, %{state | pid: nil}}
  end

  def handle_call({:logout, _pid}, _from, state), do: {:reply, {:error, :not_controlling}, state}

  @impl true
  def handle_cast(:grace, %{pid: nil} = state), do: {:noreply, start_grace(state)}
  def handle_cast(:grace, state), do: {:noreply, state}

  @impl true
  def handle_info({:DOWN, ref, :process, _, _}, %{monitor: ref} = state),
    do: {:noreply, start_grace(%{state | pid: nil, monitor: nil})}

  def handle_info(:grace_over, %{pid: nil} = state) do
    MuaWorld.leave(@world, state.account, state.character)
    {:stop, :normal, state}
  end

  def handle_info(_, state), do: {:noreply, state}

  defp start_grace(state) do
    state = cancel(state)

    %{
      state
      | timer:
          Process.send_after(self(), :grace_over, Application.fetch_env!(:mua_server, :grace_ms))
    }
  end

  defp cancel(%{timer: nil} = state), do: state

  defp cancel(state) do
    Process.cancel_timer(state.timer)
    %{state | timer: nil}
  end
end
