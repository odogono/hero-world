defmodule MuaWorld.Lifecycle do
  @moduledoc """
  Homes, resets and the World's start, ported from `world/lifecycle.ts`, and
  mua's own timers, ported from `world/timers.ts`.

  - **Homes:** where each thing starts, so a reset can put it back. Things
    already given a home keep it; Characters and exits have none.
  - **Reset:** puts back every thing whose home is the place and that has
    wandered, unless a Character is carrying it, then tells the place's
    Scripts.
  - **`timers { every: { message: seconds } }`:** kept as `talk_timer`s
    under the script name `mua:timers`, one interval apart. `reset` resets
    the place; any other message goes to the entity's Scripts from the
    system actor.
  """

  @timers "mua:timers"

  def timers_script, do: @timers

  @doc "Gives every located thing without one a home: where it is now."
  def record_homes(world) do
    for eid <- OdgnEcs.query(world, with: ["location"]),
        OdgnEcs.get(world, eid, "home") == nil,
        OdgnEcs.get(world, eid, "player") == nil,
        OdgnEcs.get(world, eid, "portal") == nil,
        do:
          :ok =
            OdgnEcs.put(world, eid, "home", %{"in" => OdgnEcs.get(world, eid, "location")["in"]})

    :ok
  end

  @doc "Puts back what has strayed from `place`. Returns how many things moved."
  def put_back(world, place) do
    strays =
      for eid <- OdgnEcs.query(world, where: [{"home", "in", place}]),
          (OdgnEcs.get(world, eid, "location") || %{})["in"] != place,
          not carried?(world, eid),
          do: eid

    for eid <- strays, do: :ok = OdgnEcs.put(world, eid, "location", %{"in" => place})
    length(strays)
  end

  # Is a Character holding this, directly or inside something they carry?
  defp carried?(world, eid, seen \\ MapSet.new()) do
    case (OdgnEcs.get(world, eid, "location") || %{})["in"] do
      nil ->
        false

      holder ->
        cond do
          MapSet.member?(seen, holder) -> false
          OdgnEcs.get(world, holder, "player") != nil -> true
          true -> carried?(world, holder, MapSet.put(seen, eid))
        end
    end
  end

  @doc "The seconds between an entity's `message` timers, if it has them."
  def interval(world, owner, message) do
    case (OdgnEcs.get(world, owner, "timers") || %{})["every"] do
      %{^message => seconds} when is_number(seconds) and seconds > 0 -> seconds
      _ -> nil
    end
  end

  @doc """
  Stores the first of each entity's `timers`, one interval from `now_us`,
  unless one is stored already, as after a restart.
  """
  def arm(world, talk, now_us) do
    stored = MapSet.new(OdgnEcsTalk.timers(talk, @timers), &{&1["owner"], &1["name"]})

    for owner <- OdgnEcs.query(world, with: ["timers"]),
        {message, _} <- OdgnEcs.get(world, owner, "timers")["every"] || %{},
        seconds = interval(world, owner, message),
        not MapSet.member?(stored, {owner, message}),
        do: store(talk, owner, message, now_us + round(seconds * 1_000_000))

    :ok
  end

  @doc """
  The next of a timer that has fallen due: one interval after it, or, after
  a long pause, once rather than once per interval missed.
  """
  def rearm(world, talk, timer, now_us) do
    case interval(world, timer["owner"], timer["message"]) do
      nil ->
        :ok

      seconds ->
        store(
          talk,
          timer["owner"],
          timer["message"],
          max(timer["at"] + round(seconds * 1_000_000), now_us + 1)
        )
    end
  end

  defp store(talk, owner, message, at),
    do:
      :ok =
        OdgnEcsTalk.schedule(talk, %{
          owner: owner,
          script: @timers,
          name: message,
          at: at,
          message: message
        })
end
