# Backups, restores and what an operator relies on (#131).
defmodule MuaWorld.OperationsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  alias MuaWorld.{Backup, Migration}

  @moduletag :tmp_dir

  describe "a backup taken during play" do
    setup %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      world = start("timers.edl", dir, path: path)
      bob = join(world, "bob")
      send_command(world, bob, "take lamp")
      send_command(world, bob, "east")
      run_for(world, 5)

      backup = Path.join([dir, "backups", "world.db"])
      assert {:ok, ^backup} = MuaWorld.backup(world, backup)
      backed_up_at = MuaWorld.world_time(world)

      # play carries on after the backup, and the backup doesn't see it
      send_command(world, bob, "drop lamp")

      {:ok, world: world, bob: bob, backup: backup, backed_up_at: backed_up_at}
    end

    test "restores into a clean instance with Characters, things, time and timers", %{
      tmp_dir: dir,
      bob: bob,
      backup: backup,
      backed_up_at: backed_up_at
    } do
      restored = Path.join([dir, "restored", "world.db"])
      assert {:ok, ^restored} = Backup.restore(backup, restored)

      world = start("timers.edl", dir, path: restored)
      :ok = MuaWorld.subscribe(world, bob)

      assert send_command(world, bob, "look") =~ "Hall"
      assert send_command(world, bob, "i") == "You are carrying: the lamp."

      resumed_at = MuaWorld.world_time(world)
      assert resumed_at >= 5000 and resumed_at - backed_up_at < 2000

      send_command(world, bob, "west")
      received(bob)
      run_for(world, 10)
      assert "The bell chimes." in received(bob)
    end

    test "won't overwrite a file", %{world: world, backup: backup} do
      assert {:error, message} = MuaWorld.backup(world, backup)
      assert message =~ "already exists"
    end

    test "won't restore over an existing World", %{tmp_dir: dir, backup: backup} do
      assert {:error, message} = Backup.restore(backup, Path.join(dir, "world.db"))
      assert message =~ "clean instance"
    end
  end

  test "an offline backup waits for the World to stop", %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    world = start("timers.edl", dir, path: path)
    dest = Path.join(dir, "offline.db")

    assert {:error, message} = Backup.offline(path, dest)
    assert message =~ "stop it first"

    GenServer.stop(world)
    assert {:ok, ^dest} = Backup.offline(path, dest)
    assert :ok = Backup.check(dest)
  end

  test "acknowledged progress survives a restart and a Migration", %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    world = start("timers.edl", dir, path: path)
    bob = join(world, "bob")
    assert send_command(world, bob, "take lamp") == "Taken."
    GenServer.stop(world)

    assert {:ok, _lines} =
             Migration.migrate_file(path, fixture("timers-changed.edl"),
               starting_room: "west_of_house"
             )

    world = start("timers-changed.edl", dir, path: path)
    :ok = MuaWorld.subscribe(world, bob)
    assert send_command(world, bob, "i") =~ "lamp"
  end

  test "won't start on a changed EDL until it is migrated", %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    GenServer.stop(start("timers.edl", dir, path: path))

    Process.flag(:trap_exit, true)

    assert {:error, {:migration_needed, message}} =
             MuaWorld.start(
               path: path,
               edl: fixture("timers-changed.edl"),
               starting_room: "west_of_house",
               tick: :manual
             )

    assert message =~ "needs a Migration"
    refute MuaWorld.Lock.held?(path)
  end

  test "reports start-up and each Step as telemetry", %{tmp_dir: dir} do
    test = self()
    id = {__MODULE__, make_ref()}

    :telemetry.attach_many(
      id,
      [[:mua_world, :start], [:mua_world, :step, :stop]],
      fn event, measurements, metadata, _ -> send(test, {event, measurements, metadata}) end,
      nil
    )

    on_exit(fn -> :telemetry.detach(id) end)

    path = Path.join(dir, "world.db")
    world = start("timers.edl", dir, path: path)
    assert_receive {[:mua_world, :start], %{abandoned: 0}, %{how: :built, path: ^path}}

    join(world, "bob")
    assert_receive {[:mua_world, :step, :stop], %{duration: duration}, _}
    assert duration > 0

    GenServer.stop(world)
    start("timers.edl", dir, path: path)
    assert_receive {[:mua_world, :start], _, %{how: :resumed}}
  end
end
