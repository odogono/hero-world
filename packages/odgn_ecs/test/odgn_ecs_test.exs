# Storage and queries, and the change cases adapted from
# packages/ecs/src/world/__test__/changes.test.ts.
defmodule OdgnEcsTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component, Error}

  @stats %Component{name: "stats", columns: [%Column{name: "health", type: :int}]}
  @thing %Component{
    name: "thing",
    columns: [
      %Column{name: "size", type: :float, default: 1},
      %Column{name: "label", type: :string, optional: false},
      %Column{name: "open", type: :boolean, default: false},
      %Column{name: "tags", type: :array},
      %Column{name: "props", type: :json}
    ]
  }

  defp world(defs \\ [@stats, @thing]) do
    {:ok, world} = OdgnEcs.open(":memory:")

    Enum.reduce(defs, world, fn c, w ->
      {:ok, w} = OdgnEcs.define(w, c)
      w
    end)
  end

  defp with_health(world, health) do
    {:ok, eid} = OdgnEcs.create(world)
    :ok = OdgnEcs.put(world, eid, "stats", %{"health" => health})
    eid
  end

  describe "components" do
    test "store typed values and fill in defaults" do
      w = world()
      {:ok, eid} = OdgnEcs.create(w)

      :ok =
        OdgnEcs.put(w, eid, "thing", %{
          "label" => "box",
          "tags" => ["a"],
          "props" => %{"x" => [1]}
        })

      assert OdgnEcs.get(w, eid, "thing") == %{
               "size" => 1.0,
               "label" => "box",
               "open" => false,
               "tags" => ["a"],
               "props" => %{"x" => [1]}
             }
    end

    test "putting a component replaces it whole" do
      w = world()
      {:ok, eid} = OdgnEcs.create(w)
      :ok = OdgnEcs.put(w, eid, "thing", %{"label" => "box", "open" => true})
      :ok = OdgnEcs.put(w, eid, "thing", %{"label" => "lid"})

      assert %{"label" => "lid", "open" => false} = OdgnEcs.get(w, eid, "thing")
    end

    test "reject values that don't fit" do
      w = world()
      {:ok, eid} = OdgnEcs.create(w)

      assert {:error, %Error{kind: :missing_value}} = OdgnEcs.put(w, eid, "thing", %{})

      assert {:error, %Error{kind: :invalid_value}} =
               OdgnEcs.put(w, eid, "stats", %{"health" => "x"})

      assert {:error, %Error{kind: :unknown_property}} =
               OdgnEcs.put(w, eid, "stats", %{"hp" => 1})

      assert {:error, %Error{kind: :unknown_component}} = OdgnEcs.put(w, eid, "nope", %{})
      assert {:error, %Error{kind: :unknown_entity}} = OdgnEcs.put(w, 999, "stats", %{})
    end

    test "unique columns are enforced" do
      w =
        world([
          %Component{name: "tag", columns: [%Column{name: "code", type: :string, unique: true}]}
        ])

      {:ok, a} = OdgnEcs.create(w)
      {:ok, b} = OdgnEcs.create(w)
      :ok = OdgnEcs.put(w, a, "tag", %{"code" => "x"})

      assert {:error, %Error{kind: :constraint}} = OdgnEcs.put(w, b, "tag", %{"code" => "x"})
    end

    test "a definition may not use a reserved column" do
      {:ok, w} = OdgnEcs.open(":memory:")
      bad = %Component{name: "bad", columns: [%Column{name: "id", type: :string}]}

      assert {:error,
              %Error{
                kind: :reserved_column,
                message: "Component 'bad' cannot define reserved column 'id'."
              }} =
               OdgnEcs.define(w, bad)
    end

    test "defining a component again must match" do
      w = world()
      assert {:ok, ^w} = OdgnEcs.define(w, @stats)

      changed = %{@stats | columns: [%Column{name: "health", type: :float}]}
      assert {:error, %Error{kind: :definition_changed}} = OdgnEcs.define(w, changed)
    end

    test "deleting an entity removes its components" do
      w = world()
      eid = with_health(w, 5)
      :ok = OdgnEcs.delete(w, eid)

      refute OdgnEcs.exists?(w, eid)
      assert OdgnEcs.get(w, eid, "stats") == nil
    end
  end

  describe "queries" do
    test "find entities by component and value" do
      w = world()
      a = with_health(w, 5)
      b = with_health(w, 9)
      {:ok, c} = OdgnEcs.create(w)
      :ok = OdgnEcs.put(w, c, "thing", %{"label" => "box", "open" => true})

      assert OdgnEcs.query(w, with: ["stats"]) == [a, b]
      assert OdgnEcs.query(w, where: [{"stats", "health", 9}]) == [b]
      assert OdgnEcs.query(w, where: [{"thing", "open", true}]) == [c]
      assert OdgnEcs.query(w, with: ["stats", "thing"]) == []
      assert OdgnEcs.query(w) == [a, b, c]
      assert OdgnEcs.query(w, with: ["undefined"]) == []
    end
  end

  describe "changes" do
    test "a rolled-back savepoint leaves no trace" do
      w = world()
      eid = with_health(w, 100)
      :ok = OdgnEcs.savepoint(w, "s")
      :ok = OdgnEcs.put(w, eid, "stats", %{"health" => 10})
      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 10}

      :ok = OdgnEcs.rollback_to(w, "s")
      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 100}
    end

    test "a released savepoint keeps its changes" do
      w = world()
      eid = with_health(w, 100)
      :ok = OdgnEcs.begin(w)
      :ok = OdgnEcs.savepoint(w, "s")
      :ok = OdgnEcs.put(w, eid, "stats", %{"health" => 20})
      :ok = OdgnEcs.release(w, "s")
      :ok = OdgnEcs.commit(w)

      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 20}
    end

    test "rolling back keeps changes made before the savepoint" do
      w = world()
      eid = with_health(w, 100)
      :ok = OdgnEcs.begin(w)
      :ok = OdgnEcs.put(w, eid, "stats", %{"health" => 50})
      :ok = OdgnEcs.savepoint(w, "s")
      :ok = OdgnEcs.put(w, eid, "stats", %{"health" => 40})
      :ok = OdgnEcs.rollback_to(w, "s")
      :ok = OdgnEcs.commit(w)

      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 50}
    end

    test "rolling back restores removed components and deleted entities" do
      w = world()
      eid = with_health(w, 100)
      {:ok, other} = OdgnEcs.create(w)
      :ok = OdgnEcs.savepoint(w, "s")
      :ok = OdgnEcs.remove(w, eid, "stats")
      :ok = OdgnEcs.delete(w, other)
      :ok = OdgnEcs.rollback_to(w, "s")

      assert OdgnEcs.exists?(w, other)
      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 100}
    end

    test "rolling back removes entities created since" do
      w = world()
      :ok = OdgnEcs.savepoint(w, "s")
      eid = with_health(w, 1)
      :ok = OdgnEcs.rollback_to(w, "s")

      refute OdgnEcs.exists?(w, eid)
    end

    test "in_savepoint releases on ok and rolls back on error or raise" do
      w = world()
      eid = with_health(w, 1)

      assert {:ok, 2} =
               OdgnEcs.in_savepoint(w, "a", fn ->
                 {OdgnEcs.put(w, eid, "stats", %{"health" => 2}), 2}
               end)

      assert :nope =
               OdgnEcs.in_savepoint(w, "b", fn ->
                 OdgnEcs.put(w, eid, "stats", %{"health" => 3}) && :nope
               end)

      assert_raise RuntimeError, fn ->
        OdgnEcs.in_savepoint(w, "c", fn ->
          OdgnEcs.put(w, eid, "stats", %{"health" => 4}) && raise "x"
        end)
      end

      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 2}
    end
  end

  describe "a World on disk" do
    @describetag :tmp_dir

    test "reopens with its components and committed changes", %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      {:ok, w} = OdgnEcs.open(path)
      {:ok, w} = OdgnEcs.define(w, @stats)
      :ok = OdgnEcs.begin(w)
      eid = with_health(w, 7)
      :ok = OdgnEcs.commit(w)
      OdgnEcs.close(w)

      {:ok, w} = OdgnEcs.open(path)
      assert OdgnEcs.component(w, "stats") == @stats
      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 7}
    end

    test "loses changes that were never committed", %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      {:ok, w} = OdgnEcs.open(path)
      {:ok, w} = OdgnEcs.define(w, @stats)
      eid = with_health(w, 7)
      :ok = OdgnEcs.begin(w)
      :ok = OdgnEcs.put(w, eid, "stats", %{"health" => 8})
      OdgnEcs.close(w)

      {:ok, w} = OdgnEcs.open(path)
      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 7}
    end
  end
end
