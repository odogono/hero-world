# Editing a placed thing (#274). Whether it may be edited is the build
# Service Script's (mua-scripts/scripts/services/build.talk).
defmodule MuaWorld.EditTest do
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
    ada = join(world, "ada")
    bob = join(world, "bob")
    grant(world, ada)
    {:ok, %{eid: satchel}} = MuaWorld.place(world, account(ada), ada, @satchel)
    received(ada)
    received(bob)
    {:ok, world: world, ada: ada, bob: bob, satchel: satchel}
  end

  defp grant(world, eid, builder \\ %{}),
    do: :ok = MuaWorld.set_component(world, account(eid), "builder", builder)

  defp editing(world, eid), do: MuaWorld.editing(world, account(eid), eid)

  defp save(world, eid, thing, patch), do: MuaWorld.edit(world, account(eid), eid, thing, patch)

  defp open_and_save(world, eid, thing, patch) do
    send_command(world, eid, "edit satchel")
    save(world, eid, thing, patch)
  end

  test "a builder edits what they placed, and others see it change",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    assert editing(world, ada) == {:ok, nil}
    assert send_command(world, ada, "edit satchel") == "You open the satchel to edit it."

    assert {:ok, %{eid: ^satchel, composition: composition}} = editing(world, ada)
    assert composition["described"]["description"] == "A leather satchel."
    assert composition["container"]["capacity"] == 5.0
    assert Map.keys(composition) |> Enum.sort() == ["container", "described", "item"]

    patch = %{
      "put" => %{
        "described" => %{"description" => "A battered satchel."},
        "container" => %{"capacity" => 8}
      }
    }

    received(ada)
    assert save(world, ada, satchel, patch) == {:ok, %{eid: satchel}}
    assert received(ada) == ["You reshape the satchel."]
    assert received(bob) == ["ada reshapes the satchel."]

    assert MuaWorld.component(world, satchel, "described") == %{
             "name" => "Satchel",
             "description" => "A battered satchel."
           }

    assert MuaWorld.component(world, satchel, "container")["capacity"] == 8.0
    # saving closes it, and the Maker is unchanged
    assert editing(world, ada) == {:ok, nil}
    assert MuaWorld.component(world, satchel, "made_by") == %{"account" => account(ada)}
    assert send_command(world, bob, "look at satchel") =~ "A battered satchel."
  end

  test "an edit adds and removes components",
       %{world: world, ada: ada, satchel: satchel} do
    patch = %{
      "put" => %{"readable" => %{"text" => "Property of ada."}},
      "remove" => ["container"]
    }

    assert {:ok, _} = open_and_save(world, ada, satchel, patch)
    assert MuaWorld.component(world, satchel, "container") == nil
    assert MuaWorld.component(world, satchel, "readable") == %{"text" => "Property of ada."}
  end

  test "an edit leaves the Play state it didn't touch",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    send_command(world, ada, "edit satchel")
    assert send_command(world, bob, "open satchel") == "Opened."

    patch = %{"put" => %{"described" => %{"description" => "A battered satchel."}}}
    assert {:ok, _} = save(world, ada, satchel, patch)
    assert MuaWorld.component(world, satchel, "container")["is_closed"] == false
  end

  test "who may edit is the builder's edit permission",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    assert send_command(world, bob, "edit satchel") == "You can't build."

    grant(world, bob)
    assert send_command(world, bob, "edit satchel") == "You didn't make that."

    grant(world, bob, %{"edit" => "none"})
    assert send_command(world, bob, "edit satchel") == "You can't edit things."

    assert send_command(world, ada, "edit spoon") == "Only a thing someone placed can be edited."
    assert editing(world, bob) == {:ok, nil}
    assert editing(world, ada) == {:ok, nil}

    # an edit that wasn't opened is refused
    patch = %{"put" => %{"described" => %{"name" => "Pouch"}}}
    assert save(world, bob, satchel, patch) == {:error, "Open it with edit first."}

    # taking the permission away after opening stops the save
    send_command(world, ada, "edit satchel")
    grant(world, ada, %{"edit" => "none"})
    assert save(world, ada, satchel, patch) == {:error, "You can't edit things."}
    assert MuaWorld.component(world, satchel, "described")["name"] == "Satchel"
  end

  test "a builder who may edit any placed thing is held to its Maker's limits",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    grant(world, ada, %{"max_capacity" => 6})
    grant(world, bob, %{"edit" => "any", "max_capacity" => 100})

    assert send_command(world, bob, "edit satchel") == "You open the satchel to edit it."

    assert save(world, bob, satchel, %{"put" => %{"container" => %{"capacity" => 7}}}) ==
             {:error, "A container can hold at most 6."}

    assert {:ok, _} = save(world, bob, satchel, %{"put" => %{"container" => %{"capacity" => 6}}})
    assert MuaWorld.component(world, satchel, "made_by") == %{"account" => account(ada)}
  end

  test "an edit that would strand anything, or break the Place rules, is refused",
       %{world: world, ada: ada, bob: bob, satchel: satchel} do
    assert send_command(world, ada, "open satchel") == "Opened."

    :ok =
      MuaWorld.set_component(world, MuaWorld.named(world, "spoon"), "location", %{"in" => satchel})

    :ok =
      MuaWorld.set_component(world, MuaWorld.named(world, "gold"), "location", %{"in" => satchel})

    send_command(world, ada, "edit satchel")

    refusals = [
      {%{"remove" => ["container"]}, "The satchel holds things: empty it first."},
      {%{"put" => %{"container" => %{"capacity" => 1}}}, "The satchel holds 2 things"},
      {%{"remove" => ["described"]}, "A thing needs a described"},
      {%{"put" => %{"described" => %{"name" => ""}}}, "A thing needs a name."},
      {%{"put" => %{"script" => %{"src" => ""}}}, "You can't edit script"},
      {%{"remove" => ["location"]}, "You can't edit location"},
      {%{"put" => %{"item" => %{"weight" => "heavy"}}}, "must be float"},
      {"satchel", "An edit is a map"}
    ]

    for {patch, reason} <- refusals do
      assert {:error, why} = save(world, ada, satchel, patch)
      assert why =~ reason
    end

    # nothing was written, and it is still open
    assert MuaWorld.component(world, satchel, "container")["capacity"] == 5.0
    assert {:ok, %{eid: ^satchel}} = editing(world, ada)
    assert received(bob) == ["ada opens the satchel."]

    # a carried thing must stay one that can be carried
    :ok = MuaWorld.set_component(world, satchel, "location", %{"in" => ada})

    assert save(world, ada, satchel, %{"remove" => ["item"]}) ==
             {:error,
              "Someone is carrying the satchel: it must stay a thing that can be carried."}
  end

  test "an open edit is saved only while the thing is within reach, and can be closed",
       %{world: world, ada: ada, satchel: satchel} do
    send_command(world, ada, "edit satchel")
    strongbox = MuaWorld.named(world, "strongbox")
    :ok = MuaWorld.set_component(world, satchel, "location", %{"in" => strongbox})

    assert save(world, ada, satchel, %{"put" => %{"described" => %{"name" => "Pouch"}}}) ==
             {:error, "You can't reach that from here."}

    assert MuaWorld.stop_editing(world, account(ada), ada) == :ok
    assert editing(world, ada) == {:ok, nil}
  end

  test "a builder who may not place is refused", %{world: world, ada: ada} do
    grant(world, ada, %{"place" => false})

    assert MuaWorld.place(world, account(ada), ada, @satchel) ==
             {:error, "You can't place things."}

    # but may still edit what they made
    assert send_command(world, ada, "edit satchel") == "You open the satchel to edit it."
  end
end
