# A place's Picture (ADR 0027): shown just before its description, and
# checked against the files beside the EDL when a World starts or migrates
defmodule MuaWorld.PicturesTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  # A World Definition in `dir`: a hall with a Picture, a cellar without
  # one, and a Picture file for each name in `files`
  defp definition(dir, picture, files) do
    File.mkdir_p!(Path.join(dir, "pictures"))
    for name <- files, do: File.write!(Path.join([dir, "pictures", name]), "png:" <> name)

    edl = Path.join(dir, "main.edl")

    File.write!(edl, """
    include "mua-scripts:edl/base.edl"

    atom room {
      container { capacity: 100 is_closed: false }
    }

    entity west_of_house : room {
      described { name: "Hall" description: "A long hall." }
      picture { src: "#{picture}" }
      exits { down: $cellar }
    }

    entity cellar : room {
      described { name: "Cellar" description: "Damp and dark." }
      exits { up: $west_of_house }
    }
    """)

    edl
  end

  test "a place's Picture comes just before its description", %{tmp_dir: dir} do
    world = start(definition(dir, "pictures/hall.png", ["hall.png"]), dir)
    bob = join(world, "bob")

    assert {:ok, [%{picture: picture}, look]} =
             MuaWorld.command(world, account(bob), bob, "look")

    hash =
      :crypto.hash(:sha256, "png:hall.png") |> Base.encode16(case: :lower) |> binary_part(0, 12)

    assert picture == %{
             src: "pictures/hall.png",
             url: "/pictures/hall.png?vsn=#{hash}",
             name: "Hall",
             alt: "A long hall."
           }

    assert look =~ ~r/^Hall\nA long hall\./
  end

  test "arriving shows the Picture, and a place without one shows none", %{tmp_dir: dir} do
    world = start(definition(dir, "pictures/hall.png", ["hall.png"]), dir)
    bob = join(world, "bob")

    assert {:ok, lines} = MuaWorld.command(world, account(bob), bob, "down")
    assert pictures(lines) == []

    assert {:ok, lines} = MuaWorld.command(world, account(bob), bob, "up")
    assert pictures(lines) == ["pictures/hall.png"]
  end

  test "only the Character describing the place sees its Picture", %{tmp_dir: dir} do
    world = start(definition(dir, "pictures/hall.png", ["hall.png"]), dir)
    ada = join(world, "ada")
    bob = join(world, "bob")
    received(ada)

    send_command(world, bob, "look")
    assert pictures(received(ada)) == []
  end

  test "a World whose Picture has no file won't start", %{tmp_dir: dir} do
    Process.flag(:trap_exit, true)
    edl = definition(dir, "pictures/missing.png", [])

    assert {:error, {:pictures, message}} =
             MuaWorld.start(
               path: Path.join(dir, "world.db"),
               edl: edl,
               starting_room: "west_of_house",
               tick: :manual
             )

    assert message =~ "Hall"
    assert message =~ "pictures/missing.png"
  end

  test "a Picture must be a file in pictures/", %{tmp_dir: dir} do
    Process.flag(:trap_exit, true)
    edl = definition(dir, "../main.edl", [])

    assert {:error, {:pictures, message}} =
             MuaWorld.start(
               path: Path.join(dir, "world.db"),
               edl: edl,
               starting_room: "west_of_house",
               tick: :manual
             )

    assert message =~ "is not a file in pictures/"
  end

  test "a Migration to an EDL whose Picture has no file fails", %{tmp_dir: dir} do
    db = Path.join(dir, "world.db")
    world = start(definition(dir, "pictures/hall.png", ["hall.png"]), dir, path: db)
    GenServer.stop(world)

    File.rm!(Path.join([dir, "pictures", "hall.png"]))
    edl = definition(dir, "pictures/hall2.png", [])

    assert {:error, message} =
             MuaWorld.Migration.migrate_file(db, edl, starting_room: "west_of_house")

    assert message =~ "pictures/hall2.png"
  end
end
