defmodule MuaWorld.Talk do
  @moduledoc """
  mua's own Capability for Scripts, beside `odgn_ecs_talk`'s `world`, `clock`
  and `timer`, ported from `scripts/mua-capability.ts`:

  - `announce place, text, except`: tells every Character in `place` but
    `except` (which may be Nothing).
  - `command`: the command the Script is handling, as a map of `verb`,
    `actor`, `target`, `indirect`, `text` and `direction` (Nothing for any it
    doesn't have), or Nothing outside a command.
  - `homed place`: the things whose `home` is `place`, for a reset.
  - `notice place, message, who, text`: sends `message who` (or
    `message who, text` when `text` is given) to the Scripts of the things
    in a place but `who`, once the Run's Pump ends.
  - `verbs`: the World's Verbs, as a map of `names` (each Verb's first
    name) and `aliases` (the Direction Aliases), for `help`.

  - `act actor, command`: has an NPC carry out a command as a Character
    would, as a Step of its own after the current one commits (ADR 0003).
    The command is a line to parse, or one already bound: a map of `verb`
    and any of `target`, `indirect`, `direction` and `text`, which skips
    the parser (ADR 0024).

  Scripts fill in message templates themselves, with the `messages`
  Library; the Host formats no text (ADR 0024).

  Callbacks run in NorthTalk's Tasks while the World process is blocked in a
  Pump (ADR 0015). They write the outbox inside the World's transaction, and
  share the World process's table for queued notices. The command a Run
  handles is the host term of its Delivery (`OdgnEcsTalk.delivery/2`).
  """
  alias NorthTalk.{Capability, Object}
  alias OdgnEcsTalk.Values

  # odgn_ecs_talk's default Group, whose Handles are `entity` Objects
  @group "world"

  @doc "A table for queued notices, shared with callbacks."
  def table, do: :ets.new(:mua_talk, [:set, :public])

  @doc "The notices Scripts asked for since the last call, oldest first."
  def take_notices(table) do
    notices =
      for {{:notice, n}, notice} <- :ets.match_object(table, {{:notice, :_}, :_}), do: {n, notice}

    :ets.match_delete(table, {{:notice, :_}, :_})
    notices |> Enum.sort() |> Enum.map(&elem(&1, 1))
  end

  # The command a Run handles, or `nil` for a Delivery sent without one
  defp context(talk, call) do
    case OdgnEcsTalk.delivery(talk, call) do
      %{host: context} -> context
      nil -> nil
    end
  end

  defp handle(nil), do: nil
  defp handle(eid), do: %Object{kind: "entity", id: Integer.to_string(eid), group: @group}

  @doc "The `mua` Capability, for `OdgnEcsTalk.start/2`'s `:capabilities`."
  def mua(world, table, talk) do
    entity = %{"object" => "entity"}
    optional = %{"optional" => entity}

    Capability.from_functions("mua", %{
      "act" =>
        {[args: [entity, "any"], cost: 1, mode: :fire_and_forget, command: true],
         fn [actor, command], _ ->
           MuaWorld.Tables.queue_act(world, Values.from_value(actor), Values.from_value(command))
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
           case context(talk, call) do
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
      "homed" =>
        {[args: [entity], result: %{"list" => entity}, cost: 1],
         fn [place], _ ->
           place = Values.from_value(place)
           {:ok, Enum.map(OdgnEcs.query(world, where: [{"home", "in", place}]), &handle/1)}
         end},
      "notice" =>
        {[
           args: [entity, "text", entity, %{"optional" => "text"}],
           cost: 1,
           mode: :fire_and_forget,
           command: true
         ],
         fn [place, message, who | rest], _ ->
           n = :erlang.unique_integer([:monotonic])
           args = [{:entity, Values.from_value(who)} | Enum.reject(rest, &is_nil/1)]
           :ets.insert(table, {{:notice, n}, {Values.from_value(place), message, args}})
           :noreply
         end},
      "verbs" =>
        {[args: [], result: "any", cost: 1],
         fn [], call ->
           case context(talk, call) do
             %{vocabulary: vocabulary} ->
               {:ok,
                NorthTalk.Map.new([
                  {"aliases", vocabulary.aliases |> Map.keys() |> Enum.sort()},
                  {"names", vocabulary.defs |> Enum.map(&hd(&1.names)) |> Enum.uniq()}
                ])}

             _ ->
               {:ok, nil}
           end
         end}
    })
  end
end
