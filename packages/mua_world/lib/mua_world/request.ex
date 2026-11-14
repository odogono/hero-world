defmodule MuaWorld.Request do
  @moduledoc """
  Requests to Scripts: questions a Script answers with a reply.

  A Request says no by replying `{refused: text}`, and a Run that fails or
  never replies says no too. What any other reply means is for whoever
  asked to read.

  `ask/2` asks within a Step, all or nothing. Dispatch asks its own way
  (`OdgnEcsEngine.ask/4`), since a command's Run may answer in a later
  Step, and reads the reply with `reply/1`.
  """

  require Logger

  alias MuaWorld.Admin
  alias OdgnEcsEngine.{Delivery, Step}

  @doc """
  Asks a Request inside `step`, keeping what it changed only if the reply
  was accepted.

  `setup` runs first, inside the same savepoint, and returns `{:ok,
  delivery, read}`, or anything else to give up. Made there, `read` can
  see what setup made, such as a new entity. It gets an accepted reply's
  value and returns `{:ok, result}`, or anything else for a reply it
  can't read. A Run still waiting is abandoned: nothing waits for its
  reply, but the Run carries on, so what it changes once it wakes is
  kept (#321). A caller that can replace the Script, as the admin line
  does, ends the Run with it.

  Returns `{:ok, result}`, `{:refused, text}`, or `{:failed, why}`, where
  `why` is what setup returned, the Run's outcome (`:waiting` or `{:failed,
  error}`), or `{:malformed, value}`. Anything else leaves no change. A
  failure and a malformed reply are logged; the caller words what the
  player is told.
  """
  def ask(%Step{world: world} = step, setup) do
    OdgnEcs.in_savepoint(world, "mua_request", fn ->
      case setup.() do
        {:ok, %Delivery{} = delivery, read} when is_function(read, 1) ->
          request(step, %{delivery | asks: :request}, read)

        other ->
          {:failed, other}
      end
    end)
  end

  defp request(step, delivery, read) do
    case OdgnEcsEngine.deliver(step, delivery) do
      {:ok, pending} ->
        :ok = OdgnEcsEngine.pump(step)
        outcome = OdgnEcsTalk.outcome(pending)
        if outcome == :waiting, do: OdgnEcsTalk.abandon(pending)
        read_reply(delivery, reply(outcome), read)

      error ->
        failed(delivery, error)
    end
  end

  defp read_reply(delivery, {:replied, value}, read) do
    case read.(value) do
      {:ok, _} = ok -> ok
      _ -> malformed(delivery, value)
    end
  end

  defp read_reply(delivery, {:malformed, value}, _), do: malformed(delivery, value)
  defp read_reply(_, {:refused, _} = refused, _), do: refused
  defp read_reply(delivery, {:failed, outcome}, _), do: failed(delivery, outcome)

  defp malformed(delivery, value) do
    Logger.error("#{asked(delivery)} replied #{Admin.show(value)}", event: :malformed_reply)
    {:failed, {:malformed, value}}
  end

  defp failed(delivery, why) do
    Logger.warning("#{asked(delivery)} failed: #{Admin.failure(why)}", event: :request_failed)
    {:failed, why}
  end

  defp asked(%Delivery{message: message, to: {:service, name}}), do: "#{message} to #{name}"
  defp asked(%Delivery{message: message, to: eid}), do: "#{message} to ##{eid}"

  @doc """
  What a Request's outcome says: `{:refused, text}` when the Script said
  no, `{:malformed, value}` when it meant to but its refusal isn't text,
  `{:failed, outcome}` when its Run didn't reply, and otherwise
  `{:replied, value}` for the asker to read.
  """
  def reply({:replied, %NorthTalk.Map{} = value} = replied) do
    case NorthTalk.Map.get(value, "refused", :none) do
      text when is_binary(text) -> {:refused, text}
      :none -> replied
      _ -> {:malformed, value}
    end
  end

  def reply({:replied, _} = replied), do: replied
  def reply(outcome), do: {:failed, outcome}
end
