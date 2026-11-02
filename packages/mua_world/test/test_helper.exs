defmodule MuaWorld.Case do
  @moduledoc false
  # Starts a World from a fixture EDL and drives it as Characters do.

  @fixtures Path.expand("fixtures", __DIR__)

  def fixture(name), do: Path.join(@fixtures, name)

  @doc """
  A World built from `fixtures/<name>`, in `dir`, ticking by hand. Its
  Starting room is `west_of_house` unless `starting_room:` says otherwise.
  """
  def start(name, dir, opts \\ []) do
    path = Keyword.get(opts, :path, Path.join(dir, "world.db"))

    {:ok, world} =
      MuaWorld.start(
        [path: path, edl: edl(name), tick: :manual, starting_room: "west_of_house"]
        |> Keyword.merge(opts)
      )

    world
  end

  # The main world ships with mua_world; the rest are test fixtures
  defp edl("main"), do: Path.join(:code.priv_dir(:mua_world), "edl/main.edl")
  defp edl(name), do: fixture(name)

  @doc """
  Makes an Account and its Character, enters it into the World and subscribes
  to its output. Returns the Character; `account/1` gives its Account.
  """
  def join(world, name) do
    {:ok, account} = MuaWorld.create_account(world)
    {:ok, eid} = MuaWorld.create_character(world, account, name)
    Process.put({:account, eid}, account)
    {:ok, _welcome} = MuaWorld.enter(world, account, eid)
    :ok = MuaWorld.subscribe(world, eid)
    eid
  end

  @doc "The Account that owns a Character made by `join/2` in this test."
  def account(eid), do: Process.get({:account, eid})

  @doc "Sends a command and returns what its Character was told, one line per message."
  def send_command(world, eid, text) do
    {:ok, lines} = MuaWorld.command(world, account(eid), eid, text)
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
