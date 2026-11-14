defmodule MuaWorld.Case do
  @moduledoc false
  # Starts a World from a fixture EDL and drives it as Characters do.

  @fixtures Path.expand("fixtures", __DIR__)

  def fixture(name), do: Path.join(@fixtures, name)

  @doc """
  The vocabulary of the Base Verbs, without a World, with `extra` `verbs`
  and `words` components after them.
  """
  def base_vocabulary(extra \\ []) do
    path = MuaWorld.Scripts.path("edl/base.edl")
    {:ok, definitions, _} = OdgnEdl.read(File.read!(path), path: path)
    components = for %OdgnEdl.Entity{components: c} <- definitions, do: c
    MuaWorld.Commands.Verbs.from_components(components ++ extra)
  end

  @doc """
  A World built from `fixtures/<name>`, or the main World for `"main"`, in
  `dir`, ticking by hand. Its Starting room is `harbour_steps` for the main
  World and `west_of_house` for a fixture, unless `starting_room:` says
  otherwise.
  """
  def start(name, dir, opts \\ []) do
    path = Keyword.get(opts, :path, Path.join(dir, "world.db"))

    {:ok, world} =
      MuaWorld.start(
        [path: path, edl: edl(name), tick: :manual, starting_room: starting_room(name)]
        |> Keyword.merge(opts)
      )

    world
  end

  defp starting_room("main"), do: "harbour_steps"
  defp starting_room(_), do: "west_of_house"

  # The main world ships with mua_world; the rest are test fixtures
  defp edl("main"), do: Path.join(:code.priv_dir(:mua_world), "edl/main.edl")
  defp edl(name), do: if(Path.type(name) == :absolute, do: name, else: fixture(name))

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

  @doc """
  Sends a command and returns what its Character was told, one line per
  message. A place's Picture is left out: `pictures/1` has those.
  """
  def send_command(world, eid, text) do
    {:ok, lines} = MuaWorld.command(world, account(eid), eid, text)
    lines |> Enum.reject(&match?(%{picture: _}, &1)) |> Enum.join("\n")
  end

  @doc "The `src` of each Picture among a Character's lines."
  def pictures(lines), do: for(%{picture: %{src: src}} <- lines, do: src)

  @doc "Runs the World on for `seconds` of World time, a second a tick."
  def run_for(world, seconds) do
    for _ <- 1..seconds//1 do
      :ok = MuaWorld.advance(world, 1000)
      :ok = MuaWorld.tick(world)
    end

    :ok
  end

  @doc "The entity with this `described` name, through the World process."
  def named_thing(world, name) do
    Enum.find(1..10_000, fn eid ->
      case MuaWorld.component(world, eid, "described") do
        %{"name" => ^name} -> true
        _ -> false
      end
    end)
  end

  @doc "Where an entity is."
  def location(world, eid), do: (MuaWorld.component(world, eid, "location") || %{})["in"]

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
# the World logs its start-up at info
Logger.configure(level: :warning)
ExUnit.start(max_cases: 2)
