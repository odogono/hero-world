# One World for the whole run, on a fresh database
dir = Path.join(System.tmp_dir!(), "mua_server_test_#{System.unique_integer([:positive])}")
File.mkdir_p!(dir)

world = [
  path: Path.join(dir, "world.db"),
  edl: Path.join(:code.priv_dir(:mua_world), "edl/main.edl"),
  starting_room: "west_of_house",
  tick: :manual
]

for child <- MuaServer.Application.world_children(world),
    do: {:ok, _} = Supervisor.start_child(MuaServer.Supervisor, child)

# Tests share the World and its Characters, so they run one at a time. A
# reply waits on a World Step, which can take longer than 100 ms on CI.
ExUnit.start(max_cases: 1, assert_receive_timeout: 2_000)
