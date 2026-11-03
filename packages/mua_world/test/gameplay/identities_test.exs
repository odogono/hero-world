# Sign-in identities mapped to Accounts (ADR 0016), and the view a Character
# is given of the World (#97).
defmodule MuaWorld.IdentitiesTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    {:ok, world: start("main", dir), dir: dir}
  end

  describe "sign_in" do
    test "makes an Account the first time, and finds it after", %{world: world} do
      {:ok, account} = MuaWorld.sign_in(world, "google-1", "ada@example.com")

      assert MuaWorld.component(world, account, "account") == %{"admin" => false}
      assert {:ok, ^account} = MuaWorld.sign_in(world, "google-1", "ada@new.example.com")
      assert {:ok, other} = MuaWorld.sign_in(world, "google-2", "bob@example.com")
      assert other != account
    end

    test "keeps the mapping across a restart", %{world: world, dir: dir} do
      {:ok, account} = MuaWorld.sign_in(world, "google-1", "ada@example.com")
      GenServer.stop(world)

      world = start("main", dir)
      assert {:ok, ^account} = MuaWorld.sign_in(world, "google-1", "ada@example.com")
    end
  end

  test "in_play lists the Characters outside Limbo, with their Accounts", %{world: world} do
    {:ok, account} = MuaWorld.sign_in(world, "google-1", "ada@example.com")
    {:ok, ada} = MuaWorld.create_character(world, account, "Ada")
    assert MuaWorld.in_play(world) == []

    {:ok, _} = MuaWorld.enter(world, account, ada)
    assert MuaWorld.in_play(world) == [{account, ada}]
    assert MuaWorld.characters(world, account) == [%{id: ada, name: "Ada", in_play: true}]
  end

  describe "view" do
    setup %{world: world} do
      {:ok, account} = MuaWorld.sign_in(world, "google-1", "ada@example.com")
      {:ok, ada} = MuaWorld.create_character(world, account, "Ada")
      {:ok, account: account, ada: ada}
    end

    test "is refused for a Character in Limbo or not the Account's", c do
      assert {:error, :not_in_play} = MuaWorld.view(c.world, c.account, c.ada)
      {:ok, other} = MuaWorld.sign_in(c.world, "google-2", "bob@example.com")
      {:ok, _} = MuaWorld.enter(c.world, c.account, c.ada)
      assert {:error, :not_owner} = MuaWorld.view(c.world, other, c.ada)
    end

    test "shows the room, the others in it, what the Character carries, and what it could do",
         c do
      {:ok, _} = MuaWorld.enter(c.world, c.account, c.ada)
      {:ok, bob_account} = MuaWorld.sign_in(c.world, "google-2", "bob@example.com")
      {:ok, bob} = MuaWorld.create_character(c.world, bob_account, "Bob")
      {:ok, _} = MuaWorld.enter(c.world, bob_account, bob)

      assert {:ok, view} = MuaWorld.view(c.world, c.account, c.ada)
      assert view.room.name == "West of house"
      assert view.room.exits == ["north", "south"]
      assert view.room.items == ["Mailbox"]
      assert "Bob" in view.room.players
      refute "Ada" in view.room.players
      assert view.inventory == []
      assert "north" in view.actions
    end
  end
end
