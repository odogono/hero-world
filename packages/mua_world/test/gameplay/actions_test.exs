# The Actions, Service Scripts and Libraries a World declares (ADR 0029): a World whose
# Verbs ask for what it hasn't declared won't start. What a declared Action
# reaches is pinned by the Step cases in spec/mua/steps/actions.json.
defmodule MuaWorld.ActionsTest do
  use ExUnit.Case, async: true

  @moduletag :tmp_dir

  # A World Definition in `dir`: a hall, and `extra` EDL
  defp definition(dir, extra) do
    edl = Path.join(dir, "main.edl")

    File.write!(edl, """
    include "mua-scripts:edl/base.edl"

    entity hall {
      container { capacity: 100 is_closed: false }
      described { name: "Hall" description: "A plain hall." }
    }

    #{extra}
    """)

    edl
  end

  defp start(dir, extra) do
    Process.flag(:trap_exit, true)

    MuaWorld.start(
      path: Path.join(dir, "world.db"),
      edl: definition(dir, extra),
      starting_room: "hall",
      tick: :manual
    )
  end

  test "won't start when a form asks for an undeclared Action", %{tmp_dir: dir} do
    assert {:error, {:actions, message}} =
             start(dir, """
             entity more_verbs {
               verbs { defs: [{ names: ["wave"] forms: [{ action: "wave" pattern: "" }] }] }
             }
             """)

    assert message =~ "wave asks for the Action wave, which isn't declared"
  end

  test "won't start when an Action names an undeclared Service", %{tmp_dir: dir} do
    assert {:error, {:actions, message}} =
             start(dir, """
             entity more_actions {
               actions { defs: { take: { service: "pockets" } } }
             }
             """)

    assert message =~ "the Action take names the Service pockets, which isn't declared"
  end

  test "won't start when a Veto asks an undeclared Service", %{tmp_dir: dir} do
    assert {:error, {:actions, message}} =
             start(dir, """
             entity more_verbs {
               verbs {
                 defs: [{
                   names: ["wave"]
                   forms: [{ action: "wave" pattern: "" }]
                   vetoes: [{ event: "beforeWave" asks: "service:crowd" about: "actor" }]
                 }]
               }
               actions { defs: { wave: {} } }
             }
             """)

    assert message =~ "beforeWave asks the Service crowd, which isn't declared"
  end

  test "won't start when a Service's src is under an unknown root", %{tmp_dir: dir} do
    assert {:error, {:actions, message}} =
             start(dir, """
             entity more_services {
               services { defs: { thing: { src: "elsewhere:thing.talk" } } }
             }
             """)

    assert message =~ "the Service thing's src elsewhere:thing.talk is under no root mua knows"
  end

  test "won't start when a Library's src is under an unknown root", %{tmp_dir: dir} do
    assert {:error, {:actions, message}} =
             start(dir, """
             entity more_libraries {
               libraries { defs: { manners: { src: "elsewhere:manners.talk" } } }
             }
             """)

    assert message =~
             "the Library manners's src elsewhere:manners.talk is under no root mua knows"
  end

  test "starts with a Receivers-only Action declared", %{tmp_dir: dir} do
    assert {:ok, world} =
             start(dir, """
             entity more_verbs {
               verbs { defs: [{ names: ["wave"] forms: [{ action: "wave" pattern: "" }] }] }
               actions { defs: { wave: {} } }
             }
             """)

    GenServer.stop(world)
  end
end
