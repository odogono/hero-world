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
  extends. The World process asks them (`MuaWorld.run_dispatch/3`), so a
  Script may answer in a later Step.

  A question is a map: `asks` (`:offer` or `:decide`), `to` (an entity id
  or `{:service, name}`), `message`, `args` (text, Nothing, or
  `{:entity, eid}`) and `kind` (`:receiver` or `:veto`).
  """

  alias MuaWorld.Exits
  alias MuaWorld.Commands.Scope

  @cannot "You can't do that."
  def cannot, do: @cannot

  @doc "The questions asked before the action runs, in order."
  def questions(world, ctx), do: receivers(world, ctx) ++ vetoes(world, ctx)

  @doc "The `after<Verb>` questions, asked of the receivers once the action has succeeded."
  def afters(world, ctx) do
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
  def services, do: ~w(room exit lock thing open speech help)

  @doc """
  What to send for an action: `{:send, {:service, name}, message, args}`,
  or `{:refused, message}` when it can't happen. The Service replies text
  when it acted, or `{refused: text}` when it said no. Ask before the
  action runs: once it has, the World has changed.
  """
  def plan(world, %{verb: "look"} = ctx) do
    case Scope.location(world, ctx.actor) do
      nil -> {:refused, "You are nowhere."}
      room -> {:send, {:service, "room"}, "look", [{:entity, room}, {:entity, ctx.actor}]}
    end
  end

  def plan(_world, %{verb: verb} = ctx) when verb in ["say", "sayTo"],
    do: {:send, {:service, "speech"}, verb, [target(ctx), {:entity, ctx.actor}, ctx[:text]]}

  def plan(world, %{verb: "move"} = ctx) do
    case plan_move(world, ctx) do
      {:go, exit, from, to} ->
        {:send, {:service, "exit"}, "traverse",
         [{:entity, exit}, {:entity, ctx.actor}, {:entity, from}, {:entity, to}]}

      {:refused, _} = refused ->
        refused
    end
  end

  def plan(_world, %{verb: verb} = ctx) do
    case @services[verb] do
      nil -> {:refused, @cannot}
      service -> {:send, {:service, service}, verb, [target(ctx), {:entity, ctx.actor}]}
    end
  end

  defp target(ctx), do: if(id = ctx[:target_id], do: {:entity, id})

  @doc """
  Where a move goes: `{:go, exit, from, to}`, or why it can't happen.
  Whether a door lets the actor through is the exit Service's
  `beforeTraverse` Decision.
  """
  def plan_move(world, ctx) do
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
