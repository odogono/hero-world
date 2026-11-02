defmodule MuaWorld.Input do
  @moduledoc """
  Reads a Character's input into the commands it asks for, ported from
  `systems/parseSystem.ts`:

  - a reply to "which do you mean?" finishes the command waiting in
    `player.pending`; anything else is a new command;
  - `again` (`g`) repeats `player.last_input`;
  - `bob hello` means `say to bob hello` when bob is here;
  - `it` refers to `player.last_target_id`, the last single object acted on.

  `read/4` returns `{result, player_changes}`, where `result` is
  `{:reply, message}` or `{:commands, bound}`, and `player_changes` are the
  fields of the Character's `player` component to update.
  """

  alias MuaWorld.Commands.{Bind, Parser, Scope, Verbs}

  def read(world, vocabulary, actor, text) do
    player = OdgnEcs.get(world, actor, "player") || %{}
    last_target = player["last_target_id"]
    changes = if player["pending"] != nil, do: %{"pending" => nil}, else: %{}

    bound =
      with %{} = pending <- Bind.pending(player["pending"]),
           chosen when chosen != nil <- Bind.resolve_pending(pending, text) do
        resolved = Map.put(pending["resolved"] || %{}, pending["slot"], chosen)
        Bind.bind(world, actor, Bind.pending_command(pending), last_target, resolved)
      else
        _ -> nil
      end

    case bound || parse(world, vocabulary, actor, text, player) do
      {:reply, message, more} ->
        {{:reply, message}, Map.merge(changes, more)}

      {:bound, commands, more} ->
        finish({:bound, commands}, Map.merge(changes, more))

      other ->
        finish(other, changes)
    end
  end

  defp finish({:error, message}, changes), do: {{:reply, message}, changes}

  defp finish({:ambiguous, message, pending}, changes),
    do: {{:reply, message}, Map.put(changes, "pending", pending)}

  defp finish({:bound, commands}, changes) do
    changes =
      case commands do
        [%{target_id: id}] when id != nil -> Map.put(changes, "last_target_id", id)
        _ -> changes
      end

    {{:commands, commands}, changes}
  end

  defp parse(world, vocabulary, actor, text, player) do
    again? = String.downcase(String.trim(text)) in Verbs.again_words()
    input = if again?, do: player["last_input"], else: text

    if input == nil do
      {:reply, "There is nothing to repeat.", %{}}
    else
      case parse_or_say_to(world, vocabulary, actor, input) do
        {:error, message} ->
          {:reply, message, %{}}

        {:ok, command} ->
          case Bind.bind(world, actor, command, player["last_target_id"]) do
            {:bound, commands} -> {:bound, commands, %{"last_input" => input}}
            {:error, message} -> {:reply, message, %{"last_input" => input}}
            {:ambiguous, message, pending} -> {:reply_pending, message, pending, input}
          end
      end
    end
    |> case do
      {:reply_pending, message, pending, input} ->
        {:reply, message, %{"pending" => pending, "last_input" => input}}

      other ->
        other
    end
  end

  # `bob hello` means "say to bob hello"
  defp parse_or_say_to(world, vocabulary, actor, input) do
    case Parser.parse(input, vocabulary) do
      {:ok, _} = ok ->
        ok

      {:error, _} = error ->
        first = input |> String.trim() |> String.downcase() |> String.split() |> List.first()

        listener? =
          first != nil and
            Enum.any?(
              Scope.in_scope(world, actor, "room"),
              &(&1.player? and Bind.matches?(&1, [first]))
            )

        if listener?, do: Parser.parse("say to " <> String.trim(input), vocabulary), else: error
    end
  end
end
