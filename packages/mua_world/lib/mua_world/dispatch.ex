defmodule MuaWorld.Dispatch do
  @moduledoc """
  What dispatch asks about a command, in turn (ADR 0024):

  1. the receivers: the room it happens in, the second object, then the
     thing acted on. Each is offered the command (`on <verb> role, actor`),
     and a reply handles it;
  2. the veto Decisions of the action, any of which may refuse it;
  3. the Action: a request to one of mua's Service Scripts
     (`packages/mua-scripts/scripts/services`);
  4. once it has succeeded, `after<Verb>` (`afterTake`) to the same
     receivers, whose replies are added to the action's.

  Every question goes to a Message Path or a Service Script: a thing's
  fixed `responses` are answered by the `responsive` base Script it
  extends. A Script may answer in a later Step: what is left of the
  command waits for it (a Waiting input), and so do the commands after it.

  `run/5` is the whole of it: a Character's or an NPC's bound commands, run
  within the current Step. The actor is told each command's outcome.
  """

  require Logger

  alias MuaWorld.{Exits, Talk, Tables}
  alias MuaWorld.Commands.Scope
  alias OdgnEcsEngine.{Delivery, Step}

  @cannot "You can't do that."
  @failed "Something went wrong."

  @doc """
  Runs `commands`, bound by `MuaWorld.Input`, for `actor` within `step`, in
  turn. `raw` is the line they came from, and `vocabulary` the World's
  Verbs. Each command's outcome is told to the actor, prefixed with its
  `label` when it has one. Returns `:ok`; a command still waiting on a
  Script finishes, and the ones after it run, in the Step that sees it
  answered.
  """
  def run(%Step{} = step, vocabulary, actor, commands, raw) do
    run_commands(step, vocabulary, actor, commands, raw)
    :ok
  end

  defp run_commands(_step, _vocabulary, _actor, [], _raw), do: :ok

  defp run_commands(step, vocabulary, actor, [command | rest], raw) do
    ctx =
      command
      |> Map.take([:verb, :target, :indirect, :target_id, :indirect_id, :direction, :text])
      |> Map.merge(%{actor: actor, raw: raw, vocabulary: vocabulary})

    ask_each(step, ctx, questions(step.world, ctx), fn step, outcome ->
      tell(step, ctx.actor, outcome.message, command[:label])
      run_commands(step, vocabulary, actor, rest, raw)
    end)
  end

  # The questions before the action, in order. A receiver's reply handles
  # the command; a veto's refuses it; a pass asks the next.
  defp ask_each(step, ctx, [], k), do: run_action(step, ctx, k)

  defp ask_each(step, ctx, [q | rest], k) do
    if answerable?(step, q.to) do
      ask(step, ctx, q, fn step, reply ->
        case {reply, q.kind} do
          {{:replied, message}, :receiver} -> k.(step, done(message || ""))
          {{:replied, message}, :veto} -> k.(step, refused(message || @cannot))
          {{:refused, message}, _} -> k.(step, refused(message))
          {:passed, _} -> ask_each(step, ctx, rest, k)
        end
      end)
    else
      ask_each(step, ctx, rest, k)
    end
  end

  defp run_action(step, ctx, k) do
    case plan(step.world, ctx) do
      {:refused, message} ->
        k.(step, refused(message))

      {:send, to, message, args} ->
        q = %{kind: :action, asks: :offer, to: to, message: message, args: args}

        ask(step, ctx, q, fn step, reply ->
          case reply do
            {:replied, message} ->
              after_each(step, ctx, afters(step.world, ctx), done(message || ""), k)

            {:refused, message} ->
              k.(step, refused(message))

            :passed ->
              k.(step, refused(@cannot))
          end
        end)
    end
  end

  # What a command came to: `:done` when it acted, `:refused` when it was
  # answered with a no
  defp done(message), do: %{kind: :done, message: message}
  defp refused(message), do: %{kind: :refused, message: message}

  # Once an action has succeeded, `after<Verb>` goes to the same receivers,
  # whose replies are added to its message.
  defp after_each(step, _ctx, [], outcome, k), do: k.(step, outcome)

  defp after_each(step, ctx, [q | rest], outcome, k) do
    if answerable?(step, q.to) do
      ask(step, ctx, q, fn step, reply ->
        after_each(step, ctx, rest, merge(outcome, reply), k)
      end)
    else
      after_each(step, ctx, rest, outcome, k)
    end
  end

  defp merge(outcome, {:replied, line}) when line not in [nil, ""],
    do: %{outcome | message: Enum.join(Enum.reject([outcome.message, line], &(&1 == "")), "\n")}

  defp merge(outcome, _reply), do: outcome

  defp answerable?(_step, {:service, _}), do: true
  defp answerable?(step, eid), do: OdgnEcsTalk.scripted?(step.talk, eid)

  # Sends one question and answers `k` now or, if its Run is still waiting,
  # in the Step that sees it end.
  defp ask(step, ctx, q, k) do
    delivery = %Delivery{
      to: q.to,
      message: q.message,
      args: Enum.map(q.args, &Talk.value(step.talk, &1)),
      asks: if(q.asks == :offer, do: :request, else: :decide),
      host: ctx
    }

    waiting = %{actor: ctx.actor, input: ctx.raw}

    OdgnEcsEngine.ask(step, delivery, waiting, fn step, outcome -> k.(step, reply(q, outcome)) end)
  end

  # What a question's outcome means to Dispatch: a Decision's veto is its
  # answer, as a reply is a Request's. A Script that fails refuses the
  # command with "Something went wrong."
  # A Request says no by replying `{refused: text}`; any other map is a
  # mistake, so fails rather than counting as having acted.
  defp reply(%{asks: :offer} = q, {:replied, %NorthTalk.Map{} = value}) do
    case NorthTalk.Map.get(value, "refused") do
      text when is_binary(text) ->
        {:refused, text}

      _ ->
        Logger.error(
          "#{q.message} to #{inspect(q.to)} replied #{MuaWorld.Admin.show(value)}: " <>
            "a Request replies text, nothing, or {refused: text}",
          event: :malformed_reply
        )

        {:refused, @failed}
    end
  end

  defp reply(%{asks: :offer}, {:replied, value}), do: {:replied, if(is_binary(value), do: value)}

  defp reply(%{asks: :decide}, {:vetoed, reason}),
    do: {:replied, if(is_binary(reason), do: reason)}

  defp reply(_, :passed), do: :passed
  defp reply(_, _), do: {:refused, @failed}

  # Tells the actor. Everyone else who saw it, and the Scripts that notice
  # it, were told by the Service Script.
  defp tell(_step, _actor, message, _label) when message in [nil, ""], do: :ok

  defp tell(step, actor, message, label),
    do: Tables.output(step.world, actor, if(label, do: "#{label}: #{message}", else: message))

  # -- Questions ---------------------------------------------------------------

  # A question is a map: `asks` (`:offer` or `:decide`), `to` (an entity id
  # or `{:service, name}`), `message`, `args` (text, Nothing, or
  # `{:entity, eid}`) and `kind` (`:receiver`, `:veto` or `:action`).

  defp questions(world, ctx), do: receivers(world, ctx) ++ vetoes(world, ctx)

  defp afters(world, ctx) do
    message = "after" <> String.upcase(String.first(ctx.verb)) <> String.slice(ctx.verb, 1..-1//1)
    for q <- receivers(world, ctx), do: %{q | message: message}
  end

  defp receivers(world, ctx) do
    [
      {"room", Scope.location(world, ctx.actor)},
      {"indirect", ctx[:indirect_id]},
      {"target", ctx[:target_id]}
    ]
    |> Enum.reject(fn {_, id} -> is_nil(id) end)
    |> Enum.map(fn {role, id} ->
      %{
        kind: :receiver,
        asks: :offer,
        to: id,
        message: ctx.verb,
        args: [role, {:entity, ctx.actor}]
      }
    end)
  end

  defp vetoes(world, ctx) do
    for {event, to, subject} <- veto_events(world, ctx) do
      %{
        kind: :veto,
        asks: :decide,
        to: to,
        message: event,
        args: [{:entity, ctx.actor}, {:entity, subject}]
      }
    end
  end

  # Questions asked before an action changes the World, as Decisions. Any
  # entity asked can veto, with a handler `on <event> actor, subject,
  # deciding` that runs `veto`. Which Decisions a Verb raises is World data,
  # its `vetoes`; each names who is asked and what about as a role. When a
  # role is missing, such as a move with no exit, none is asked.
  defp veto_events(world, ctx) do
    vetoes = get_in(ctx, [:vocabulary, :vetoes, ctx.verb]) || []

    if vetoes == [] do
      []
    else
      roles = roles(world, ctx)

      events =
        for %{event: event, asks: asks, about: about} <- vetoes,
            do: {event, role(roles, asks), role(roles, about)}

      if Enum.any?(events, fn {_, to, subject} -> to == nil or subject == nil end),
        do: [],
        else: events
    end
  end

  defp roles(world, ctx) do
    target = ctx[:target_id]

    move =
      case ctx.verb == "move" && plan_move(world, ctx) do
        {:go, exit, from, to} -> %{"exit" => exit, "from" => from, "to" => to}
        _ -> %{}
      end

    Map.merge(move, %{
      "actor" => ctx.actor,
      "target" => target,
      "holder" => target && Scope.location(world, target),
      "room" => Scope.location(world, ctx.actor)
    })
  end

  defp role(_roles, "service:" <> name), do: {:service, name}
  defp role(roles, name), do: roles[name]

  # -- Scripted actions --------------------------------------------------------

  # The Service Script that carries out each Verb's Action, sent
  # `<verb> target, actor` (`target` may be Nothing)
  @services %{
    "close" => "open",
    "drop" => "thing",
    "examine" => "thing",
    "help" => "help",
    "inventory" => "thing",
    "lock" => "lock",
    "open" => "open",
    "read" => "thing",
    "take" => "thing",
    "unlock" => "lock"
  }

  @doc "The Service Scripts mua loads, by name."
  def services, do: ~w(room exit lock thing open speech help lifecycle build)

  # What to send for an action: `{:send, {:service, name}, message, args}`,
  # or `{:refused, message}` when it can't happen. The Service replies text
  # when it acted, or `{refused: text}` when it said no. Ask before the
  # action runs: once it has, the World has changed.
  defp plan(world, %{verb: "look"} = ctx) do
    case Scope.location(world, ctx.actor) do
      nil -> {:refused, "You are nowhere."}
      room -> {:send, {:service, "room"}, "look", [{:entity, room}, {:entity, ctx.actor}]}
    end
  end

  defp plan(_world, %{verb: verb} = ctx) when verb in ["say", "sayTo"],
    do: {:send, {:service, "speech"}, verb, [target(ctx), {:entity, ctx.actor}, ctx[:text]]}

  defp plan(world, %{verb: "move"} = ctx) do
    case plan_move(world, ctx) do
      {:go, exit, from, to} ->
        {:send, {:service, "exit"}, "traverse",
         [{:entity, exit}, {:entity, ctx.actor}, {:entity, from}, {:entity, to}]}

      {:refused, _} = refused ->
        refused
    end
  end

  defp plan(_world, %{verb: verb} = ctx) do
    case @services[verb] do
      nil -> {:refused, @cannot}
      service -> {:send, {:service, service}, verb, [target(ctx), {:entity, ctx.actor}]}
    end
  end

  defp target(ctx), do: if(id = ctx[:target_id], do: {:entity, id})

  # Where a move goes: `{:go, exit, from, to}`, or why it can't happen.
  # Whether a door lets the actor through is the exit Service's
  # `beforeTraverse` Decision.
  defp plan_move(world, ctx) do
    direction = ctx[:direction]
    from = Scope.location(world, ctx.actor)

    cond do
      direction == nil ->
        {:refused, "Which direction?"}

      from == nil ->
        {:refused, "You are nowhere."}

      true ->
        case Exits.find(world, from, direction) do
          nil ->
            {:refused, "You can't go #{direction} from here."}

          exit ->
            case OdgnEcs.get(world, exit, "portal") do
              %{"to" => to} when is_integer(to) -> {:go, exit, from, to}
              portal -> {:refused, portal["msg"] || "That exit leads nowhere."}
            end
        end
    end
  end
end
