# An admin's NorthTalk line at the prompt (#91).
defmodule MuaWorld.AdminTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  # A Character whose Account signed in as an admin, or not
  defp sign_in(world, name, admin?) do
    {:ok, account} = MuaWorld.sign_in(world, "sub-" <> name, "#{name}@example.com", admin: admin?)
    {:ok, eid} = MuaWorld.create_character(world, account, name)
    Process.put({:account, eid}, account)
    {:ok, _} = MuaWorld.enter(world, account, eid)
    :ok = MuaWorld.subscribe(world, eid)
    eid
  end

  defp line(world, eid, text) do
    {:ok, lines} = MuaWorld.admin_line(world, account(eid), eid, text)
    Enum.join(lines, "\n")
  end

  setup %{tmp_dir: dir} do
    world = start("timers.edl", dir)
    {:ok, world: world, ada: sign_in(world, "ada", true)}
  end

  test "runs a line against the World and shows its result", %{world: world, ada: ada} do
    assert line(world, ada, "return 1 + 2") == "=> 3"
    assert line(world, ada, "return the name of the described of here") == ~s(=> "Belfry")

    lamp = MuaWorld.named(world, "lamp")
    assert line(world, ada, ~s(ask world to named "lamp"\nreturn it)) == "=> <entity #{lamp}>"
    assert line(world, ada, ~s(ask world to named "nowhere"\nreturn it)) == "=> nothing"
  end

  test "changes the World through the Operations Scripts use", %{world: world, ada: ada} do
    assert line(world, ada, ~s(ask world to named "lamp"\nmoveTo it, actor\nreturn "ok")) ==
             ~s(=> "ok")

    assert location(world, MuaWorld.named(world, "lamp")) == ada
  end

  test "a `;` command is a line", %{world: world, ada: ada} do
    assert send_command(world, ada, ";return 40 + 2") == "=> 42"
  end

  test "a line that doesn't compile changes nothing", %{world: world, ada: ada} do
    assert line(world, ada, "return (") =~ ~r/^!! line 1: /
  end

  test "a line that fails leaves the prompt usable", %{world: world, ada: ada} do
    assert line(world, ada, ~s|return lookup({a: 1}, ["a"])|) =~ ~r/^!! line 1: /
    assert line(world, ada, "return (") =~ ~r/^!! line 1: /
    assert line(world, ada, "return 1 / 0") =~ ~r/^!! /
    assert line(world, ada, "return 1") == "=> 1"
  end

  test "a line that fails leaves no change, its output and timers included",
       %{world: world, ada: ada} do
    lamp = MuaWorld.named(world, "lamp")
    timers_before = timers(world)

    reply =
      line(world, ada, """
      ask world to named "lamp"
      put it into lamp
      moveTo lamp, actor
      show actor, "You shouldn't see this."
      ask clock to now
      tell timer to schedule "never", it + 5 s, "never", []
      return 1 / 0
      """)

    assert reply =~ ~r/^!! /
    refute reply =~ "shouldn't"
    assert location(world, lamp) == MuaWorld.named(world, "west_of_house")
    assert timers(world) == timers_before
    assert received(ada) |> Enum.all?(&(not String.contains?(&1, "shouldn't")))
  end

  test "a line still waiting at the end of its Step changes nothing", %{world: world, ada: ada} do
    reply = line(world, ada, ~s(ask world to named "lamp"\nmoveTo it, actor\nwait 60 s\nreturn 1))
    assert reply =~ "didn't finish"

    assert location(world, MuaWorld.named(world, "lamp")) ==
             MuaWorld.named(world, "west_of_house")

    # the discarded Run never carries on
    run_for(world, 61)

    assert location(world, MuaWorld.named(world, "lamp")) ==
             MuaWorld.named(world, "west_of_house")
  end

  test "the World refuses a line from an Account that isn't an admin", %{world: world} do
    bob = sign_in(world, "bob", false)
    lamp = MuaWorld.named(world, "lamp")

    assert line(world, bob, ~s(ask world to named "lamp"\nmoveTo it, actor)) ==
             "You can't do that."

    assert send_command(world, bob, ";return 1") == "You can't do that."
    assert location(world, lamp) == MuaWorld.named(world, "west_of_house")
  end

  test "admin is set from each sign-in", %{world: world, ada: ada} do
    assert line(world, ada, "return 1") == "=> 1"
    {:ok, _} = MuaWorld.sign_in(world, "sub-ada", "ada@example.com", admin: false)
    assert line(world, ada, "return 1") == "You can't do that."
  end

  test "a line can't drive another Account's Character", %{world: world, ada: ada} do
    bob = sign_in(world, "bob", false)
    assert MuaWorld.admin_line(world, account(bob), ada, "return 1") == {:error, :not_owner}
  end

  test "a static component edited by a line survives a Migration, reported as kept",
       %{world: world, ada: ada, tmp_dir: dir} do
    assert line(world, ada, """
           ask world to named "hall"
           change it, "described", {name: "Hall", description: "A hall, newly painted."}
           return "ok"
           """) == ~s(=> "ok")

    GenServer.stop(world)
    db = Path.join(dir, "world.db")
    edl = fixture("timers-changed.edl")
    assert {:ok, lines} = MuaWorld.Migration.migrate_file(db, edl, starting_room: "west_of_house")
    assert Enum.any?(lines, &(&1 =~ "hall" and &1 =~ "described"))

    world = start("timers-changed.edl", dir)
    hall = MuaWorld.named(world, "hall")
    assert MuaWorld.component(world, hall, "described")["description"] == "A hall, newly painted."
  end

  defp timers(world) do
    MuaWorld.timers(world)
  end
end
