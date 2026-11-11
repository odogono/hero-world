# Building rights and placing a composed thing (#258). Whether a thing may be
# placed is the build Service Script's (mua-scripts/scripts/services/build.talk).
defmodule MuaWorld.BuildTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  @satchel %{
    "described" => %{"name" => "Satchel", "description" => "A leather satchel."},
    "item" => %{},
    "container" => %{"capacity" => 5, "is_closed" => true}
  }

  setup %{tmp_dir: dir} do
    world = start("locks.edl", dir)
    {:ok, world: world, ada: join(world, "ada"), bob: join(world, "bob")}
  end

  defp grant(world, eid, limits \\ %{}),
    do: :ok = MuaWorld.set_component(world, account(eid), "builder", limits)

  defp place(world, eid, composition),
    do: MuaWorld.place(world, account(eid), eid, composition)

  test "a builder places a thing in their room, which another player can take and open",
       %{world: world, ada: ada, bob: bob} do
    grant(world, ada)
    received(bob)

    assert {:ok, %{eid: satchel, placed: 1, max_placed: 50}} = place(world, ada, @satchel)
    # the line offers its Maker a way back to it (#275)
    assert received(ada) == [%{text: "You make the satchel.", suggestions: ["edit the satchel"]}]
    assert received(bob) == ["ada makes the satchel."]

    assert location(world, satchel) == location(world, ada)
    assert MuaWorld.component(world, satchel, "made_by") == %{"account" => account(ada)}
    # the Maker stays on the server
    refute "made_by" in MuaWorld.Mirror.components()
    refute "builder" in MuaWorld.Mirror.components()
    assert MuaWorld.builder(world, account(ada)) == %{placed: 1, max_placed: 50, max_capacity: 20}

    assert send_command(world, bob, "take satchel") == "Taken."
    assert location(world, satchel) == bob
    assert send_command(world, bob, "open satchel") == "Opened."
    assert MuaWorld.component(world, satchel, "container")["is_closed"] == false
  end

  test "an Account without builder is refused, and nothing is written", %{world: world, ada: ada} do
    assert MuaWorld.builder(world, account(ada)) == nil
    assert place(world, ada, @satchel) == {:error, "You can't build."}
    assert named_thing(world, "Satchel") == nil
  end

  test "a builder over their quota is refused", %{world: world, ada: ada} do
    grant(world, ada, %{"max_placed" => 1})
    assert {:ok, _} = place(world, ada, @satchel)

    second = put_in(@satchel, ["described", "name"], "Pouch")
    assert place(world, ada, second) == {:error, "You have placed all 1 things you may."}
    assert named_thing(world, "Pouch") == nil
    assert MuaWorld.builder(world, account(ada)).placed == 1
  end

  test "an invalid composition is refused, and nothing is written", %{world: world, ada: ada} do
    grant(world, ada)

    refusals = [
      {Map.put(@satchel, "script", %{"src" => "on take\nend take"}),
       "You can't build with script"},
      {Map.put(@satchel, "location", %{"in" => ada}), "You can't build with location"},
      {Map.delete(@satchel, "described"), "A thing needs a described"},
      {put_in(@satchel, ["described", "name"], String.duplicate("a", 41)), "at most 40"},
      {put_in(@satchel, ["described", "description"], String.duplicate("a", 501)), "at most 500"},
      {put_in(@satchel, ["container", "capacity"], 21), "can hold at most 20"},
      {put_in(@satchel, ["item"], %{"weight" => "heavy"}), "must be float"},
      {put_in(@satchel, ["item"], %{"colour" => "red"}), "no property 'colour'"},
      {"satchel", "A composition is a map"}
    ]

    for {composition, reason} <- refusals do
      assert {:error, why} = place(world, ada, composition)
      assert why =~ reason
    end

    assert named_thing(world, "Satchel") == nil
    assert MuaWorld.builder(world, account(ada)).placed == 0
    assert received(ada) == []
  end

  test "a placed thing has no home, across a restart, so a reset leaves it where play put it (#271)",
       %{world: world, ada: ada, tmp_dir: dir} do
    grant(world, ada)
    assert {:ok, %{eid: satchel}} = place(world, ada, @satchel)
    vault = location(world, ada)
    # one given a home before #271 loses it at the next start
    :ok = MuaWorld.set_component(world, satchel, "home", %{"in" => vault})
    GenServer.stop(world)

    world = start("locks.edl", dir)
    assert MuaWorld.component(world, satchel, "home") == nil
    assert MuaWorld.component(world, MuaWorld.named(world, "spoon"), "home") == %{"in" => vault}

    strongbox = MuaWorld.named(world, "strongbox")
    :ok = MuaWorld.set_component(world, satchel, "location", %{"in" => strongbox})
    assert MuaWorld.reset(world, vault) == 0
    assert location(world, satchel) == strongbox
  end

  test "a container left at its default capacity is held to the builder's limit",
       %{world: world, ada: ada} do
    grant(world, ada, %{"max_capacity" => 5})
    box = %{"described" => %{"name" => "Box"}, "container" => %{}}
    assert place(world, ada, box) == {:error, "A container can hold at most 5."}
  end

  test "an Admin grants and removes building at the prompt; what was placed stays",
       %{tmp_dir: dir} do
    dir = Path.join(dir, "admin")
    File.mkdir_p!(dir)
    world = start("locks.edl", dir)
    {:ok, account} = MuaWorld.sign_in(world, "sub-ada", "ada@example.com", admin: true)
    {:ok, ada} = MuaWorld.create_character(world, account, "ada")
    Process.put({:account, ada}, account)
    {:ok, _} = MuaWorld.enter(world, account, ada)

    assert {:ok, ["=> nothing"]} =
             MuaWorld.admin_line(
               world,
               account,
               ada,
               ~s(change the account of the player of actor, "builder", {})
             )

    assert {:ok, %{eid: satchel}} = place(world, ada, @satchel)

    assert {:ok, ["=> nothing"]} =
             MuaWorld.admin_line(
               world,
               account,
               ada,
               ~s(remove the account of the player of actor, "builder")
             )

    assert MuaWorld.builder(world, account) == nil
    assert place(world, ada, @satchel) == {:error, "You can't build."}

    # another player in the room, by name
    bob = join(world, "bob")

    assert {:ok, ["=> nothing"]} =
             MuaWorld.admin_line(
               world,
               account,
               ada,
               ~s(change the account of the player of element "bob" of here, "builder", {max_placed: 3})
             )

    assert %{max_placed: 3, placed: 0} = MuaWorld.builder(world, account(bob))
    assert location(world, satchel) == location(world, ada)
    assert MuaWorld.component(world, satchel, "made_by") == %{"account" => account}
  end

  test "only the Character's own Account places, and only in play", %{
    world: world,
    ada: ada,
    bob: bob
  } do
    grant(world, ada)
    assert MuaWorld.place(world, account(bob), ada, @satchel) == {:error, :not_owner}
    :ok = MuaWorld.leave(world, account(ada), ada)
    assert place(world, ada, @satchel) == {:error, :not_in_play}
  end
end
