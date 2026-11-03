# Adapted from packages/mua/src/server/mua-world/__test__/migrate.test.ts,
# with the pruning, Starting-room and live-edit cases of #100.
defmodule MuaWorld.MigrateTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  alias MuaWorld.Migration

  @moduletag :tmp_dir

  @before "timers.edl"
  @after_edl "timers-changed.edl"

  setup %{tmp_dir: dir} do
    {:ok, db: Path.join(dir, "world.db")}
  end

  # bob takes the lamp and walks to the hall, then the World stops
  defp play_then_stop(dir, db) do
    world = start(@before, dir, path: db)
    bob = join(world, "bob")
    send_command(world, bob, "take lamp")
    send_command(world, bob, "east")
    run_for(world, 5)
    GenServer.stop(world)
    bob
  end

  defp migrate(db, edl, opts \\ []) do
    path = if File.exists?(edl), do: edl, else: fixture(edl)
    Migration.migrate_file(db, path, Keyword.put_new(opts, :starting_room, "west_of_house"))
  end

  # The World's report, read straight from the database with the World stopped
  defp report(db, edl, opts \\ []) do
    {:ok, world} = OdgnEcs.open(db)

    world =
      Enum.reduce(MuaWorld.Components.all(), world, fn c, w -> elem(OdgnEcs.define(w, c), 1) end)

    :ok = OdgnEcs.begin(world)
    path = if File.exists?(edl), do: edl, else: fixture(edl)

    result =
      Migration.run(
        world,
        File.read!(path),
        Keyword.merge([path: path, starting_room: "west_of_house"], opts)
      )

    :ok = OdgnEcs.rollback(world)
    OdgnEcs.close(world)

    case result do
      {:ok, _world, report} -> {:ok, report}
      error -> error
    end
  end

  defp rejoin(world, bob) do
    {:ok, _} = MuaWorld.enter(world, account(bob), bob)
    :ok = MuaWorld.subscribe(world, bob)
  end

  defp write_edl(dir, name, edl) do
    path = Path.join(dir, name)
    File.write!(path, edl)
    # the fixture's Scripts are found beside it
    File.cp_r!(fixture("scripts"), Path.join(dir, "scripts"))
    path
  end

  test "adds the new room and its exits, keeping players and time", %{tmp_dir: dir, db: db} do
    bob = play_then_stop(dir, db)

    assert {:ok, %{plan: plan, timers_cancelled: cancelled}} = report(db, @after_edl)
    assert plan.created == ["garden"]
    assert Enum.map(cancelled, & &1.message) == ["chime"]
    assert {:ok, lines} = migrate(db, @after_edl)
    assert "Created: garden" in lines

    world = start(@after_edl, dir, path: db)
    assert MuaWorld.world_time(world) >= 5000
    rejoin(world, bob)
    assert send_command(world, bob, "i") =~ "You are carrying: the lamp."
    assert send_command(world, bob, "look") =~ "Hall"
    assert send_command(world, bob, "north") =~ "Garden"
    assert send_command(world, bob, "south") =~ "Hall"
    assert send_command(world, bob, "examine lamp") =~ "dented"

    # only one garden, and the chime is no longer stored
    garden = named_thing(world, "Garden")
    assert garden == MuaWorld.named(world, "garden")

    refute Enum.any?(
             1..200,
             &(&1 != garden and
                 MuaWorld.component(world, &1, "described") == %{
                   "name" => "Garden",
                   "description" => "Roses grow along the wall."
                 })
           )

    timers =
      for eid <- 1..200,
          t = MuaWorld.component(world, eid, "talk_timer"),
          t["script"] == "mua:timers",
          do: t["name"]

    refute "chime" in timers
  end

  test "changes nothing when the EDL is unchanged", %{tmp_dir: dir, db: db} do
    play_then_stop(dir, db)

    assert {:ok, %{plan: plan, timers_cancelled: [], exits_remade: []}} = report(db, @before)
    assert plan.created == []
    assert plan.updated == []
    assert plan.gone == []
    # bob carries the lamp, which the EDL puts in the belfry: it is reported, and stays
    assert [%{name: "lamp", components: ["location"]}] = plan.kept
    assert {:ok, [line]} = migrate(db, @before)
    assert line =~ "Changed in play, so the EDL edit is not applied: lamp"
  end

  test "a dry run reports the plan and changes nothing", %{tmp_dir: dir, db: db} do
    play_then_stop(dir, db)

    assert {:ok, ["Dry run: nothing was changed." | lines]} =
             migrate(db, @after_edl, dry_run: true)

    assert "Created: garden" in lines

    # the World still needs its Migration, and starts from the EDL it was built from
    assert {:error, {:migration_needed, _}} =
             MuaWorld.start(
               path: db,
               edl: fixture(@after_edl),
               tick: :manual,
               starting_room: "west_of_house"
             )

    world = start(@before, dir, path: db)
    assert MuaWorld.named(world, "garden") == nil
  end

  test "keeps what play changed, and reports it", %{tmp_dir: dir, db: db} do
    bob = play_then_stop(dir, db)
    # the lamp now starts in the hall, but bob is carrying it; the hall's
    # description changes, and someone edited it live
    world = start(@before, dir, path: db)
    hall = MuaWorld.named(world, "hall")

    :ok =
      MuaWorld.set_component(world, hall, "described", %{
        "name" => "Hall",
        "description" => "A hall, swept."
      })

    GenServer.stop(world)

    edl =
      File.read!(fixture(@before))
      |> String.replace("location { in: $west_of_house }", "location { in: $hall }")
      |> String.replace("A long hall.", "A very long hall.")

    path = write_edl(dir, "edited.edl", edl)
    assert {:ok, %{plan: plan}} = report(db, path)

    kept = Map.new(plan.kept, &{&1.name, &1.components})
    assert kept == %{"hall" => ["described"], "lamp" => ["location"]}

    assert {:ok, _} = migrate(db, path)
    world = start(path, dir, path: db)
    rejoin(world, bob)
    assert send_command(world, bob, "i") =~ "the lamp"
    assert MuaWorld.component(world, hall, "described")["description"] == "A hall, swept."
  end

  test "prunes a place gone from the EDL to Limbo, moving its Characters out first", %{
    tmp_dir: dir,
    db: db
  } do
    bob = play_then_stop(dir, db)

    edl =
      File.read!(fixture(@before))
      |> String.replace(~r/entity hall : room \{.*?\n\}\n/s, "")
      |> String.replace("exits { east: $hall }", "")

    path = write_edl(dir, "pruned.edl", edl)

    assert {:ok, %{plan: %{gone: [%{name: "hall", eid: hall}]}}} = report(db, path)
    assert {:ok, lines} = migrate(db, path)
    assert Enum.any?(lines, &String.starts_with?(&1, "Gone from the EDL (pass --prune): hall"))

    assert {:ok, lines} = migrate(db, path, prune: true)
    assert Enum.any?(lines, &String.starts_with?(&1, "Moved to Limbo: hall"))

    world = start(path, dir, path: db)
    # bob was in the hall: he moved to the Starting room, with what he carried
    assert location(world, bob) == MuaWorld.named(world, "west_of_house")
    rejoin(world, bob)
    assert send_command(world, bob, "i") =~ "the lamp"

    # the hall still exists, in Limbo, and has lost its Definition name
    assert MuaWorld.named(world, "hall") == nil
    assert MuaWorld.component(world, location(world, hall), "meta")["props"]["id"] == "limbo"
  end

  test "pruning a place cancels the timers it owns", %{tmp_dir: dir, db: db} do
    # the hall chimes too, so it owns a timer
    chiming =
      File.read!(fixture(@before))
      |> String.replace(
        "entity hall : room {",
        "entity hall : room belfry {\n  timers { every: { chime: 10 } }"
      )

    chiming = write_edl(dir, "chiming.edl", chiming)
    world = start(chiming, dir, path: db)
    hall = MuaWorld.named(world, "hall")
    run_for(world, 5)
    assert "chime" in timers_of(world, hall)
    GenServer.stop(world)

    pruned =
      chiming
      |> File.read!()
      |> String.replace(~r/entity hall : room belfry \{.*?\n\}\n/s, "")
      |> String.replace("exits { east: $hall }", "")

    path = write_edl(dir, "pruned.edl", pruned)

    assert {:ok, %{timers_cancelled: cancelled}} = report(db, path, prune: true)
    assert %{owner: hall, message: "chime"} in cancelled
    assert {:ok, _} = migrate(db, path, prune: true)

    world = start(path, dir, path: db)
    assert timers_of(world, hall) == []
    assert "chime" in timers_of(world, MuaWorld.named(world, "west_of_house"))
  end

  defp timers_of(world, owner) do
    for eid <- 1..200,
        t = MuaWorld.component(world, eid, "talk_timer"),
        t["owner"] == owner,
        do: t["name"] || t["message"]
  end

  test "refuses a Migration that leaves the Starting room invalid, changing nothing", %{
    tmp_dir: dir,
    db: db
  } do
    play_then_stop(dir, db)

    # the Starting room is renamed away, so `west_of_house` names nothing
    edl =
      File.read!(fixture(@before))
      |> String.replace(
        "entity west_of_house : room belfry",
        "entity porch was west_of_house : room belfry"
      )
      |> String.replace("$west_of_house", "$porch")

    path = write_edl(dir, "renamed.edl", edl)

    for opts <- [[dry_run: true], []] do
      assert {:error, reason} = migrate(db, path, opts)
      assert reason =~ "without a Starting room"
    end

    # nothing changed: the World still starts from the EDL it was built from
    world = start(@before, dir, path: db)
    assert MuaWorld.named(world, "west_of_house") != nil
  end

  test "refuses while the World is running", %{tmp_dir: dir, db: db} do
    world = start(@before, dir, path: db)
    _ = join(world, "bob")

    assert {:error, reason} = migrate(db, @after_edl)
    assert reason =~ "stop the World"
  end
end

# Mix's shell is global, so this runs on its own
defmodule MuaWorld.MigrateTaskTest do
  use ExUnit.Case, async: false

  import MuaWorld.Case

  @moduletag :tmp_dir

  test "mix mua.migrate prints the plan", %{tmp_dir: dir} do
    db = Path.join(dir, "world.db")
    world = start("timers.edl", dir, path: db)
    GenServer.stop(world)
    Mix.shell(Mix.Shell.Process)

    Mix.Tasks.Mua.Migrate.run(
      ~w(--db #{db} --edl #{fixture("timers-changed.edl")} --starting-room west_of_house --dry-run)
    )

    assert_received {:mix_shell, :info, ["Dry run: nothing was changed."]}
    assert_received {:mix_shell, :info, ["Created: garden"]}
  after
    Mix.shell(Mix.Shell.IO)
  end

  test "mix mua.migrate refuses a database that doesn't exist", %{tmp_dir: dir} do
    assert_raise Mix.Error, ~r/no World/, fn ->
      Mix.Tasks.Mua.Migrate.run(~w(--db #{Path.join(dir, "none.db")} --edl x --starting-room y))
    end
  end
end
