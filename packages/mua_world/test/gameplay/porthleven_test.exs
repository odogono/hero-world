# Porthleven, the main world (priv/edl/main.edl): what spec/mua/steps/
# porthleven.json doesn't play, and the Migration from the house it replaced.
defmodule MuaWorld.PorthlevenTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  @main Path.join(:code.priv_dir(:mua_world), "edl/main.edl")

  setup %{tmp_dir: dir} do
    world = start("main", dir)
    {:ok, world: world, bob: join(world, "bob")}
  end

  defp send_bob(%{world: world, bob: bob}, text), do: send_command(world, bob, text)
  defp walk(c, commands), do: for(command <- commands, do: send_bob(c, command))

  # from the Harbour Steps, up Hill Lane to the keeper's garden
  @to_garden ["north", "north", "north"]

  describe "the keeper's garden" do
    test "lies north of Hill Lane", c do
      walk(c, ["north", "north"])
      assert send_bob(c, "north") =~ "Garden Path"
    end

    test "answers look in a room with a scripted mix-in", c do
      walk(c, @to_garden)
      assert send_bob(c, "look") =~ "A gravel path runs between"
    end

    test "smells of roses, and the fish market of fish", c do
      walk(c, @to_garden)

      assert send_bob(c, "smell") == "The air is thick with the scent of roses."
      assert send_bob(c, "sniff roses") =~ "heady, sweet scent"

      walk(c, ["south", "south", "south", "east"])
      assert send_bob(c, "smell") =~ "Fish, salt and diesel"
    end

    test "opens the locked shed with the key from the well", c do
      walk(c, @to_garden)
      assert send_bob(c, "east") == "The shed door is closed."
      assert send_bob(c, "open door") == "The shed door is locked."

      walk(c, ["north", "north", "take key from bucket", "south", "south"])
      send_bob(c, "unlock door")
      assert send_bob(c, "open door") == "Opened."
      assert send_bob(c, "east") =~ "Garden Shed"
      assert send_bob(c, "read catalogue") =~ "Water them every evening"
    end

    test "lets you water the roses with the watering can", c do
      walk(c, @to_garden ++ ["north", "north", "take key from bucket", "south", "south"])
      walk(c, ["unlock door", "open door", "east", "take can", "take trowel"])
      send_bob(c, "west")

      assert send_bob(c, "water roses with trowel") == "The trowel won't help the roses."

      assert send_bob(c, "water roses with can") ==
               "You water the roses. They drink gratefully and lift their heads."
    end

    test "has a gardener who potters off on his own", c do
      walk(c, @to_garden ++ ["north"])
      received(c.bob)

      run_for(c.world, 50)
      assert "Hollis goes south." in received(c.bob)
    end
  end

  describe "the town" do
    test "has a net-mender who walks between the fish market and The Ship", c do
      walk(c, ["north", "west"])
      received(c.bob)

      # three heartbeats from the fish market to The Ship, 45 s apart
      run_for(c.world, 150)
      assert "Tamsin arrives." in received(c.bob)
      tamsin = MuaWorld.named(c.world, "tamsin")
      assert MuaWorld.component(c.world, tamsin, "errand") == %{"heading" => "inn"}

      run_for(c.world, 45)
      assert "Tamsin goes east." in received(c.bob)
      assert MuaWorld.component(c.world, tamsin, "errand") == %{"heading" => "market"}
    end

    test "lets you take from the counter once Jory has gone", c do
      walk(c, ["north", "west"])
      assert send_bob(c, "take tankard") =~ "That's paid for"

      jory = MuaWorld.named(c.world, "jory")

      :ok =
        MuaWorld.set_component(c.world, jory, "location", %{
          "in" => MuaWorld.named(c.world, "back_room")
        })

      assert send_bob(c, "take tankard") == "Taken."
    end

    test "puts the lamp out when the lamp room resets", c do
      lamp = MuaWorld.named(c.world, "lamp")
      :ok = MuaWorld.set_component(c.world, lamp, "beacon", %{"is_lit" => true})
      assert send_bob(c, "look") =~ "The lighthouse beam sweeps across the harbour."

      MuaWorld.reset(c.world, MuaWorld.named(c.world, "lamp_room"))
      assert MuaWorld.component(c.world, lamp, "beacon") == %{"is_lit" => false}
      refute send_bob(c, "look") =~ "lighthouse beam"
    end
  end

  describe "the Migration from the house it replaced" do
    @house fixture("house-world/main.edl")

    test "moves Characters from the house to the Harbour Steps, and keeps the garden's play", %{
      tmp_dir: dir
    } do
      dir = Path.join(dir, "migrated")
      File.mkdir_p!(dir)
      db = Path.join(dir, "world.db")

      house = start(@house, dir, path: db)
      ada = join(house, "ada")
      send_command(house, ada, "open mailbox")
      send_command(house, ada, "take leaflet")
      send_command(house, ada, "north")
      hollis = MuaWorld.named(house, "hollis")
      GenServer.stop(house)

      # the old Starting room is gone, so the Migration must name the new one
      assert {:error, _} =
               MuaWorld.Migration.migrate_file(db, @main,
                 starting_room: "west_of_house",
                 prune: true
               )

      assert {:ok, lines} =
               MuaWorld.Migration.migrate_file(db, @main,
                 starting_room: "harbour_steps",
                 prune: true
               )

      assert Enum.any?(lines, &(&1 =~ "Moved to Limbo"))

      world = start("main", dir, path: db)
      assert location(world, ada) == MuaWorld.named(world, "harbour_steps")
      assert MuaWorld.named(world, "west_of_house") == nil
      # the garden's entities carried over as they were
      assert MuaWorld.named(world, "hollis") == hollis

      {:ok, _} = MuaWorld.enter(world, account(ada), ada)
      :ok = MuaWorld.subscribe(world, ada)
      assert send_command(world, ada, "look") =~ "Harbour Steps"
      assert send_command(world, ada, "north") =~ "The Square"
    end
  end
end
