defmodule MuaWorld.Dispatch do
  @moduledoc """
  What dispatch asks about a command, in turn, ported from
  `actions/index.ts`, `scripted.ts` and `vetoes.ts`:

  1. the receivers: the room it happens in, the second object, then the
     thing acted on. Each is offered the command (`on <verb> role, actor`),
     and a reply handles it;
  2. the veto Decisions of the action, any of which may refuse it;
  3. the action: a built-in (`MuaWorld.Actions`), or for `look` and `move` a
     request to one of mua's Service Scripts;
  4. once it has succeeded, `after<Verb>` (`afterTake`) to the same
     receivers, whose replies are added to the action's.

  Each question is answered by a fixed reply from the entity's `responses`
  first, else by its Scripts. The World process asks them
  (`MuaWorld.run_dispatch/3`), so a Script may answer in a later Step.

  A question is a map: `asks` (`:offer` or `:decide`), `to` (an entity id
  or `{:service, name}`), `message`, `args` (text, or `{:entity, eid}`),
  `response` (a fixed reply or `nil`) and `kind` (`:receiver` or `:veto`).
  """

  alias MuaWorld.{Actions, Exits}
  alias MuaWorld.Commands.Scope

  @cannot "You can't do that."
  def cannot, do: @cannot

  @doc "The questions asked before the action runs, in order."
  def questions(world, ctx), do: receivers(world, ctx) ++ vetoes(world, ctx)

  @doc "The `after<Verb>` questions, asked of the receivers once the action has succeeded."
  def afters(world, ctx) do
    message = "after" <> String.upcase(String.first(ctx.verb)) <> String.slice(ctx.verb, 1..-1//1)
    for q <- receivers(world, ctx), do: %{q | message: message, response: nil}
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
        args: [role, {:entity, ctx.actor}],
        response: response(world, id, role, ctx.verb)
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
        args: [{:entity, ctx.actor}, {:entity, subject}],
        response: response(world, to, "veto", event)
      }
    end
  end

  # Questions asked before an action changes the World, as Decisions. Any
  # entity asked can veto, by a fixed `responses { veto: { <event>: ... } }`
  # or a handler `on <event> actor, subject, deciding` that runs `veto`.
  # Which Decisions a Verb raises is World data, its `vetoes`; each names
  # who is asked and what about as a role. When a role is missing, such as
  # a move with no exit, or the action would refuse anyway, none is asked.
  defp veto_events(world, ctx) do
    vetoes = get_in(ctx, [:vocabulary, :vetoes, ctx.verb]) || []

    if vetoes == [] or refuses?(world, ctx) do
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

  defp refuses?(world, %{verb: "take"} = ctx), do: Actions.take_refusal(world, ctx) != nil
  defp refuses?(_world, _ctx), do: false

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

  # A fixed reply from an entity's `responses`, by role (or `veto`) and key
  defp response(_world, {:service, _}, _, _), do: nil

  defp response(world, id, role, key) do
    case OdgnEcs.get(world, id, "responses") do
      %{^role => %{^key => reply}} when is_binary(reply) -> reply
      _ -> nil
    end
  end

  # -- Scripted actions --------------------------------------------------------

  @doc "Whether a verb's action is one of mua's Service Scripts."
  def scripted?(verb), do: verb in ["look", "move"]

  @doc """
  What to send for a scripted action: `{:send, {:service, name}, message,
  args}`, or `{:refused, message}` when it can't happen. Ask before the
  action runs: once it has, the World has changed.
  """
  def plan(world, %{verb: "look"} = ctx) do
    case Scope.location(world, ctx.actor) do
      nil -> {:refused, "You are nowhere."}
      room -> {:send, {:service, "room"}, "look", [{:entity, room}, {:entity, ctx.actor}]}
    end
  end

  def plan(world, %{verb: "move"} = ctx) do
    case plan_move(world, ctx) do
      {:go, exit, from, to} ->
        {:send, {:service, "exit"}, "traverse",
         [{:entity, exit}, {:entity, ctx.actor}, {:entity, from}, {:entity, to}]}

      {:refused, _} = refused ->
        refused
    end
  end

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
