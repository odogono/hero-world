defmodule MuaWorld.Commands.Verbs do
  @moduledoc """
  A World's vocabulary: its Verbs, with the forms each can be typed in, and
  its Directions, Aliases and articles. All of it is World data (ADR 0024):
  the Base Verbs come from `mua-scripts/edl/base.edl`, which a World's EDL
  includes, and a World adds its own with more `verbs` and `words`
  components. The parser tries a verb's forms in order, and the first match
  picks the Action the Command asks for.

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

  Each Action is declared in an `actions` component (ADR 0029): the Service
  Script that carries it out, if any, and the roles it is sent. Each
  Service Script is declared in a `services` component, by name and `src`.
  A later declaration of the same name replaces the earlier.
  """

  @type form :: %{
          action: String.t(),
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
  @type action :: %{service: String.t() | nil, args: [String.t()]}
  @type vocabulary :: %{
          by_name: %{String.t() => verb()},
          actions: %{String.t() => action()},
          services: %{String.t() => String.t()},
          defs: [verb()],
          vetoes: %{String.t() => [veto()]},
          directions: [{String.t(), String.t() | nil}],
          aliases: %{String.t() => String.t()},
          articles: [String.t()]
        }

  @reaches ~w(here carried room)
  @args ~w(target actor)

  # The Services the Host asks itself, not through an Action
  @host_services ~w(lifecycle build)

  @components ~w(verbs words actions services)

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
  A vocabulary from `verbs`, `words`, `actions` and `services` components,
  in order. A verb that
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
      actions: declared(components, "actions", &to_action/1),
      services: declared(components, "services", &to_service/1),
      defs: defs,
      vetoes: vetoes(defs),
      directions: directions_of(words),
      aliases: merge(words, "aliases"),
      articles: words |> Enum.flat_map(&strings(&1["articles"])) |> Enum.uniq()
    }
  end

  @doc """
  The vocabulary of a World: every entity's `verbs`, `words`, `actions` and
  `services` components, in entity order, so the Base Verbs a World
  includes first come first.
  """
  @spec from_world(OdgnEcs.t()) :: vocabulary()
  def from_world(world) do
    @components
    |> Enum.flat_map(&OdgnEcs.query(world, with: [&1]))
    |> Enum.uniq()
    |> Enum.sort()
    |> Enum.map(fn eid -> Map.new(@components, &{&1, OdgnEcs.get(world, eid, &1)}) end)
    |> from_components()
  end

  @doc """
  What is wrong with a vocabulary's Actions and Services, as a list of
  messages: a form asking for an undeclared Action, an Action or a Veto
  naming an undeclared Service, a Service the Host asks itself missing, or
  a Service's `src` under a root that isn't one of `roots`. A World with
  any of these won't migrate or start.
  """
  @spec problems(vocabulary(), %{String.t() => String.t()}) :: [String.t()]
  def problems(vocabulary, roots) do
    actions =
      for def <- vocabulary.defs,
          form <- def.forms,
          not Map.has_key?(vocabulary.actions, form.action),
          uniq: true,
          do: "#{hd(def.names)} asks for the Action #{form.action}, which isn't declared"

    services =
      for {name, %{service: service}} <- Enum.sort(vocabulary.actions),
          service != nil,
          not Map.has_key?(vocabulary.services, service),
          do: "the Action #{name} names the Service #{service}, which isn't declared"

    vetoes =
      for def <- vocabulary.defs,
          %{asks: "service:" <> service, event: event} <- def.vetoes,
          not Map.has_key?(vocabulary.services, service),
          uniq: true,
          do: "#{event} asks the Service #{service}, which isn't declared"

    host =
      for service <- @host_services,
          not Map.has_key?(vocabulary.services, service),
          do: "the Service #{service} isn't declared"

    srcs =
      for {name, src} <- Enum.sort(vocabulary.services),
          service_path(src, roots, ".") == nil,
          do: "the Service #{name}'s src #{src} is under no root mua knows"

    actions ++ services ++ vetoes ++ host ++ srcs
  end

  @doc """
  Each declared Service Script's name and file, sorted by name, its `src`
  read as `service_path/3` does.
  """
  def service_files(vocabulary, roots, edl_path) do
    for {name, src} <- Enum.sort(vocabulary.services),
        do: {name, service_path(src, roots, edl_path)}
  end

  @doc """
  The file of a Service's `src`: under a named root when it starts with
  `<root>:`, else relative to the World's EDL file. `nil` for an unknown
  root.
  """
  def service_path(src, roots, edl_path) do
    case String.split(src, ":", parts: 2) do
      [root, rest] when byte_size(root) > 1 ->
        if dir = roots[root], do: Path.join(dir, rest)

      _ ->
        Path.expand(src, Path.dirname(edl_path))
    end
  end

  # Each name's declaration in the components' `defs` maps, a later one
  # replacing the earlier; a malformed one is skipped
  defp declared(components, key, to) do
    for %{^key => %{"defs" => %{} = defs}} <- components,
        {name, def} <- defs,
        is_binary(name),
        value = to.(def),
        reduce: %{} do
      acc -> Map.put(acc, name, value)
    end
  end

  defp to_action(%{} = def) do
    service = def["service"]
    args = def["args"] || @args

    if (service == nil or is_binary(service)) and is_list(args) and Enum.all?(args, &is_binary/1),
      do: %{service: service, args: args}
  end

  defp to_action(_), do: nil

  defp to_service(%{"src" => src}) when is_binary(src) and src != "", do: src
  defp to_service(_), do: nil

  # Each Action's Vetoes. A later Verb declaring Vetoes for an Action
  # replaces the earlier ones.
  defp vetoes(defs) do
    for def <- defs, def.vetoes != [], form <- def.forms, reduce: %{} do
      acc -> Map.put(acc, form.action, def.vetoes)
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

  defp to_form(%{"action" => a, "pattern" => p} = form) when is_binary(a) and is_binary(p) do
    reach = form["reach"]
    indirect = form["indirect_reach"]

    if reach in [nil | @reaches] and indirect in [nil | @reaches],
      do: %{action: a, pattern: p, reach: reach, indirect_reach: indirect}
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
