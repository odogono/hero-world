defmodule MuaWorld.Case do
  @moduledoc false
  # Starts a World from a fixture EDL and drives it as Characters do.

  @fixtures Path.expand("fixtures", __DIR__)

  def fixture(name), do: Path.join(@fixtures, name)

  @doc "A World built from `fixtures/<name>`, in `dir`, ticking by hand."
  def start(name, dir, opts \\ []) do
    path = Keyword.get(opts, :path, Path.join(dir, "world.db"))
    {:ok, world} = MuaWorld.start([path: path, edl: fixture(name), tick: :manual] ++ opts)
    world
  end

  @doc "Makes a Character in the starting room, subscribed to its output."
  def join(world, name, place \\ "west_of_house") do
    eid = MuaWorld.spawn(world, name, place)
    :ok = MuaWorld.subscribe(world, eid)
    eid
  end

  @doc "Sends a command and returns what its Character was told, one line per message."
  def send_command(world, eid, text) do
    {:ok, lines} = MuaWorld.command(world, eid, text)
    Enum.join(lines, "\n")
  end

  @doc "The lines a Character has been sent since the last call."
  def received(eid, acc \\ []) do
    receive do
      {:mua, ^eid, text} -> received(eid, [text | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end
end

# Every World starts a NorthTalk reactor, which is CPU-heavy: too many at once
# starve each other on a small CI runner past NorthTalk's 5 s call timeout.
ExUnit.start(max_cases: 2)
