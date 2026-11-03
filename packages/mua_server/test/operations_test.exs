# What an operator runs against a release (#131): health, backups, the
# maintenance procedure and restoring.
defmodule MuaServer.OperationsTest do
  use ExUnit.Case

  import ExUnit.CaptureIO
  import Phoenix.ConnTest

  alias MuaServer.Release

  @endpoint MuaServer.Endpoint
  @fixtures Path.expand("../../mua_world/test/fixtures", __DIR__)

  @moduletag :tmp_dir

  describe "/health" do
    test "is ok while the World answers" do
      conn = get(build_conn(), "/health")
      assert %{"status" => "ok", "world_time" => time, "in_play" => _} = json_response(conn, 200)
      assert is_integer(time)
    end

    test "is unavailable when the World doesn't answer" do
      Application.put_env(:mua_server, :world_name, :no_such_world)
      on_exit(fn -> Application.delete_env(:mua_server, :world_name) end)

      conn = get(build_conn(), "/health")
      assert json_response(conn, 503) == %{"status" => "unavailable"}
    end
  end

  test "backs up the running World", %{tmp_dir: dir} do
    dest = Path.join([dir, "backups", "world.db"])
    output = capture_io(fn -> assert {:ok, ^dest} = Release.backup(dest) end)

    assert output =~ "Backed up the World to #{dest}"
    assert :ok = MuaWorld.Backup.check(dest)
  end

  describe "the maintenance procedure" do
    setup %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      settings = [path: path, edl: fixture("timers.edl"), starting_room: "west_of_house"]
      {:ok, world} = MuaWorld.start(Keyword.put(settings, :tick, :manual))

      {:ok, account} = MuaWorld.create_account(world)
      {:ok, bob} = MuaWorld.create_character(world, account, "bob")
      {:ok, _} = MuaWorld.enter(world, account, bob)
      {:ok, _} = MuaWorld.command(world, account, bob, "take lamp")
      GenServer.stop(world)

      changed = Keyword.put(settings, :edl, fixture("timers-changed.edl"))
      {:ok, settings: changed, account: account, bob: bob}
    end

    test "a dry run backs up and changes nothing", %{tmp_dir: dir, settings: settings} do
      backup = Path.join(dir, "before.db")

      output =
        capture_io(fn -> Release.maintain(world: settings, backup: backup, dry_run: true) end)

      assert output =~ "Backed up the World to #{backup}"
      assert File.exists?(backup)

      # unmigrated, it still starts on the EDL it was built from
      world = start(Keyword.put(settings, :edl, fixture("timers.edl")))
      assert MuaWorld.named(world, "garden") == nil
    end

    test "backs up, then migrates, keeping acknowledged progress", %{
      tmp_dir: dir,
      settings: settings,
      account: account,
      bob: bob
    } do
      backup = Path.join(dir, "before.db")
      capture_io(fn -> Release.maintain(world: settings, backup: backup) end)

      assert :ok = MuaWorld.Backup.check(backup)
      world = start(settings)
      assert MuaWorld.named(world, "garden") != nil
      assert {:ok, lines} = MuaWorld.command(world, account, bob, "i")
      assert Enum.join(lines) =~ "lamp"
    end

    test "won't run while the World does", %{settings: settings, tmp_dir: dir} do
      world = start(Keyword.put(settings, :edl, fixture("timers.edl")))

      assert_raise RuntimeError, ~r/stop it first/, fn ->
        Release.maintain(world: settings, backup: Path.join(dir, "b.db"))
      end

      GenServer.stop(world)
    end

    test "restores a backup into a clean instance, and only there", %{
      tmp_dir: dir,
      settings: settings,
      account: account,
      bob: bob
    } do
      backup = Path.join(dir, "before.db")
      capture_io(fn -> Release.maintain(world: settings, backup: backup, dry_run: true) end)

      assert_raise RuntimeError, ~r/clean instance/, fn ->
        Release.restore(backup, world: settings)
      end

      clean = Keyword.put(settings, :path, Path.join([dir, "clean", "world.db"]))
      capture_io(fn -> Release.restore(backup, world: clean) end)

      world = start(Keyword.put(clean, :edl, fixture("timers.edl")))
      assert {:ok, lines} = MuaWorld.command(world, account, bob, "i")
      assert Enum.join(lines) =~ "lamp"
    end
  end

  describe "load_players" do
    test "refuses on a server not started for a load test" do
      System.delete_env("MUA_LOAD_TEST")
      assert_raise RuntimeError, ~r/MUA_LOAD_TEST/, fn -> Release.load_players(1) end
    end

    test "makes players whose tokens open the socket, the same each time" do
      System.put_env("MUA_LOAD_TEST", "true")
      on_exit(fn -> System.delete_env("MUA_LOAD_TEST") end)

      output = capture_io(fn -> assert {:ok, 2} = Release.load_players(2) end)
      [%{"character" => c1, "token" => token}, %{"character" => c2}] = Jason.decode!(output)
      assert c1 != c2

      assert {:ok, account} =
               Phoenix.Token.verify(MuaServer.Endpoint, "socket", token, max_age: 60)

      assert [%{id: ^c1}] = MuaWorld.characters(MuaServer.World, account)

      again = capture_io(fn -> Release.load_players(2) end) |> Jason.decode!()
      assert Enum.map(again, & &1["character"]) == [c1, c2]
    end
  end

  test "the maintenance script is valid shell" do
    script = Path.expand("../rel/maintain.sh", __DIR__)
    assert {_, 0} = System.cmd("sh", ["-n", script])
  end

  defp fixture(name), do: Path.join(@fixtures, name)

  defp start(settings) do
    {:ok, world} = MuaWorld.start(Keyword.put(settings, :tick, :manual))
    on_exit(fn -> if Process.alive?(world), do: GenServer.stop(world) end)
    world
  end
end
