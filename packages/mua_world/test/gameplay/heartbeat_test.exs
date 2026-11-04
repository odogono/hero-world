# mua's npc_heartbeat System (ADR 0020). World time follows the clock even
# in tests, so the checks leave a few seconds' margin either side.
defmodule MuaWorld.HeartbeatTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("heartbeat.edl", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  test "gives every active NPC a heartbeat, every 45 seconds", %{world: world, bob: bob} do
    received(bob)
    run_for(world, 40)
    refute ~s(Kid says, "tick") in received(bob)

    run_for(world, 6)
    lines = received(bob)
    assert ~s(Kid says, "tick") in lines
    refute ~s(Statue says, "tick") in lines

    run_for(world, 40)
    refute ~s(Kid says, "tick") in received(bob)

    run_for(world, 6)
    assert ~s(Kid says, "tick") in received(bob)
  end
end
