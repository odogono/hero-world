defmodule MuaWorld.Commands.Bind do
  @moduledoc """
  Binds a parsed command's noun phrases to the entities they name, ported
  from `commands/bind.ts`. A phrase handles `all`, `all except X`,
  `X and Y`, `X in Y`, `it`, and adjectives before the noun. A phrase that
  names several objects expands into one command each, labelled with the
  object's name.

  A command waiting for "which do you mean?" is a pending map (`pending/1`
  reads one back from `player.pending`), which `resolve_pending/2` answers.
  """

  alias MuaWorld.Commands.Scope

  @all ~w(all everything)
  @except ~w(but except)
  @inside ~w(from in inside)
  @pronouns ~w(it that)

  @type result ::
          {:bound, [map()]}
          | {:ambiguous, String.t(), map()}
          | {:error, String.t()}

  @doc """
  Binds `command` for `actor`. `last_target` is what `it` refers to, and
  `resolved` holds objects already chosen, by slot (`"target"`,
  `"indirect"`).
  """
  @spec bind(OdgnEcs.t(), OdgnEcs.eid(), map(), OdgnEcs.eid() | nil, map()) :: result()
  def bind(world, actor, command, last_target \\ nil, resolved \\ %{}) do
    Enum.reduce_while([:target, :indirect], {:ok, %{}}, fn slot, {:ok, acc} ->
      case Map.get(command, slot) do
        nil ->
          {:cont, {:ok, acc}}

        phrase ->
          scope = Map.get(command, scope_key(slot)) || "here"
          pool = Scope.in_scope(world, actor, scope)

          case resolved[Atom.to_string(slot)] do
            nil ->
              ctx = %{world: world, actor: actor, pool: pool, scope: scope}

              case bind_phrase(ctx, String.split(phrase), last_target) do
                {:error, message} ->
                  {:halt, {:error, message}}

                {:ambiguous, candidates} ->
                  pending = %{
                    "command" => encode(command),
                    "options" => Enum.map(candidates, &%{"id" => &1.id, "name" => &1.name}),
                    "resolved" => resolved,
                    "slot" => Atom.to_string(slot)
                  }

                  {:halt,
                   {:ambiguous, "Which do you mean: #{describe_list(candidates)}?", pending}}

                {:many, candidates} ->
                  {:cont, {:ok, Map.put(acc, slot, candidates)}}
              end

            chosen ->
              case Enum.find(pool, &(&1.id == chosen)) do
                nil -> {:halt, {:error, "That is no longer here."}}
                candidate -> {:cont, {:ok, Map.put(acc, slot, [candidate])}}
              end
          end
      end
    end)
    |> case do
      {:ok, ids} ->
        targets = Map.get(ids, :target, [nil])
        indirect = ids |> Map.get(:indirect, []) |> List.first()
        many? = length(targets) > 1

        commands =
          for target <- targets do
            command
            |> Map.put(:target_id, target && target.id)
            |> Map.put(:indirect_id, indirect && indirect.id)
            |> Map.put(:label, if(many? and target, do: target.name))
          end

        {:bound, commands}

      other ->
        other
    end
  end

  defp scope_key(:target), do: :target_scope
  defp scope_key(:indirect), do: :indirect_scope

  @doc "Whether a candidate answers to these words: every word must be one of its."
  def matches?(candidate, words), do: words != [] and Enum.all?(words, &(&1 in candidate.words))

  defp bind_phrase(ctx, [first | _] = words, last_target) when first in @all do
    # `take all` means what's around you; `drop all` what you carry
    candidates =
      Enum.filter(ctx.pool, &(!&1.player? and (ctx.scope == "inv" or &1.location != ctx.actor)))

    candidates =
      case split_on(words, @except) do
        {_, [_ | _] = after_words} ->
          case bind_phrase(ctx, after_words, last_target) do
            {:error, _} = error ->
              error

            {_, excluded} ->
              ids = MapSet.new(excluded, & &1.id)
              Enum.reject(candidates, &MapSet.member?(ids, &1.id))
          end

        _ ->
          candidates
      end

    case candidates do
      {:error, _} = error -> error
      [] -> {:error, "There is nothing here to do that with."}
      list -> {:many, list}
    end
  end

  defp bind_phrase(ctx, words, last_target) do
    cond do
      match?({[_ | _], [_ | _]}, split_on(words, ["and"])) ->
        {before_words, after_words} = split_on(words, ["and"])

        Enum.reduce_while([before_words, after_words], {:many, []}, fn part, {:many, acc} ->
          case bind_phrase(ctx, part, last_target) do
            {:error, _} = error -> {:halt, error}
            # in a list, an ambiguous part means its first match
            {:ambiguous, [first | _]} -> {:cont, {:many, acc ++ [first]}}
            {:many, list} -> {:cont, {:many, acc ++ list}}
          end
        end)
        |> case do
          {:many, list} -> {:many, Enum.uniq_by(list, & &1.id)}
          error -> error
        end

      match?({[_ | _], [_ | _]}, split_on(words, @inside)) ->
        {before_words, after_words} = split_on(words, @inside)
        bind_inside(ctx, before_words, after_words, last_target)

      match?([w] when w in @pronouns, words) ->
        case Enum.find(ctx.pool, &(&1.id == last_target)) do
          nil -> {:error, ~s(I'm not sure what "#{Enum.join(words, " ")}" refers to.)}
          it -> {:many, [it]}
        end

      true ->
        case Enum.filter(ctx.pool, &matches?(&1, words)) do
          [] ->
            {:error, not_found(ctx, Enum.join(words, " "))}

          [_ | _] = matches ->
            # identical-looking things can't be told apart, so any one will do
            names = matches |> Enum.map(&String.downcase(&1.name)) |> Enum.uniq()

            if length(matches) > 1 and length(names) > 1,
              do: {:ambiguous, matches},
              else: {:many, [hd(matches)]}
        end
    end
  end

  # `X in Y`: search inside Y instead
  defp bind_inside(ctx, before_words, after_words, last_target) do
    case bind_phrase(ctx, after_words, last_target) do
      {:error, _} = error ->
        error

      {:many, list} when length(list) != 1 ->
        {:error, "You can only look in one thing."}

      {_, [box | _]} ->
        cond do
          box.container == nil ->
            {:error, "There is nothing in #{Scope.the_name(box)}."}

          box.container.closed? ->
            {:error, "#{capitalise(Scope.the_name(box))} is closed."}

          true ->
            pool = Scope.elements(ctx.world, box.id)

            case bind_phrase(%{ctx | pool: pool}, before_words, last_target) do
              {:error, _} when hd(before_words) not in @all ->
                {:error, "There is no #{Enum.join(before_words, " ")} in #{Scope.the_name(box)}."}

              result ->
                result
            end
        end
    end
  end

  defp split_on(words, separators) do
    case Enum.find_index(words, &(&1 in separators)) do
      nil -> nil
      i -> {Enum.take(words, i), Enum.drop(words, i + 1)}
    end
  end

  defp not_found(%{scope: "inv"}, phrase), do: "You aren't carrying any #{phrase}."
  defp not_found(_, phrase), do: "You can't see any #{phrase} here."

  defp describe_list(candidates) do
    names = Enum.map(candidates, &Scope.the_name/1)

    if length(names) <= 2,
      do: Enum.join(names, " or "),
      else: Enum.join(Enum.drop(names, -1), ", ") <> " or " <> List.last(names)
  end

  defp capitalise(<<first::utf8, rest::binary>>), do: String.upcase(<<first::utf8>>) <> rest
  defp capitalise(""), do: ""

  # -- Pending commands -------------------------------------------------------

  @doc """
  Reads a reply as the answer to "which do you mean?". Returns the chosen id,
  or `nil` if the reply doesn't pick exactly one option.
  """
  def resolve_pending(%{"options" => options}, reply) do
    words = reply |> String.downcase() |> String.split() |> Enum.reject(&(&1 == "the"))

    case Enum.filter(
           options,
           &matches?(%{words: String.split(String.downcase(&1["name"]))}, words)
         ) do
      [only] -> only["id"]
      _ -> nil
    end
  end

  @doc "A pending map read back from `player.pending`, or `nil`."
  def pending(%{"command" => %{}, "options" => [_ | _], "slot" => slot} = pending)
      when slot in ["target", "indirect"],
      do: pending

  def pending(_), do: nil

  @doc "The parsed command a pending map holds."
  def pending_command(%{"command" => command}), do: decode(command)

  @keys ~w(verb raw target indirect target_scope indirect_scope direction text)a

  defp encode(command),
    do: for({k, v} <- Map.take(command, @keys), v != nil, into: %{}, do: {Atom.to_string(k), v})

  defp decode(command),
    do: for(k <- @keys, v = command[Atom.to_string(k)], into: %{}, do: {k, v})
end
