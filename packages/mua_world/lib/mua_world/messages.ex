defmodule MuaWorld.Messages do
  @moduledoc """
  The messages built-in actions use, ported from `actions/messages.ts`. A
  thing overrides them with a `messages` component, by who sees them (`msg`
  the actor, `omsg` everyone else in the room) and the verb's handler:
  `messages { omsg: { take: "{actor} heaves {the target} onto a shoulder." } }`.
  """

  alias MuaWorld.Commands.Scope

  @defaults %{
    "arrive" => %{"omsg" => "{actor} arrives."},
    "close" => %{"msg" => "Closed.", "omsg" => "{actor} closes {the target}."},
    "drop" => %{"msg" => "Dropped.", "omsg" => "{actor} drops {the target}."},
    "lock" => %{
      "msg" => "You lock {the target} with {the indirect}.",
      "omsg" => "{actor} locks {the target}."
    },
    "move" => %{"omsg" => "{actor} goes {dir}."},
    "open" => %{"msg" => "Opened.", "omsg" => "{actor} opens {the target}."},
    "take" => %{"msg" => "Taken.", "omsg" => "{actor} takes {the target}."},
    "unlock" => %{
      "msg" => "You unlock {the target} with {the indirect}.",
      "omsg" => "{actor} unlocks {the target}."
    }
  }

  @doc """
  Fills in `{actor}`, `{target}`, `{the target}`, `{indirect}`,
  `{the indirect}` and `{dir}`. A capital (`{Actor}`, `{The target}`)
  capitalises the value. Unknown placeholders are left as written.
  """
  def render(template, values) do
    Regex.replace(~r/{(the |The )?(\w+)}/, template, fn whole, article, key ->
      name = String.downcase(key)
      value = if article != "", do: get_in(values, [:the, name]), else: values[name]

      cond do
        value == nil -> whole
        Regex.match?(~r/^[A-Z]/, if(article != "", do: article, else: key)) -> capitalise(value)
        true -> value
      end
    end)
  end

  @doc "The values a command's messages can refer to."
  def values(world, ctx) do
    actor = named(world, ctx.actor)
    target = named(world, ctx[:target_id])
    indirect = named(world, ctx[:indirect_id])

    %{
      "actor" => (actor && actor.name) || "Someone",
      "dir" => ctx[:direction],
      "indirect" => indirect && String.downcase(indirect.name),
      "target" => target && String.downcase(target.name),
      the: %{
        "indirect" => indirect && Scope.the_name(indirect),
        "target" => target && Scope.the_name(target)
      }
    }
  end

  defp named(_world, nil), do: nil

  defp named(world, eid) do
    player = OdgnEcs.get(world, eid, "player")
    described = OdgnEcs.get(world, eid, "described")

    case (player && player["name"]) || (described && described["name"]) do
      nil -> nil
      name -> %{name: name, player?: player != nil}
    end
  end

  @doc """
  The message for a handler: the one on `owner`'s `messages` (its own or
  inherited), else the default. `nil` when there is neither. `owner` is the
  target by default.
  """
  def message_for(world, ctx, handler, kind, owner \\ :target) do
    owner = if owner == :target, do: ctx[:target_id], else: owner

    owned =
      case owner && OdgnEcs.get(world, owner, "messages") do
        %{^kind => %{} = table} -> table
        _ -> %{}
      end

    case owned[handler] || get_in(@defaults, [handler, kind]) do
      template when is_binary(template) -> render(template, values(world, ctx))
      _ -> nil
    end
  end

  defp capitalise(<<first::utf8, rest::binary>>), do: String.upcase(<<first::utf8>>) <> rest
  defp capitalise(""), do: ""
end
