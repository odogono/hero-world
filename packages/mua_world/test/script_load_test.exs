# A World whose Scripts don't load stops, naming the file (#190).
defmodule MuaWorld.ScriptLoadTest do
  # sets the mua-scripts directory, which every World reads as it starts
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog
  import MuaWorld.Case

  @moduletag :tmp_dir

  defp start_world(dir, edl) do
    MuaWorld.start(
      path: Path.join(dir, "world.db"),
      edl: edl,
      tick: :manual,
      starting_room: "west_of_house"
    )
  end

  test "names an EDL Script that fails to load", %{tmp_dir: dir} do
    Process.flag(:trap_exit, true)

    log =
      capture_log(fn ->
        assert {:error, {:script_load_failed, path, [%{"line" => 3} | _]}} =
                 start_world(dir, fixture("broken.edl"))

        assert Path.basename(path) == "broken.talk"
      end)

    assert log =~ ~r/broken\.talk:3:\d+ /
  end

  test "names a Library that fails to load", %{tmp_dir: dir} do
    Process.flag(:trap_exit, true)
    scripts = Path.join(dir, "mua-scripts")
    File.cp_r!(MuaWorld.Scripts.dir(), scripts)

    File.write!(
      Path.join(scripts, "scripts/lib/messages.talk"),
      "function oops\n  return (\nend oops\n"
    )

    Application.put_env(:mua_world, :scripts_dir, scripts)
    on_exit(fn -> Application.delete_env(:mua_world, :scripts_dir) end)

    log =
      capture_log(fn ->
        assert {:error, {:script_load_failed, path, [_ | _]}} =
                 start_world(dir, fixture("objects.edl"))

        assert path == Path.join(scripts, "scripts/lib/messages.talk")
      end)

    assert log =~ "messages.talk:3:1 unexpected token"
  end
end
