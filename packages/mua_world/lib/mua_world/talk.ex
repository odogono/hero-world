defmodule MuaWorld.Talk do
  @moduledoc """
  mua's own Capability for Scripts, beside `odgn_ecs_talk`'s `world`, `clock`
  and `timer`. For now it has only `announce place, text, except`, a Host
  Command that tells every Character in `place` but `except` (which may be
  Nothing). The rest of TS's `mua` (`act`, `command`, `message`, `notice`)
  comes with the gameplay it serves (#113, #114, #116).

  Callbacks run in NorthTalk's Tasks while the World process is blocked in a
  Pump, and write the World's outbox inside its transaction (ADR 0015).
  """
  alias NorthTalk.Capability
  alias OdgnEcsTalk.Values

  def mua(world) do
    entity = %{"object" => "entity"}

    Capability.from_functions("mua", %{
      "announce" =>
        {[
           args: [entity, "text", %{"optional" => entity}],
           cost: 1,
           mode: :fire_and_forget,
           command: true
         ],
         fn [place, text, except], _ ->
           except = except && Values.from_value(except)

           for c <- MuaWorld.Tables.characters_at(world, Values.from_value(place)),
               c != except,
               do: MuaWorld.Tables.output(world, c, text)

           :noreply
         end}
    })
  end
end
