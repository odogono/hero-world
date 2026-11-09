# A client's mirror of a Character's Perception, and the change sets that
# keep it current after each Step (#164, ADR 0019).
defmodule MuaWorld.MirrorTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    world = start("objects.edl", dir)
    bob = join(world, "bob")
    {:ok, mirror} = MuaWorld.mirror(world, account(bob), bob)
    flush()
    {:ok, world: world, bob: bob, mirror: mirror}
  end

  defp flush do
    receive do
      {:mua, _, _} -> flush()
      {:mua_changes, _, _} -> flush()
    after
      0 -> :ok
    end
  end

  defp change_sets(eid, acc \\ []) do
    receive do
      {:mua_changes, ^eid, cs} -> change_sets(eid, [cs | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  defp names(rows), do: rows |> Map.get("described", []) |> Enum.map(& &1["name"]) |> Enum.sort()

  test "holds the room and what is in it, but not inside a closed crate", c do
    assert c.mirror.character == c.bob
    names = names(c.mirror.components)
    assert "Workshop" in names
    assert "Lamp" in names
    assert "Crate" in names
    refute "Coin" in names
  end

  test "shows only the allowed fields", c do
    [bob_row] = Enum.filter(c.mirror.components["player"], &(&1["eid"] == c.bob))
    assert bob_row == %{"eid" => c.bob, "name" => "bob"}
    refute Map.has_key?(c.mirror.components, "script")
    refute Map.has_key?(c.mirror.components, "account")
  end

  test "is refused for another Account's Character", c do
    {:ok, other} = MuaWorld.create_account(c.world)
    assert {:error, :not_owner} = MuaWorld.mirror(c.world, other, c.bob)
  end

  test "sends what changed after a Step", c do
    send_command(c.world, c.bob, "take lamp")
    [cs] = change_sets(c.bob)
    lamp = Enum.find(c.mirror.components["described"], &(&1["name"] == "Lamp"))["eid"]
    assert %{"eid" => ^lamp, "in" => bob} = hd(cs.put["location"])
    assert bob == c.bob
    assert cs.gone == []
  end

  test "sends the contents of a container once it is opened", c do
    send_command(c.world, c.bob, "open crate")
    [cs] = change_sets(c.bob)
    assert "Coin" in names(cs.put)
  end

  test "sends nothing for a Step that changes nothing it perceives", c do
    send_command(c.world, c.bob, "examine lamp")
    assert change_sets(c.bob) == []
  end
end
