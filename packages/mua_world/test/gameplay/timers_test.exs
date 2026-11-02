# Adapted from packages/mua/src/server/mua-world/__test__/timers.test.ts and
# the restart cases of persistence.test.ts.
defmodule MuaWorld.TimersTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  defp heard(lines, text), do: Enum.count(lines, &(&1 == text))

  describe "the World clock and timers" do
    setup %{tmp_dir: dir} do
      world = start("timers.edl", dir)
      {:ok, world: world, bob: join(world, "bob")}
    end

    test "advances World time while the World runs", %{world: world} do
      before = MuaWorld.world_time(world)
      run_for(world, 3)
      assert MuaWorld.world_time(world) - before >= 3000
    end

    test "sends a timer's message to the entity's Scripts when due", %{world: world, bob: bob} do
      run_for(world, 9)
      assert heard(received(bob), "The bell chimes.") == 0

      run_for(world, 2)
      assert heard(received(bob), "The bell chimes.") == 1

      run_for(world, 10)
      assert heard(received(bob), "The bell chimes.") == 1
    end

    test "resets a place on its reset timer", %{world: world, bob: bob} do
      send_command(world, bob, "take lamp")
      send_command(world, bob, "east")
      send_command(world, bob, "drop lamp")
      lamp = MuaWorld.named(world, "lamp")

      run_for(world, 62)
      assert location(world, lamp) == MuaWorld.named(world, "west_of_house")
    end

    test "lets a Script's wait run on World time", %{world: world, bob: bob} do
      run_for(world, 4)
      assert heard(received(bob), "The candles flicker into life.") == 0

      run_for(world, 3)
      assert heard(received(bob), "The candles flicker into life.") == 1
    end
  end

  test "runs with no Characters, and pauses while the World is down", %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    world = start("timers.edl", dir, path: path)
    run_for(world, 5)
    stopped_at = MuaWorld.world_time(world)
    assert stopped_at >= 5000
    GenServer.stop(world)

    Process.sleep(300)
    world = start("timers.edl", dir, path: path)
    resumed_at = MuaWorld.world_time(world)
    assert resumed_at >= stopped_at
    assert resumed_at - stopped_at < 300
  end

  describe "a World kept in a file" do
    setup %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      world = start("timers.edl", dir, path: path)
      bob = join(world, "bob")
      send_command(world, bob, "take lamp")
      send_command(world, bob, "east")
      run_for(world, 5)
      GenServer.stop(world)

      world = start("timers.edl", dir, path: path)
      :ok = MuaWorld.subscribe(world, bob)
      {:ok, world: world, bob: bob}
    end

    test "keeps Characters, things and time across a restart", %{world: world, bob: bob} do
      assert send_command(world, bob, "look") =~ "Hall"
      assert send_command(world, bob, "i") == "You are carrying: the lamp."
      assert MuaWorld.world_time(world) >= 5000
    end

    test "doesn't build the World from its EDL again", %{world: world} do
      assert named_thing(world, "Lamp") == MuaWorld.named(world, "lamp")

      assert Enum.count(
               1..200,
               &(MuaWorld.component(world, &1, "described") == %{
                   "name" => "Lamp",
                   "description" => "A brass lamp."
                 })
             ) == 1
    end

    test "keeps its timers and Scripts working", %{world: world, bob: bob} do
      send_command(world, bob, "west")
      received(bob)
      run_for(world, 10)
      assert "The bell chimes." in received(bob)
    end
  end
end
