defmodule MuaWorld.Actions do
  @moduledoc """
  mua's built-in actions, ported from `actions/objects.ts`, `locks.ts`,
  `say.ts` and `help.ts`. Each takes the World and a command context (`actor`, `verb`,
  `target_id`, `indirect_id`, `direction`, `text`, and the World's
  `vocabulary`) and returns an outcome:

  - `%{kind: :done, message:, broadcasts:, notices:}`: it acted; the World
    may have changed. A broadcast `{place, message, except}` tells everyone
    in a place; a notice `{place, message, args}` goes to the Scripts of the
    things there.
  - `%{kind: :refused, message:}`: it handled the command by saying no.
  - `:pass`: not its command.

  A world can lock with the `lockable.talk` Script instead, whose answer
  comes first; both must behave the same.
  """

  alias MuaWorld.Messages
  alias MuaWorld.Commands.{Scope, Verbs}

  @built_in ~w(close drop examine help inventory lock open read say sayTo take unlock)

  def built_in?(verb), do: verb in @built_in

  def done(message, broadcasts \\ [], notices \\ []),
    do: %{kind: :done, message: message, broadcasts: broadcasts, notices: notices}

  def refused(message), do: %{kind: :refused, message: message}

  @doc "Runs the built-in action for the context's verb, or passes."
  def run(world, ctx) do
    case ctx.verb do
      "examine" -> examine(world, ctx)
      "take" -> take(world, ctx)
      "drop" -> drop(world, ctx)
      "inventory" -> inventory(world, ctx)
      "open" -> set_closed(world, ctx, false)
      "close" -> set_closed(world, ctx, true)
      "say" -> say(world, ctx)
      "sayTo" -> say_to(world, ctx)
      "help" -> help(world, ctx)
      "read" -> read(world, ctx)
      "lock" -> set_locked(world, ctx, true)
      "unlock" -> set_locked(world, ctx, false)
      _ -> :pass
    end
  end

  defp get(world, eid, name), do: eid && OdgnEcs.get(world, eid, name)

  # -- examine, inventory ------------------------------------------------------

  defp examine(world, ctx) do
    id = ctx[:target_id]

    if get(world, id, "location") || get(world, id, "door") do
      described = get(world, id, "described")
      person? = get(world, id, "player") || get(world, id, "npc")
      container = get(world, id, "container")
      door = get(world, id, "door")
      locked? = (get(world, id, "lockable") || %{})["is_locked"] == true

      first =
        (described && described["description"]) ||
          if(person?,
            do: "You see #{Scope.name_of(world, id)}.",
            else: "You see nothing special."
          )

      door_line =
        if door do
          cond do
            door["is_closed"] != true -> "It is open."
            locked? -> "It is closed and locked."
            true -> "It is closed."
          end
        end

      container_line =
        if container && !person? do
          cond do
            container["is_closed"] == true and locked? ->
              "It is closed and locked."

            container["is_closed"] == true ->
              "It is closed."

            true ->
              case Scope.elements(world, id) do
                [] -> "It is empty."
                inside -> "It contains: #{list_names(inside)}."
              end
          end
        end

      done([first, door_line, container_line] |> Enum.reject(&is_nil/1) |> Enum.join("\n"))
    else
      refused("Examine what?")
    end
  end

  defp inventory(world, ctx) do
    case Scope.elements(world, ctx.actor) do
      [] -> done("You are empty-handed.")
      carried -> done("You are carrying: #{list_names(carried)}.")
    end
  end

  defp list_names(candidates), do: Enum.map_join(candidates, ", ", &Scope.the_name/1)

  # -- take, drop --------------------------------------------------------------

  @doc "Why the target can't be taken, or `nil` if it can."
  def take_refusal(world, ctx) do
    id = ctx[:target_id]

    case get(world, id, "location") do
      nil ->
        # a door is named from either room but lives in neither
        if get(world, id, "door"),
          do: refused("You can't take that."),
          else: refused("Take what?")

      %{"in" => place} ->
        item = get(world, id, "item")

        cond do
          place == ctx.actor -> refused("You already have that.")
          get(world, id, "player") -> refused("You can't take people.")
          !(item && item["is_takeable"]) -> refused("You can't take that.")
          true -> nil
        end
    end
  end

  defp take(world, ctx) do
    case take_refusal(world, ctx) do
      nil ->
        :ok = OdgnEcs.put(world, ctx.target_id, "location", %{"in" => ctx.actor})
        report(world, ctx, "take")

      refusal ->
        refusal
    end
  end

  defp drop(world, ctx) do
    room = Scope.location(world, ctx.actor)

    if get(world, ctx[:target_id], "location") && room do
      :ok = OdgnEcs.put(world, ctx.target_id, "location", %{"in" => room})
      report(world, ctx, "drop")
    else
      refused("Drop what?")
    end
  end

  # `msg` for the actor (or `message` when given), and `omsg` for everyone
  # else in the room
  defp report(world, ctx, handler, message \\ nil) do
    room = Scope.location(world, ctx.actor)
    others = Messages.message_for(world, ctx, handler, "omsg")
    broadcasts = if room && others, do: [{room, others, ctx.actor}], else: []
    done(message || Messages.message_for(world, ctx, handler, "msg") || "", broadcasts)
  end

  # -- open, close -------------------------------------------------------------

  defp set_closed(world, ctx, closed?) do
    verb = if closed?, do: "close", else: "open"
    id = ctx[:target_id]
    container = get(world, id, "container")
    door = if container, do: nil, else: get(world, id, "door")
    component = if container, do: "container", else: "door"
    data = container || door

    cond do
      data == nil or get(world, id, "player") ->
        refused("You can't #{verb} that.")

      !closed? and (get(world, id, "lockable") || %{})["is_locked"] == true ->
        refused("#{capitalise(the_name(world, id))} is locked.")

      data["is_closed"] == true == closed? ->
        refused(
          "#{capitalise(the_name(world, id))} is already #{if closed?, do: "closed", else: "open"}."
        )

      true ->
        :ok = OdgnEcs.put(world, id, component, Map.put(data, "is_closed", closed?))

        inside = if closed? or door, do: [], else: Scope.elements(world, id)

        message =
          if inside != [], do: "Opening #{the_name(world, id)} reveals: #{list_names(inside)}."

        outcome = report(world, ctx, verb, message)

        # the other side of a door sees it move
        if door do
          here = Scope.location(world, ctx.actor)
          line = "#{capitalise(the_name(world, id))} #{if closed?, do: "closes", else: "opens"}."
          beyond = for room <- rooms_of_door(world, id), room != here, do: {room, line, nil}
          %{outcome | broadcasts: outcome.broadcasts ++ beyond}
        else
          outcome
        end
    end
  end

  # -- lock, unlock ------------------------------------------------------------

  # Locks or unlocks the target with a key. With no key named, uses one the
  # actor carries that fits, and says which.
  defp set_locked(world, ctx, locking?) do
    verb = if locking?, do: "lock", else: "unlock"
    id = ctx[:target_id]
    lockable = get(world, id, "lockable")

    cond do
      lockable == nil ->
        refused("You can't #{verb} that.")

      lockable["is_locked"] == locking? ->
        refused("#{capitalise(the_name(world, id))} is already #{verb}ed.")

      locking? and closed?(world, id) == false ->
        refused("You'll have to close #{the_name(world, id)} first.")

      true ->
        case choose_key(world, ctx, lockable["lock"], verb) do
          {:ok, key, chosen} ->
            :ok = OdgnEcs.put(world, id, "lockable", Map.put(lockable, "is_locked", locking?))
            with_key = Map.put(ctx, :indirect_id, key)
            outcome = report(world, with_key, verb)

            message =
              [chosen, outcome.message] |> Enum.reject(&(&1 in [nil, ""])) |> Enum.join("\n")

            %{outcome | message: message}

          refusal ->
            refusal
        end
    end
  end

  defp choose_key(world, ctx, lock, verb) do
    name = the_name(world, ctx.target_id)

    case ctx[:indirect_id] do
      nil ->
        case Enum.find(Scope.elements(world, ctx.actor), &fits?(world, &1.id, lock)) do
          nil -> refused("You need a key to #{verb} #{name}.")
          key -> {:ok, key.id, "(with #{the_name(world, key.id)})"}
        end

      key ->
        cond do
          get(world, key, "key") == nil ->
            refused("You can't #{verb} anything with that.")

          not fits?(world, key, lock) ->
            refused("#{capitalise(the_name(world, key))} doesn't fit.")

          true ->
            {:ok, key, nil}
        end
    end
  end

  defp fits?(world, key, lock), do: lock in ((get(world, key, "key") || %{})["opens"] || [])

  # Whether a container or door is closed; `nil` for anything else
  defp closed?(world, id) do
    case get(world, id, "container") || get(world, id, "door") do
      %{"is_closed" => closed} -> closed == true
      _ -> nil
    end
  end

  defp rooms_of_door(world, door) do
    world
    |> OdgnEcs.query(where: [{"portal", "door", door}])
    |> Enum.map(&Scope.location(world, &1))
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp the_name(world, id) do
    name = (get(world, id, "described") || %{})["name"] || "it"
    Scope.the_name(%{player?: false, name: name})
  end

  # -- say ---------------------------------------------------------------------

  defp say(world, ctx) do
    text = ctx[:text]
    room = Scope.location(world, ctx.actor)

    cond do
      text in [nil, ""] ->
        refused("What do you want to say?")

      room == nil ->
        refused("There is nobody here to hear you.")

      true ->
        done(
          ~s(You say, "#{text}"),
          [{room, ~s(#{Scope.name_of(world, ctx.actor)} says, "#{text}"), ctx.actor}],
          [{room, "heard", [{:entity, ctx.actor}, text]}]
        )
    end
  end

  defp say_to(world, ctx) do
    target = ctx[:target_id]
    text = ctx[:text]

    cond do
      target == nil or !(get(world, target, "player") || get(world, target, "npc")) ->
        refused("They can't hear you.")

      target == ctx.actor ->
        refused("You mutter to yourself.")

      text in [nil, ""] ->
        refused("What do you want to say?")

      true ->
        room = Scope.location(world, ctx.actor)
        name = Scope.name_of(world, target)
        said = ~s(#{Scope.name_of(world, ctx.actor)} says to #{name}, "#{text}")

        if room,
          do:
            done(~s(You say to #{name}, "#{text}"), [{room, said, ctx.actor}], [
              {room, "heard", [{:entity, ctx.actor}, text]}
            ]),
          else: done(~s(You say to #{name}, "#{text}"))
    end
  end

  # -- help, read --------------------------------------------------------------

  defp help(_world, ctx) do
    names =
      (ctx[:vocabulary] || Verbs.vocabulary()).defs |> Enum.map(&hd(&1.names)) |> Enum.uniq()

    short = Verbs.aliases() |> Map.keys() |> Enum.sort() |> Enum.join(", ")

    done(
      Enum.join(
        [
          "Commands: #{Enum.join(names, ", ")}.",
          "Move by naming a direction: north, south, east, west, up, down and so on (or #{short}).",
          "Say something with say, or start with a quote: 'hello.",
          "Repeat the last command with again (g)."
        ],
        "\n"
      )
    )
  end

  defp read(world, ctx) do
    cond do
      ctx[:target_id] == nil -> refused("Read what?")
      readable = get(world, ctx.target_id, "readable") -> done(readable["text"])
      true -> refused("There's nothing written on it.")
    end
  end

  defp capitalise(<<first::utf8, rest::binary>>), do: String.upcase(<<first::utf8>>) <> rest
  defp capitalise(""), do: ""
end
