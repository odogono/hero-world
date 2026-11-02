defmodule MuaWorld.Talk do
  @moduledoc """
  mua's own Capability for Scripts, beside `odgn_ecs_talk`'s `world`, `clock`
  and `timer`, ported from `scripts/mua-capability.ts`:

  - `announce place, text, except`: tells every Character in `place` but
    `except` (which may be Nothing).
  - `command`: the command the Script is handling, as a map of `verb`,
    `actor`, `target`, `indirect`, `text` and `direction` (Nothing for any it
    doesn't have), or Nothing outside a command.
  - `message handler, kind, indirect, owner`: a built-in message for the
    command being handled (`MuaWorld.Messages`): `kind` is `"msg"` or
    `"omsg"`, `indirect` stands in for the command's second object, and
    `owner`, if given, is the entity whose `messages` are used in place of
    the target's, as the exit is for `move`.
  - `notice place, message, who`: sends `message who` to the Scripts of the
    things in a place but `who`, once the Run's Pump ends.

  - `act actor, command`: has an NPC carry out a command as a Character
    would, as a Step of its own after the current one commits (ADR 0003).

  Callbacks run in NorthTalk's Tasks while the World process is blocked in a
  Pump (ADR 0015). They write the outbox inside the World's transaction, and
  share the World process's table for command contexts and queued notices.
  """
  alias MuaWorld.Messages
  alias NorthTalk.{Capability, Object}
  alias OdgnEcsTalk.Values

  # odgn_ecs_talk's default Group, whose Handles are `entity` Objects
  @group "world"

  @doc "A table for command contexts and queued notices, shared with callbacks."
  def table, do: :ets.new(:mua_talk, [:set, :public])

  @doc """
  Notes the command a Request or Decision is for. `delivery` is its delivery
  id, or `:current` for a Request whose id isn't known until its first Pump
  has run.
  """
  def note_context(table, delivery, context),
    do: :ets.insert(table, {{:context, delivery}, context})

  def drop_context(table, delivery), do: :ets.delete(table, {:context, delivery})

  @doc "The notices Scripts asked for since the last call, oldest first."
  def take_notices(table) do
    notices =
      for {{:notice, n}, notice} <- :ets.match_object(table, {{:notice, :_}, :_}), do: {n, notice}

    :ets.match_delete(table, {{:notice, :_}, :_})
    notices |> Enum.sort() |> Enum.map(&elem(&1, 1))
  end

  defp context(table, call) do
    case call.delivery && :ets.lookup(table, {:context, call.delivery}) do
      [{_, context}] ->
        context

      _ ->
        case :ets.lookup(table, {:context, :current}) do
          [{_, context}] -> context
          [] -> nil
        end
    end
  end

  defp handle(nil), do: nil
  defp handle(eid), do: %Object{kind: "entity", id: Integer.to_string(eid), group: @group}

  def mua(world, table) do
    entity = %{"object" => "entity"}
    optional = %{"optional" => entity}

    Capability.from_functions("mua", %{
      "act" =>
        {[args: [entity, "text"], cost: 1, mode: :fire_and_forget, command: true],
         fn [actor, text], _ ->
           MuaWorld.Tables.queue_act(world, Values.from_value(actor), text)
           :noreply
         end},
      "announce" =>
        {[args: [entity, "text", optional], cost: 1, mode: :fire_and_forget, command: true],
         fn [place, text, except], _ ->
           except = except && Values.from_value(except)

           for c <- MuaWorld.Tables.characters_at(world, Values.from_value(place)),
               c != except,
               do: MuaWorld.Tables.output(world, c, text)

           :noreply
         end},
      "command" =>
        {[args: [], result: "any", cost: 1],
         fn [], call ->
           case context(table, call) do
             nil ->
               {:ok, nil}

             ctx ->
               {:ok,
                NorthTalk.Map.new([
                  {"actor", handle(ctx.actor)},
                  {"direction", ctx[:direction]},
                  {"indirect", handle(ctx[:indirect_id])},
                  {"target", handle(ctx[:target_id])},
                  {"text", ctx[:text]},
                  {"verb", ctx.verb}
                ])}
           end
         end},
      # `indirect` and `owner` are optional, and a Script may leave them out
      "message" => {
        [args: ["text", "text", optional, optional], result: "any", cost: 1],
        fn [handler, kind | rest], call ->
          [indirect, owner] = Enum.take(rest ++ [nil, nil], 2)
          ctx = context(table, call)

          if ctx && kind in ["msg", "omsg"] do
            ctx =
              if indirect,
                do: Map.put(ctx, :indirect_id, Values.from_value(indirect)),
                else: ctx

            owner = if owner, do: Values.from_value(owner), else: :target
            {:ok, Messages.message_for(world, ctx, handler, kind, owner)}
          else
            {:ok, nil}
          end
        end
      },
      "notice" =>
        {[args: [entity, "text", entity], cost: 1, mode: :fire_and_forget, command: true],
         fn [place, message, who], _ ->
           n = :erlang.unique_integer([:monotonic])

           :ets.insert(
             table,
             {{:notice, n}, {Values.from_value(place), message, Values.from_value(who)}}
           )

           :noreply
         end}
    })
  end
end
