defmodule MuaWorld.Commands.Parser do
  @moduledoc """
  Parses a player's input against a vocabulary, ported from
  `commands/parser.ts`. A parsed command is a map:

  - `verb`: the handler of the matched form
  - `target`, `indirect`: noun phrases, articles removed
  - `target_reach`, `indirect_reach`: where to look for them
  - `direction`, `text`: as captured
  - `raw`: the input as typed
  """

  alias MuaWorld.Commands.Verbs

  @type command :: %{
          required(:verb) => String.t(),
          required(:raw) => String.t(),
          optional(:target) => String.t(),
          optional(:indirect) => String.t(),
          optional(:target_reach) => String.t(),
          optional(:indirect_reach) => String.t(),
          optional(:direction) => String.t(),
          optional(:text) => String.t()
        }

  @spec parse(String.t(), Verbs.vocabulary()) :: {:ok, command()} | {:error, String.t()}
  def parse(raw, vocabulary) do
    input = expand_say(raw)

    case tokenize(input) do
      [] ->
        {:error, "Please enter a command."}

      [{first, _} | args] ->
        # A direction on its own means "go <direction>"
        direction = if args == [], do: Verbs.to_direction(vocabulary, first)

        cond do
          direction ->
            {:ok, %{verb: "move", direction: direction, raw: raw}}

          verb = vocabulary.by_name[first] ->
            match_forms(vocabulary, verb, args, input, raw)

          true ->
            {:error, ~s(Unknown command: "#{first}")}
        end
    end
  end

  defp match_forms(vocabulary, verb, args, input, raw) do
    Enum.find_value(
      verb.forms,
      {:error, verb.incomplete || ~s(I don't understand "#{String.trim(input)}".)},
      fn form ->
        slots = String.split(form.pattern)

        case match(vocabulary, slots, args, input) do
          nil ->
            nil

          captures ->
            command =
              captures
              |> Map.merge(%{verb: form.handler, raw: raw})
              |> then(
                &if(Map.has_key?(&1, :target),
                  do: Map.put(&1, :target_reach, form.reach || "here"),
                  else: &1
                )
              )
              |> then(
                &if(Map.has_key?(&1, :indirect),
                  do: Map.put(&1, :indirect_reach, form.indirect_reach || "here"),
                  else: &1
                )
              )

            {:ok, command}
        end
      end
    )
  end

  # Tokens are lowercased words with their byte offset into the input.
  defp tokenize(input) do
    ~r/\S+/
    |> Regex.scan(input, return: :index)
    |> Enum.map(fn [{start, len}] -> {String.downcase(binary_part(input, start, len)), start} end)
  end

  # Noun phrases are tried shortest first, so a following preposition can
  # still match: in `obj in obj2`, `red box in bag` gives `red box` and `bag`.
  defp match(_v, [], [], _input), do: %{}
  defp match(_v, [], _, _input), do: nil
  defp match(_v, _, [], _input), do: nil

  defp match(v, ["dir" | rest], [{word, _} | tokens], input) do
    with direction when direction != nil <- Verbs.to_direction(v, word),
         captures when captures != nil <- match(v, rest, tokens, input),
         do: Map.put(captures, :direction, direction)
  end

  defp match(_v, ["text"], [{_, start} | _], input),
    do: %{text: input |> binary_part(start, byte_size(input) - start) |> String.trim()}

  defp match(_v, ["text" | _], _, _input), do: nil

  defp match(v, [slot | rest], tokens, input) when slot in ["obj", "obj2"] do
    Enum.find_value(1..length(tokens), fn n ->
      {phrase_tokens, after_tokens} = Enum.split(tokens, n)

      with phrase when phrase != nil <- noun_phrase(v, phrase_tokens),
           captures when captures != nil <- match(v, rest, after_tokens, input) do
        Map.put(captures, if(slot == "obj", do: :target, else: :indirect), phrase)
      end
    end)
  end

  defp match(v, [word | rest], [{word, _} | tokens], input), do: match(v, rest, tokens, input)
  defp match(_v, _, _, _input), do: nil

  defp noun_phrase(v, tokens) do
    case for({w, _} <- tokens, w not in v.articles, do: w) do
      [] -> nil
      words -> Enum.join(words, " ")
    end
  end

  # A leading `'` or `"` says the rest: `'hello` and `"hello"` say hello.
  defp expand_say(input) do
    case Regex.run(~r/^\s*(["'])(.*?)\1?\s*$/s, input) do
      [_, _, said] -> "say " <> said
      nil -> input
    end
  end
end
