defmodule MuaWorld.LockTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  alias MuaWorld.Lock

  @moduletag :tmp_dir

  test "one holder at a time, released on demand", %{tmp_dir: dir} do
    db = Path.join(dir, "w.db")
    assert :ok = Lock.acquire(db)
    assert Lock.held?(db)

    task = Task.async(fn -> Lock.acquire(db) end)
    assert {:error, :locked} = Task.await(task)

    :ok = Lock.release(db)
    refute Lock.held?(db)
  end

  test "takes over a lock whose holder has died", %{tmp_dir: dir} do
    db = Path.join(dir, "w.db")
    {:ok, task} = Task.start(fn -> :ok = Lock.acquire(db) end)
    ref = Process.monitor(task)
    assert_receive {:DOWN, ^ref, _, _, _}

    refute Lock.held?(db)
    assert :ok = Lock.acquire(db)
  end

  test "takes over a lock left by another OS process that is gone", %{tmp_dir: dir} do
    db = Path.join(dir, "w.db")
    # a pid no process has: beyond the usual maximum
    File.write!(Lock.path(db), "99999999 <0.1.0>\n")
    assert :ok = Lock.acquire(db)
  end

  test "a running World lets readers open its database", %{tmp_dir: dir} do
    world = start("main", dir)
    db = Path.join(dir, "world.db")
    assert Lock.held?(db)

    {:ok, reader} = OdgnEcs.open(db)
    assert OdgnEcs.query(reader, with: ["described"]) != []
    OdgnEcs.close(reader)

    GenServer.stop(world)
    refute File.exists?(Lock.path(db))
  end

  test "a second World on the same database refuses to start", %{tmp_dir: dir} do
    _world = start("main", dir)
    Process.flag(:trap_exit, true)

    assert {:error, :locked} =
             MuaWorld.start(
               path: Path.join(dir, "world.db"),
               edl: Path.join(:code.priv_dir(:mua_world), "edl/main.edl"),
               starting_room: "west_of_house",
               tick: :manual
             )
  end
end
