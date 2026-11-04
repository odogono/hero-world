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

    test "defining a component again with the same definition changes nothing" do
      w = world()
      assert {:ok, ^w} = OdgnEcs.define(w, @stats)
    end

    test "a definition keeps whether it is Play state" do
      {:ok, w} = OdgnEcs.open(":memory:")

      door = %Component{
        name: "door",
        play_state: true,
        columns: [%Column{name: "open", type: :boolean}]
      }

      {:ok, w} = OdgnEcs.define(w, door)

      assert OdgnEcs.component(w, "door").play_state

      {:ok, w} = OdgnEcs.define(w, %{door | play_state: false})
      refute OdgnEcs.component(w, "door").play_state
    end

    test "deleting an entity removes its components" do
      w = world()
      eid = with_health(w, 5)
      :ok = OdgnEcs.delete(w, eid)

      refute OdgnEcs.exists?(w, eid)
      assert OdgnEcs.get(w, eid, "stats") == nil
    end
  end

  describe "a changed definition" do
    defp with_stats do
      w = world([@stats])
      eid = with_health(w, 5)
      {w, eid}
    end

    defp redefine(w, columns), do: OdgnEcs.define(w, %{@stats | columns: columns})

    test "adds a column, giving existing rows its default" do
      {w, eid} = with_stats()

      {:ok, w} =
        redefine(w, [
          %Column{name: "health", type: :int},
          %Column{name: "mood", type: :string, optional: false, default: "calm"},
          %Column{name: "note", type: :string}
        ])

      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 5, "mood" => "calm", "note" => nil}
      assert {:ok, ^w} = OdgnEcs.define(w, OdgnEcs.component(w, "stats"))
    end

    test "removes a column, and changes a default" do
      {w, eid} = with_stats()

      {:ok, w} =
        redefine(w, [%Column{name: "health", type: :int}, %Column{name: "x", type: :int}])

      {:ok, w} = redefine(w, [%Column{name: "x", type: :int, default: 3}])

      assert OdgnEcs.get(w, eid, "stats") == %{"x" => nil}
      {:ok, other} = OdgnEcs.create(w)
      :ok = OdgnEcs.put(w, other, "stats", %{})
      assert OdgnEcs.get(w, other, "stats") == %{"x" => 3}
    end

    test "makes a column required with a default, filling the empty ones" do
      {w, eid} = with_stats()
      :ok = OdgnEcs.put(w, eid, "stats", %{"health" => nil})
      {:ok, w} = redefine(w, [%Column{name: "health", type: :int, optional: false, default: 1}])

      assert OdgnEcs.get(w, eid, "stats") == %{"health" => 1}
    end

    test "keeps the change when the World is opened again" do
      {w, _} = with_stats()

      {:ok, w} =
        redefine(w, [%Column{name: "health", type: :int}, %Column{name: "x", type: :int}])

      assert [_, "x"] = Enum.map(OdgnEcs.component(w, "stats").columns, & &1.name)
    end

    test "refuses changes the data can't follow" do
      {w, _} = with_stats()

      for {columns, reason} <- [
            {[%Column{name: "health", type: :float}], ~r/change type/},
            {[%Column{name: "health", type: :int, optional: false}],
             ~r/required with no default/},
            {[
               %Column{name: "health", type: :int},
               %Column{name: "y", type: :int, optional: false}
             ], ~r/required column 'y'/},
            {[%Column{name: "health", type: :int}, %Column{name: "y", type: :int, unique: true}],
             ~r/unique column 'y'/}
          ] do
        assert {:error, %Error{kind: :incompatible_change, message: message}} =
                 redefine(w, columns)

        assert message =~ reason
      end

      assert OdgnEcs.component(w, "stats") == @stats
    end
  end

  describe "unique and case_insensitive" do
    @named %Component{name: "named", columns: [%Column{name: "name", type: :string}]}

    defp named(w, names) do
      for n <- names do
        {:ok, eid} = OdgnEcs.create(w)
        :ok = OdgnEcs.put(w, eid, "named", %{"name" => n})
        eid
      end
    end

    defp unique_named(opts), do: %{@named | columns: [struct(hd(@named.columns), opts)]}

    test "a column becomes unique when its data allows, keeping its rows" do
      w = world([@named])
      [a, _b] = named(w, ["Bob", "bob"])

      assert {:ok, w} = OdgnEcs.define(w, unique_named(unique: true))
      assert OdgnEcs.query(w, where: [{"named", "name", "Bob"}]) == [a]

      assert {:error, %Error{kind: :constraint}} =
               OdgnEcs.put(w, elem(OdgnEcs.create(w), 1), "named", %{"name" => "Bob"})
    end

    test "a column held more than once can't become unique, and nothing changes" do
      w = world([@named])
      named(w, ["Bob", "bob"])

      assert {:error, %Error{kind: :incompatible_change, message: message}} =
               OdgnEcs.define(w, unique_named(unique: true, case_insensitive: true))

      assert message =~ "'name' has 1 value(s) held more than once"
      assert OdgnEcs.component(w, "named") == @named
      [json] = OdgnEcs.SQL.one!(w.conn, "SELECT columns FROM ecs_components WHERE name = 'named'")
      assert Component.from_json("named", json) == @named
    end

    test "a case-insensitive column matches and clashes ignoring case" do
      w = world([unique_named(unique: true, case_insensitive: true)])
      [bob] = named(w, ["Bob"])

      assert OdgnEcs.query(w, where: [{"named", "name", "BOB"}]) == [bob]
      assert OdgnEcs.query(w, where: [{"named", "name", :in, ["bob"]}]) == [bob]

      assert {:error, %Error{kind: :constraint}} =
               OdgnEcs.put(w, elem(OdgnEcs.create(w), 1), "named", %{"name" => "bOB"})
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

  describe "indexes" do
    defp indexes(w, table) do
      OdgnEcs.SQL.all!(
        w.conn,
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 AND sql IS NOT NULL ORDER BY name",
        [table]
      )
      |> List.flatten()
    end

    @placed %Component{
      name: "placed",
      columns: [
        %Column{name: "in", type: :eid},
        %Column{name: "at", type: :int, index: true},
        %Column{name: "note", type: :string}
      ]
    }

    test "Reference and indexed columns get an index" do
      w = world([@placed])
      assert indexes(w, "c_placed") == ["i_c_placed_at", "i_c_placed_in"]
    end

    test "a World made before a column was indexed gets the index when it is defined" do
      plain = %{@placed | columns: Enum.map(@placed.columns, &%{&1 | index: false})}
      w = world([plain])
      assert indexes(w, "c_placed") == ["i_c_placed_in"]

      {:ok, w} = OdgnEcs.define(w, @placed)
      assert indexes(w, "c_placed") == ["i_c_placed_at", "i_c_placed_in"]

      {:ok, w} = OdgnEcs.define(w, plain)
      assert indexes(w, "c_placed") == ["i_c_placed_in"]
    end

    test "an indexed column can be dropped" do
      w = world([@placed])
      {:ok, w} = OdgnEcs.define(w, %{@placed | columns: tl(@placed.columns)})
      assert indexes(w, "c_placed") == ["i_c_placed_at"]
    end
  end

  describe "References" do
    @located %Component{name: "located", columns: [%Column{name: "in", type: :eid}]}
    @noticed %Component{
      name: "noticed",
      columns: [%Column{name: "last", type: :eid, on_delete: :nullify}]
    }
    @owned %Component{
      name: "owned",
      columns: [%Column{name: "by", type: :eid, on_delete: :cascade, optional: false}]
    }

    defp refs_world, do: world([@located, @noticed, @owned])

    defp entity(w, components) do
      {:ok, eid} = OdgnEcs.create(w)
      for {name, data} <- components, do: :ok = OdgnEcs.put(w, eid, name, data)
      eid
    end

    test "must refer to an entity that exists" do
      w = refs_world()

      assert {:error, %Error{kind: :constraint}} =
               OdgnEcs.put(w, entity(w, []), "located", %{"in" => 999})
    end

    test ":restrict refuses to delete a referenced entity, saying what refers to it" do
      w = refs_world()
      room = entity(w, [])
      lamp = entity(w, [{"located", %{"in" => room}}])

      assert {:error, %Error{kind: :referenced, message: message}} = OdgnEcs.delete(w, room)
      assert message =~ "located.in of #{lamp} refers to it"
      assert OdgnEcs.exists?(w, room)

      :ok = OdgnEcs.remove(w, lamp, "located")
      assert :ok = OdgnEcs.delete(w, room)
    end

    test ":nullify empties the Reference" do
      w = refs_world()
      lamp = entity(w, [])
      player = entity(w, [{"noticed", %{"last" => lamp}}])

      :ok = OdgnEcs.delete(w, lamp)
      assert OdgnEcs.get(w, player, "noticed") == %{"last" => nil}
    end

    test ":cascade deletes the entity holding the Reference, and so on down" do
      w = refs_world()
      npc = entity(w, [])
      timer = entity(w, [{"owned", %{"by" => npc}}])
      sub = entity(w, [{"owned", %{"by" => timer}}])
      other = entity(w, [{"owned", %{"by" => entity(w, [])}}])

      :ok = OdgnEcs.delete(w, npc)
      refute Enum.any?([npc, timer, sub], &OdgnEcs.exists?(w, &1))
      assert OdgnEcs.exists?(w, other)
    end

    test "a cascade stops at a :restrict Reference, and changes nothing" do
      w = refs_world()
      npc = entity(w, [])
      timer = entity(w, [{"owned", %{"by" => npc}}])
      _thing = entity(w, [{"located", %{"in" => timer}}])

      assert {:error, %Error{kind: :referenced}} = OdgnEcs.delete(w, npc)
      assert OdgnEcs.exists?(w, npc) and OdgnEcs.exists?(w, timer)
    end

    # A table as odgn_ecs made it before References had keys
    defp unkeyed(w, component) do
      table = OdgnEcs.SQL.ident(Component.table(component))

      OdgnEcs.SQL.exec!(
        w.conn,
        "CREATE TABLE plain AS SELECT * FROM #{table}; DROP TABLE #{table}; " <>
          "CREATE TABLE #{table} (eid INTEGER PRIMARY KEY REFERENCES entities(eid) ON DELETE CASCADE, \"in\" INTEGER); " <>
          "INSERT INTO #{table} SELECT * FROM plain; DROP TABLE plain"
      )
    end

    test "a table made before References had keys is rebuilt with them, keeping its rows" do
      w = refs_world()
      room = entity(w, [])
      lamp = entity(w, [{"located", %{"in" => room}}])
      unkeyed(w, @located)
      assert :ok = OdgnEcs.delete(w, entity(w, []))

      assert {:ok, w} = OdgnEcs.define(w, @located)
      assert OdgnEcs.get(w, lamp, "located") == %{"in" => room}
      assert OdgnEcs.query(w, where: [{"located", "in", room}]) == [lamp]
      assert {:error, %Error{kind: :referenced}} = OdgnEcs.delete(w, room)
    end

    test "a table with a dangling Reference isn't rebuilt" do
      w = refs_world()
      lamp = entity(w, [])
      unkeyed(w, @located)
      OdgnEcs.SQL.exec!(w.conn, ~s|INSERT INTO "c_located" VALUES (#{lamp}, 999)|)

      assert {:error, %Error{kind: :dangling_reference, message: message}} =
               OdgnEcs.define(w, @located)

      assert message =~ "1 in 'in'"
      assert OdgnEcs.get(w, lamp, "located") == %{"in" => 999}
    end

    test "changing on_delete rebuilds the table" do
      w = refs_world()
      room = entity(w, [])
      lamp = entity(w, [{"located", %{"in" => room}}])
      [col] = @located.columns
      {:ok, w} = OdgnEcs.define(w, %{@located | columns: [%{col | on_delete: :nullify}]})

      :ok = OdgnEcs.delete(w, room)
      assert OdgnEcs.get(w, lamp, "located") == %{"in" => nil}
    end
  end

  describe "select" do
    test "reads every component of an entity in one go" do
      w = world()
      eid = with_health(w, 3)
      :ok = OdgnEcs.put(w, eid, "thing", %{"label" => "x"})

      assert OdgnEcs.components(w, eid) == %{
               "stats" => %{"health" => 3},
               "thing" => %{
                 "label" => "x",
                 "size" => 1.0,
                 "open" => false,
                 "tags" => nil,
                 "props" => nil
               }
             }

      {:ok, empty} = OdgnEcs.create(w)
      assert OdgnEcs.components(w, empty) == %{}
      assert OdgnEcs.components(w, 999) == %{}
    end

    test "reads more components than SQLite can join at once" do
      defs =
        for i <- 1..70, do: %Component{name: "c#{i}", columns: [%Column{name: "n", type: :int}]}

      w = world(defs)
      {:ok, a} = OdgnEcs.create(w)
      {:ok, b} = OdgnEcs.create(w)
      for i <- 1..70, do: :ok = OdgnEcs.put(w, a, "c#{i}", %{"n" => i})
      :ok = OdgnEcs.put(w, b, "c70", %{"n" => 0})

      assert [{^a, data_a}, {^b, data_b}] = OdgnEcs.select(w, Enum.map(1..70, &"c#{&1}"))
      assert map_size(data_a) == 70 and data_a["c64"] == %{"n" => 64}
      assert data_b == %{"c70" => %{"n" => 0}}
    end

    test "an unknown property or condition is an error" do
      w = world()
      assert_raise ArgumentError, fn -> OdgnEcs.query(w, where: [{"stats", "nope", 1}]) end

      assert_raise ArgumentError, fn ->
        OdgnEcs.query(w, where: [{"stats", "health", :like, 1}])
      end

      assert_raise ArgumentError, fn -> OdgnEcs.query(w, order_by: {"stats", "nope"}) end
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
