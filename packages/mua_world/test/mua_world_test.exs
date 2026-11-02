defmodule MuaWorldTest do
  use ExUnit.Case, async: true

  @edl Path.expand("fixtures/chapel/main.edl", __DIR__)

  setup %{tmp_dir: dir} do
    {:ok, path: Path.join(dir, "world.db")}
  end

  defp start(path, opts \\ []) do
    {:ok, world} = MuaWorld.start([path: path, edl: @edl, tick: :manual] ++ opts)
    world
  end

  defp ada(world), do: MuaWorld.named(world, "ada")

  defp location(world, name),
    do: MuaWorld.component(world, MuaWorld.named(world, name), "location")["in"]

  # Stops a World as a crash would, and waits until it is gone.
  defp crash(world) do
    ref = Process.monitor(world)
    Process.exit(world, :kill)
    assert_receive {:DOWN, ^ref, _, _, _}
  end

  defp cmd(world, text) do
    {:ok, lines} = MuaWorld.command(world, ada(world), text)
    lines
  end

  @moduletag :tmp_dir

  test "a Script reads an Entity through its Message Path, keeping the Receiver", %{path: path} do
    world = start(path)
    # chapel passes `look`; room answers it with the chapel as `the target`
    assert ["Chapel. Candles flicker. It holds 5 things."] = cmd(world, "look")
  end

  test "a Script changes an Entity and looks up an Element", %{path: path} do
    world = start(path)
    assert ["You pull the lever."] = cmd(world, "pull lever")
    assert MuaWorld.component(world, MuaWorld.named(world, "lever"), "pulled") == %{"yes" => true}
    assert ["There is no rope to pull."] = cmd(world, "pull rope")
  end

  test "a Veto stops an action, and an allowed one goes ahead", %{path: path} do
    world = start(path)
    assert ["It is far too heavy."] = cmd(world, "take statue")
    assert location(world, "statue") == MuaWorld.named(world, "chapel")
    assert ["You take candle."] = cmd(world, "take candle")
    assert location(world, "candle") == ada(world)
  end

  test "a Segment that fails leaves no partial change", %{path: path} do
    world = start(path, limits: [fuel_per_run: 5_000])
    assert ["Something went wrong."] = cmd(world, "smash altar")
    assert MuaWorld.component(world, MuaWorld.named(world, "chapel"), "smashed") == nil
  end

  test "output goes to subscribers only after its Step commits", %{path: path} do
    world = start(path)
    ada = ada(world)
    :ok = MuaWorld.subscribe(world, ada)
    cmd(world, "say hello")
    assert_received {:mua, ^ada, "You say, \"hello\""}
    assert_received {:mua, ^ada, "The walls echo: hello."}
  end

  test "a crash before COMMIT loses the change and tells nobody", %{path: path} do
    world = start(path, fault: :before_commit)
    ada = ada(world)
    :ok = MuaWorld.subscribe(world, ada)
    catch_exit(cmd(world, "take candle"))
    refute_received {:mua, _, _}

    world = start(path)
    assert location(world, "candle") == MuaWorld.named(world, "chapel")
  end

  test "a crash after COMMIT keeps the change, though its output is lost", %{path: path} do
    world = start(path, fault: :after_commit)
    ada = ada(world)
    :ok = MuaWorld.subscribe(world, ada)
    catch_exit(cmd(world, "take candle"))
    refute_received {:mua, _, _}

    world = start(path)
    assert location(world, "candle") == ada(world)
    # The change doesn't repeat: the candle is already taken.
    assert ["You don't see candle here."] = cmd(world, "take candle")
  end

  test "a Script waiting at a restart is abandoned, keeping its committed steps", %{path: path} do
    world = start(path)
    assert ["You begin to pray."] = cmd(world, "pray now")
    crash(world)

    world = start(path)
    ada = ada(world)
    :ok = MuaWorld.subscribe(world, ada)
    assert_received {:mua, ^ada, "The world was restarted, and \"pray now\" was abandoned."}

    MuaWorld.advance(world, 10_000)
    :ok = MuaWorld.tick(world)
    refute_received {:mua, ^ada, "Your prayer is answered."}
  end

  test "a waiting Script finishes in a later Step", %{path: path} do
    world = start(path)
    ada = ada(world)
    :ok = MuaWorld.subscribe(world, ada)
    cmd(world, "pray now")
    MuaWorld.advance(world, 6_000)
    :ok = MuaWorld.tick(world)
    assert_received {:mua, ^ada, "Your prayer is answered."}
  end

  test "timers resume from World time after a restart, without counting downtime", %{path: path} do
    world = start(path)
    assert ["You set the bell swinging."] = cmd(world, "ring bell")
    MuaWorld.advance(world, 1_000)
    :ok = MuaWorld.tick(world)
    crash(world)

    world = start(path)
    ada = ada(world)
    :ok = MuaWorld.subscribe(world, ada)
    :ok = MuaWorld.tick(world)
    refute_received {:mua, ^ada, "The bell chimes."}

    MuaWorld.advance(world, 1_500)
    :ok = MuaWorld.tick(world)
    assert_received {:mua, ^ada, "The bell chimes."}
  end
end
