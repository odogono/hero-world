defmodule MuaServer.Telemetry do
  @moduledoc """
  Turns the World's telemetry into log lines an operator can watch:

  - a Step slower than `:slow_step_ms` (500 by default) is a warning;
  - each backup, and each failed one;

  The World logs its own start-up (built or resumed, World time, commands
  abandoned at a restart) and any failed commit.
  """
  require Logger

  @events [[:mua_world, :step, :stop], [:mua_world, :backup]]

  def attach do
    :telemetry.attach_many({__MODULE__, :log}, @events, &__MODULE__.handle_event/4, nil)
  end

  @doc false
  def handle_event([:mua_world, :step, :stop], %{duration: duration}, metadata, _) do
    ms = System.convert_time_unit(duration, :native, :millisecond)
    slow = Application.get_env(:mua_server, :slow_step_ms, 500)

    if ms >= slow,
      do: Logger.warning("Slow Step: #{ms} ms, #{metadata.lines} lines", event: :slow_step)
  end

  def handle_event([:mua_world, :backup], %{duration: duration}, %{dest: dest, result: result}, _) do
    ms = System.convert_time_unit(duration, :native, :millisecond)

    case result do
      :ok -> Logger.info("Backed up the World to #{dest} in #{ms} ms", event: :backup)
      :error -> Logger.error("Backing up the World to #{dest} failed", event: :backup_failed)
    end
  end
end
