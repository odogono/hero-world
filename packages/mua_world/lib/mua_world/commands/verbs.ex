defmodule MuaWorld.Commands.Verbs do
  @moduledoc """
  A World's vocabulary: its Verbs, with the forms each can be typed in, and
  its Directions, Aliases and articles. All of it is World data (ADR 0024):
  the Base Verbs come from `mua-scripts/edl/base.edl`, which a World's EDL
  includes, and a World adds its own with more `verbs` and `words`
  components. The parser tries a verb's forms in order, and the first match
  picks the handler (an action id).

  A form's pattern is a space-separated list of slots and literal words:

  - `dir`: a Direction word (`north`, `n`, ...)
  - `obj`: a noun phrase, captured as the target (the direct object)
  - `obj2`: a second noun phrase after a preposition, captured as the indirect
  - `text`: the rest of the input, case preserved
  - any other word: a literal, such as a preposition, matched exactly

  An empty pattern matches the verb on its own. Noun phrases are bound to
  entities after parsing, within the form's Reach: `carried`, `room` (not
  carried) or `here` (both, the default).

  A Verb's `vetoes` are the `before…` Decisions asked before its Action:
  `%{event, asks, about}`, where `asks` and `about` are roles that
  `MuaWorld.Dispatch` resolves.
  """

  @type form :: %{
          handler: String.t(),
          pattern: String.t(),
          reach: String.t() | nil,
          indirect_reach: String.t() | nil
        }
  @type veto :: %{event: String.t(), asks: String.t(), about: String.t()}
  @type verb :: %{
          names: [String.t()],
          forms: [form()],
          incomplete: String.t() | nil,
          vetoes: [veto()]
        }
  @type vocabulary :: %{
          by_name: %{String.t() => verb()},
          defs: [verb()],
          vetoes: %{String.t() => [veto()]},
          directions: [{String.t(), String.t() | nil}],
          aliases: %{String.t() => String.t()},
          articles: [String.t()]
        }

  @reaches ~w(here carried room)

  @doc "The words that repeat the last command. The Host reads these itself."
  def again_words, do: ~w(again g)

  @doc "A Direction word, or an Alias of one, as a Direction; `nil` otherwise."
  def to_direction(_vocabulary, nil), do: nil

  def to_direction(vocabulary, word) do
    direction = Map.get(vocabulary.aliases, word, word)
    if List.keymember?(vocabulary.directions, direction, 0), do: direction
  end

  @doc "The Directions, in the order a World declares them."
  def directions(vocabulary), do: Enum.map(vocabulary.directions, &elem(&1, 0))

  @doc "A Direction's opposite, or `nil`."
  def opposite(vocabulary, direction) do
    case List.keyfind(vocabulary.directions, direction, 0) do
      {_, opposite} -> opposite
      nil -> nil
    end
  end

  @doc """
  A vocabulary from `verbs` and `words` components, in order. A verb that
  shares a name with an earlier one adds its forms, which are tried first: a
  World can add `look under obj` without replacing `look`. A malformed verb
  is skipped.
  """
  @spec from_components([map()]) :: vocabulary()
  def from_components(components) do
    defs =
      for %{"verbs" => %{"defs" => defs}} when is_list(defs) <- components,
          def <- defs,
          verb = to_verb(def),
          do: verb

    words = for %{"words" => %{} = words} <- components, do: words

    by_name =
      Enum.reduce(defs, %{}, fn def, acc ->
        Enum.reduce(def.names, acc, fn name, acc ->
          Map.update(acc, name, def, fn existing ->
            %{
              existing
              | forms: def.forms ++ existing.forms,
                incomplete: def.incomplete || existing.incomplete
            }
          end)
        end)
      end)

    %{
      by_name: by_name,
      defs: defs,
      vetoes: vetoes(defs),
      directions: directions_of(words),
      aliases: merge(words, "aliases"),
      articles: words |> Enum.flat_map(&strings(&1["articles"])) |> Enum.uniq()
    }
  end

  @doc """
  The vocabulary of a World: every entity's `verbs` and `words` components,
  in entity order, so the Base Verbs a World includes first come first.
  """
  @spec from_world(OdgnEcs.t()) :: vocabulary()
  def from_world(world) do
    (OdgnEcs.query(world, with: ["verbs"]) ++ OdgnEcs.query(world, with: ["words"]))
    |> Enum.uniq()
    |> Enum.sort()
    |> Enum.map(fn eid ->
      %{"verbs" => OdgnEcs.get(world, eid, "verbs"), "words" => OdgnEcs.get(world, eid, "words")}
    end)
    |> from_components()
  end

  # Each handler's Vetoes. A later Verb declaring Vetoes for a handler
  # replaces the earlier ones.
  defp vetoes(defs) do
    for def <- defs, def.vetoes != [], form <- def.forms, reduce: %{} do
      acc -> Map.put(acc, form.handler, def.vetoes)
    end
  end

  # A later Direction of the same name replaces the earlier, in its place
  defp directions_of(words) do
    for %{"directions" => list} when is_list(list) <- words,
        %{"name" => name} = d when is_binary(name) <- list,
        reduce: [] do
      acc ->
        opposite = if is_binary(d["opposite"]), do: String.downcase(d["opposite"])
        List.keystore(acc, String.downcase(name), 0, {String.downcase(name), opposite})
    end
  end

  defp merge(words, key) do
    for %{^key => %{} = map} <- words,
        {k, v} <- map,
        is_binary(k) and is_binary(v),
        into: %{},
        do: {String.downcase(k), String.downcase(v)}
  end

  defp strings(list), do: for(s <- List.wrap(list), is_binary(s), do: String.downcase(s))

  defp to_verb(%{} = def) do
    names = strings(def["names"])
    forms = for form <- List.wrap(def["forms"]), f = to_form(form), do: f
    vetoes = for veto <- List.wrap(def["vetoes"]), v = to_veto(veto), do: v

    if names != [] and forms != [] do
      incomplete = if is_binary(def["incomplete"]), do: def["incomplete"]
      %{names: names, forms: forms, incomplete: incomplete, vetoes: vetoes}
    end
  end

  defp to_verb(_), do: nil

  defp to_form(%{"handler" => h, "pattern" => p} = form) when is_binary(h) and is_binary(p) do
    reach = form["reach"]
    indirect = form["indirect_reach"]

    if reach in [nil | @reaches] and indirect in [nil | @reaches],
      do: %{handler: h, pattern: p, reach: reach, indirect_reach: indirect}
  end

  defp to_form(_), do: nil

  defp to_veto(%{"event" => e, "asks" => a, "about" => s})
       when is_binary(e) and is_binary(a) and is_binary(s),
       do: %{event: e, asks: a, about: s}

  defp to_veto(_), do: nil

  @doc """
  Every word that starts a command, for clients to complete: each verb's
  names, then the Directions and their Aliases, then `again`.
  """
  def list(vocabulary) do
    Enum.uniq(
      Enum.flat_map(vocabulary.defs, & &1.names) ++
        directions(vocabulary) ++ Enum.sort(Map.keys(vocabulary.aliases)) ++ again_words()
    )
  end
end
