# Accounts, Characters, Limbo and the Starting room (#115), with the Limbo
# cases of packages/mua/src/server/mua-world/__test__/lifecycle.test.ts,
# against the main world.
defmodule MuaWorld.AccountsTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  alias MuaWorld.Places

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    {:ok, world: start("main", dir), dir: dir}
  end

  describe "the places every World has" do
    test "has Limbo and a system actor", %{world: world} do
      %{limbo: limbo, system: system, starting_room: room} = MuaWorld.places(world)

      assert MuaWorld.component(world, limbo, "described")["name"] == "Limbo"
      assert location(world, system) == limbo
      assert room == MuaWorld.named(world, "harbour_steps")
    end

    test "refuses to start without a valid Starting room", %{dir: dir} do
      Process.flag(:trap_exit, true)

      for {room, reason} <- [
            {nil, ~r/no starting room/},
            {"nowhere", ~r/not an entity/},
            {"crate", ~r/not a top-level place/}
          ] do
        path = Path.join(dir, "bad-#{room}.db")

        opts = [
          path: path,
          edl: Path.join(:code.priv_dir(:mua_world), "edl/main.edl"),
          tick: :manual
        ]

        assert {:error, {:invalid_starting_room, message}} =
                 MuaWorld.start(Keyword.put(opts, :starting_room, room))

        assert message =~ reason
      end
    end
  end

  describe "Accounts and Characters" do
    test "a new Character waits in Limbo until it enters", %{world: world} do
      {:ok, account} = MuaWorld.create_account(world)
      {:ok, bob} = MuaWorld.create_character(world, account, "bob")

      assert location(world, bob) == MuaWorld.places(world).limbo
      assert {:error, :not_in_play} = MuaWorld.command(world, account, bob, "look")

      assert {:ok, ["Welcome, bob! Type 'look' to begin, or 'help' for the commands."]} =
               MuaWorld.enter(world, account, bob)

      assert location(world, bob) == MuaWorld.named(world, "harbour_steps")

      assert {:ok, [%{picture: %{src: "pictures/harbour_steps.png"}}, look]} =
               MuaWorld.command(world, account, bob, "look")

      assert look =~ "Harbour Steps"
    end

    test "only a Character coming out of Limbo is welcomed", %{world: world} do
      {:ok, account} = MuaWorld.create_account(world)
      {:ok, bob} = MuaWorld.create_character(world, account, "bob")

      assert {:ok, [_welcome]} = MuaWorld.enter(world, account, bob)
      assert {:ok, []} = MuaWorld.enter(world, account, bob)
    end

    test "names are unique among Characters, ignoring case", %{world: world} do
      {:ok, account} = MuaWorld.create_account(world)
      {:ok, _} = MuaWorld.create_character(world, account, "Bob")

      assert {:error, :name_taken} = MuaWorld.create_character(world, account, "bob")
      assert {:error, :invalid_name} = MuaWorld.create_character(world, account, "")
      assert {:error, :invalid_name} = MuaWorld.create_character(world, account, "9lives")
      assert {:error, :not_an_account} = MuaWorld.create_character(world, 999_999, "Carol")
    end

    test "an Account can't control another Account's Character", %{world: world} do
      bob = join(world, "bob")
      {:ok, mallory} = MuaWorld.create_account(world)

      assert {:error, :not_owner} = MuaWorld.command(world, mallory, bob, "look")
      assert {:error, :not_owner} = MuaWorld.enter(world, mallory, bob)
      assert {:error, :not_owner} = MuaWorld.leave(world, mallory, bob)
      assert {:error, :not_owner} = MuaWorld.command(world, account(bob), mallory, "look")
    end

    test "Accounts and Characters survive a restart", %{world: world, dir: dir} do
      bob = join(world, "bob")
      send_command(world, bob, "north")
      GenServer.stop(world)

      world = start("main", dir)
      assert location(world, bob) == MuaWorld.named(world, "square")
      assert send_command(world, bob, "look") =~ "The Square"
    end
  end

  describe "leaving and returning" do
    test "sends a Character who leaves to Limbo, and back when it returns", %{world: world} do
      alice = join(world, "alice")
      bob = join(world, "bob")
      received(alice)

      :ok = MuaWorld.leave(world, account(bob), bob)
      assert location(world, bob) == MuaWorld.places(world).limbo
      assert received(alice) == ["bob fades from view."]
      refute send_command(world, alice, "look") =~ "bob"
      received(alice)

      {:ok, _} = MuaWorld.enter(world, account(bob), bob)
      assert location(world, bob) == MuaWorld.named(world, "harbour_steps")
      assert received(alice) == ["bob appears."]
    end

    test "returns a Character to the room it left", %{world: world} do
      bob = join(world, "bob")
      send_command(world, bob, "north")
      :ok = MuaWorld.leave(world, account(bob), bob)
      {:ok, _} = MuaWorld.enter(world, account(bob), bob)

      assert location(world, bob) == MuaWorld.named(world, "square")
    end

    test "leaving or entering twice changes nothing", %{world: world} do
      bob = join(world, "bob")
      {:ok, _} = MuaWorld.enter(world, account(bob), bob)
      assert location(world, bob) == MuaWorld.named(world, "harbour_steps")

      :ok = MuaWorld.leave(world, account(bob), bob)
      :ok = MuaWorld.leave(world, account(bob), bob)
      {:ok, _} = MuaWorld.enter(world, account(bob), bob)
      assert location(world, bob) == MuaWorld.named(world, "harbour_steps")
    end
  end

  describe "where a returning Character goes" do
    setup do
      {:ok, ecs} = OdgnEcs.open(":memory:")

      ecs =
        Enum.reduce(MuaWorld.Components.all(), ecs, fn c, w -> elem(OdgnEcs.define(w, c), 1) end)

      [limbo, start, hall, bob] = for _ <- 1..4, do: elem(OdgnEcs.create(ecs), 1)
      places = %{limbo: limbo, system: nil, starting_room: start}
      {:ok, ecs: ecs, places: places, hall: hall, bob: bob}
    end

    defp returning_to(c, room) do
      :ok = OdgnEcs.put(c.ecs, c.bob, "player", %{"name" => "bob", "return_to" => room})
      Places.destination(c.ecs, c.bob, c.places)
    end

    test "is the room it left, while that is still a place", c do
      assert returning_to(c, c.hall) == c.hall
    end

    test "is the Starting room when the room is gone, is Limbo, is inside something, or was never set",
         c do
      start = c.places.starting_room

      # Deleting the room empties `return_to`, which can't hold a gone room
      {:ok, gone} = OdgnEcs.create(c.ecs)
      :ok = OdgnEcs.put(c.ecs, c.bob, "player", %{"name" => "bob", "return_to" => gone})
      :ok = OdgnEcs.delete(c.ecs, gone)
      assert OdgnEcs.get(c.ecs, c.bob, "player")["return_to"] == nil
      assert Places.destination(c.ecs, c.bob, c.places) == start

      assert returning_to(c, c.places.limbo) == start
      assert returning_to(c, nil) == start

      {:ok, tent} = OdgnEcs.create(c.ecs)
      :ok = OdgnEcs.put(c.ecs, tent, "location", %{"in" => c.hall})
      assert returning_to(c, tent) == start
    end
  end

  describe "two Characters" do
    test "meet, speak, move, and take and drop an item", %{world: world} do
      alice = join(world, "alice")
      bob = join(world, "bob")
      received(alice)

      assert send_command(world, bob, "say hello") == ~s(You say, "hello")
      assert received(alice) == [~s(bob says, "hello")]

      send_command(world, alice, "open crate")
      assert send_command(world, alice, "take card") == "Taken."
      assert send_command(world, alice, "north") =~ "The Square"
      assert Enum.join(received(bob), "\n") =~ "alice goes north."

      assert send_command(world, alice, "drop card") == "Dropped."
      send_command(world, bob, "north")
      assert send_command(world, bob, "take card") == "Taken."
      assert location(world, MuaWorld.named(world, "tide_card")) == bob
      assert send_command(world, bob, "inventory") =~ "tide card"
      refute send_command(world, alice, "inventory") =~ "tide card"
    end

    test "competing to take one item get one consistent outcome", %{world: world} do
      alice = join(world, "alice")
      bob = join(world, "bob")
      send_command(world, alice, "open crate")

      replies =
        [alice, bob]
        |> Enum.map(fn who ->
          # the Task has its own process dictionary, so it is given the Account
          account = account(who)

          Task.async(fn ->
            {:ok, lines} = MuaWorld.command(world, account, who, "take card")
            {who, Enum.join(lines, "\n")}
          end)
        end)
        |> Enum.map(&Task.await/1)

      assert [{winner, "Taken."}] = Enum.filter(replies, fn {_, reply} -> reply == "Taken." end)
      [{loser, refusal}] = Enum.reject(replies, fn {who, _} -> who == winner end)

      refute refusal == "Taken."
      assert location(world, MuaWorld.named(world, "tide_card")) == winner
      assert send_command(world, winner, "inventory") =~ "tide card"
      refute send_command(world, loser, "inventory") =~ "tide card"
    end
  end
end
