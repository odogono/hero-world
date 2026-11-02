defmodule MuaWorld.Commands.Verbs do
  @moduledoc """
  Verb definitions: the words a player can type and the forms each verb
  accepts, ported from `commands/verbs.ts`. The parser tries a verb's forms
  in order, and the first match picks the handler (an action id).

  A form's pattern is a space-separated list of slots and literal words:

  - `dir`: a direction word (`north`, `n`, ...)
  - `obj`: a noun phrase, captured as the target (the direct object)
  - `obj2`: a second noun phrase after a preposition, captured as the indirect
  - `text`: the rest of the input, case preserved
  - any other word: a literal, such as a preposition, matched exactly

  An empty pattern matches the verb on its own. Noun phrases are bound to
  entities after parsing, in the form's scope: `inv` (carried), `room` (not
  carried) or `here` (both, the default).

  A world adds verbs with a `verbs` component (`from_world/1`).
  """

  @type form :: %{
          handler: String.t(),
          pattern: String.t(),
          scope: String.t() | nil,
          indirect_scope: String.t() | nil
        }
  @type verb :: %{names: [String.t()], forms: [form()], incomplete: String.t() | nil}
  @type vocabulary :: %{by_name: %{String.t() => verb()}, defs: [verb()]}

  @aliases %{
    "d" => "down",
    "e" => "east",
    "n" => "north",
    "ne" => "northeast",
    "nw" => "northwest",
    "s" => "south",
    "se" => "southeast",
    "sw" => "southwest",
    "u" => "up",
    "w" => "west"
  }

  @directions ~w(north south east west northeast northwest southeast southwest up down in out)

  @opposites %{
    "down" => "up",
    "east" => "west",
    "in" => "out",
    "north" => "south",
    "northeast" => "southwest",
    "northwest" => "southeast",
    "out" => "in",
    "south" => "north",
    "southeast" => "northwest",
    "southwest" => "northeast",
    "up" => "down",
    "west" => "east"
  }

  @scopes ~w(here inv room)

  def aliases, do: @aliases
  def directions, do: @directions
  def opposite(direction), do: @opposites[direction]
  def articles, do: ~w(a an the)
  def again_words, do: ~w(again g)

  @doc "A direction word, or its short form, as a direction; `nil` otherwise."
  def to_direction(nil), do: nil

  def to_direction(word) do
    direction = Map.get(@aliases, word, word)
    if direction in @directions, do: direction
  end

  defp f(handler, pattern, opts \\ []),
    do: %{
      handler: handler,
      pattern: pattern,
      scope: opts[:scope],
      indirect_scope: opts[:indirect_scope]
    }

  @verbs [
    %{
      names: ~w(look l examine x),
      incomplete: nil,
      forms: [
        {"look", ""},
        {"look", "around"},
        {"examine", "at obj"},
        {"examine", "in obj"},
        {"examine", "obj"}
      ]
    },
    %{
      names: ~w(move go walk),
      incomplete: "Where do you want to go?",
      forms: [{"move", "dir"}, {"move", "to dir"}]
    },
    %{
      names: ~w(take get pick),
      incomplete: "What do you want to take?",
      forms: [{"take", "up obj"}, {"take", "obj"}]
    },
    %{
      names: ~w(drop),
      incomplete: "What do you want to drop?",
      forms: [{"drop", "obj", scope: "inv"}]
    },
    %{names: ~w(read), incomplete: "What do you want to read?", forms: [{"read", "obj"}]},
    %{names: ~w(help commands), incomplete: nil, forms: [{"help", ""}]},
    %{names: ~w(inventory inv i), incomplete: nil, forms: [{"inventory", ""}]},
    %{names: ~w(open), incomplete: "What do you want to open?", forms: [{"open", "obj"}]},
    %{names: ~w(close shut), incomplete: "What do you want to close?", forms: [{"close", "obj"}]},
    %{
      names: ~w(lock),
      incomplete: "What do you want to lock?",
      forms: [{"lock", "obj with obj2", indirect_scope: "inv"}, {"lock", "obj"}]
    },
    %{
      names: ~w(unlock),
      incomplete: "What do you want to unlock?",
      forms: [{"unlock", "obj with obj2", indirect_scope: "inv"}, {"unlock", "obj"}]
    },
    %{
      names: ~w(say),
      incomplete: "What do you want to say?",
      forms: [{"sayTo", "to obj text", scope: "room"}, {"say", "text"}]
    }
  ]

  @doc "The built-in verbs."
  def built_in do
    for v <- @verbs do
      forms =
        Enum.map(v.forms, fn
          {h, p} -> f(h, p)
          {h, p, opts} -> f(h, p, opts)
        end)

      %{v | forms: forms}
    end
  end

  @doc """
  The built-in verbs plus a world's own. A world verb that shares a name with
  another adds its forms, which are tried first: a world can add
  `look under obj` without replacing `look`.
  """
  @spec vocabulary([verb()]) :: vocabulary()
  def vocabulary(extra \\ []) do
    defs = built_in() ++ extra

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

    %{by_name: by_name, defs: defs}
  end

  @doc """
  The vocabulary of a World: the built-ins plus the verbs every entity's
  `verbs` component declares. A malformed verb is skipped.
  """
  @spec from_world(OdgnEcs.t()) :: vocabulary()
  def from_world(world) do
    world
    |> OdgnEcs.query(with: ["verbs"])
    |> Enum.flat_map(fn eid ->
      case OdgnEcs.get(world, eid, "verbs")["defs"] do
        defs when is_list(defs) -> Enum.flat_map(defs, &List.wrap(to_verb(&1)))
        _ -> []
      end
    end)
    |> vocabulary()
  end

  defp to_verb(%{} = def) do
    names = for n <- List.wrap(def["names"]), is_binary(n), do: String.downcase(n)
    forms = for form <- List.wrap(def["forms"]), f = to_form(form), do: f

    if names != [] and forms != [] do
      incomplete = if is_binary(def["incomplete"]), do: def["incomplete"]
      %{names: names, forms: forms, incomplete: incomplete}
    end
  end

  defp to_verb(_), do: nil

  defp to_form(%{"handler" => h, "pattern" => p} = form) when is_binary(h) and is_binary(p) do
    scope = form["scope"]
    indirect = form["indirect_scope"]

    if scope in [nil | @scopes] and indirect in [nil | @scopes],
      do: f(h, p, scope: scope, indirect_scope: indirect)
  end

  defp to_form(_), do: nil

  @doc """
  Every word that starts a command, for clients to complete: each verb's
  names, then the directions and their short forms, then `again`.
  """
  def list(vocabulary \\ vocabulary()) do
    Enum.uniq(
      Enum.flat_map(vocabulary.defs, & &1.names) ++
        @directions ++ Map.keys(@aliases) ++ again_words()
    )
  end
end
