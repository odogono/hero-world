# Adapted from packages/ecs/src/edl/__test__/migrate.test.ts, including the
# live-edit cases of #90.
defmodule OdgnEdl.MigrateTest do
  use ExUnit.Case, async: true

  alias OdgnEcs.{Column, Component}
  alias OdgnEdl.{Error, Plan}

  @defs [
    %Component{
      name: "described",
      columns: [%Column{name: "description", type: :string}, %Column{name: "name", type: :string}]
    },
    %Component{name: "exits", columns: [%Column{name: "to", type: :json}]},
    %Component{name: "readable", columns: [%Column{name: "text", type: :string}]},
    %Component{
      name: "door",
      play_state: true,
      columns: [%Column{name: "is_open", type: :boolean, default: false}]
    },
    %Component{name: "location", play_state: true, columns: [%Column{name: "in", type: :eid}]},
    %Component{name: "script", columns: [%Column{name: "src", type: :string}]}
  ]

  @original """
  atom room { described { name: "Room" } }
  atom portal {}

  entity hall : room {
    described { name: "Hall" }
    exits { to: { north: $yard } }
  }
  entity yard : room { described { name: "Yard" } }
  entity gate : portal {
    described { name: "Gate" }
    door { is_open: false }
    location { in: $hall }
  }
  entity sign {
    described { name: "Sign" }
    readable { text: "Keep out" }
    location { in: $yard }
  }
  entity old_bench { described { name: "Bench" } }
  """

  # a garden is added north of the yard, the hall is renamed, the sign loses
  # its text, the gate gets a new base and moves, and the bench is gone
  @changed """
  atom room { described { name: "Room" } }
  atom portal {}
  atom heavy {}

  entity hall : room {
    described { name: "Great hall" }
    exits { to: { north: $yard } }
  }
  entity yard : room {
    described { name: "Yard" }
    exits { to: { north: $garden } }
  }
  entity gate : portal heavy {
    described { name: "Gate" }
    door { is_open: false }
    location { in: $yard }
  }
  entity sign {
    described { name: "Sign" }
    location { in: $yard }
  }
  entity garden : room {
    described { name: "Garden" }
    exits { to: { south: $yard } }
  }
  """

  defp open(path \\ ":memory:") do
    {:ok, world} = OdgnEcs.open(path)
    Enum.reduce(@defs, world, fn c, w -> elem(OdgnEcs.define(w, c), 1) end)
  end

  defp built(edl, path \\ ":memory:") do
    {:ok, world} = OdgnEdl.build(open(path), edl)
    world
  end

  defp id(world, name), do: OdgnEdl.entity_named(world, name)
  defp get(world, name, component), do: OdgnEcs.get(world, id(world, name), component)

  defp migrate!(world, edl, opts \\ []) do
    {:ok, world, plan} = OdgnEdl.migrate(world, edl, opts)
    {world, plan}
  end

  # A World built from @original, then played: the gate opened, a player made
  defp played(path \\ ":memory:") do
    world = built(@original, path)
    :ok = OdgnEcs.put(world, id(world, "gate"), "door", %{"is_open" => true})
    {:ok, player} = OdgnEcs.create(world)
    :ok = OdgnEcs.put(world, player, "described", %{"name" => "Pat"})
    :ok = OdgnEcs.put(world, player, "location", %{"in" => id(world, "hall")})
    {world, player}
  end

  defp by_name(plan), do: Map.new(plan.updated, &{&1.name, &1})

  test "records Definition names and the EDL's hash when it first runs" do
    {world, _} = played()

    assert world |> OdgnEdl.definition_names() |> Map.keys() |> Enum.sort() ==
             ~w(gate hall old_bench sign yard)

    refute OdgnEdl.changed?(world, @original)
    assert OdgnEdl.changed?(world, @changed)
  end

  test "plans the changes on a dry run without making them" do
    {world, _} = played()
    count = length(OdgnEcs.query(world))

    {^world, plan} = migrate!(world, @changed, dry_run: true)

    assert plan.created == ["garden"]
    assert Enum.map(plan.gone, & &1.name) == ["old_bench"]
    assert plan.atoms.added == ["heavy"]
    updated = by_name(plan)
    assert updated["hall"].changed == ["described"]
    assert updated["yard"].added == ["exits"]
    assert updated["sign"].removed == ["readable"]
    assert updated["gate"].lineage == %{from: ["portal"], to: ["portal", "heavy"]}
    # the gate never moved in play, so the EDL moves it; play opened it, so
    # its door is kept and reported
    assert updated["gate"].changed == ["location"]
    assert plan.kept == [%{components: ["door"], eid: id(world, "gate"), name: "gate"}]

    assert length(OdgnEcs.query(world)) == count
    assert get(world, "hall", "described")["name"] == "Hall"
    assert OdgnEdl.changed?(world, @changed)
  end

  test "drops a field the EDL no longer gives" do
    world = built(~s(entity hall { described { name: "Hall" description: "Big" } }))
    {world, _} = migrate!(world, ~s(entity hall { described { name: "Great hall" } }))

    assert get(world, "hall", "described") == %{"name" => "Great hall", "description" => nil}
  end

  test "brings the World up to date and keeps players and Play state" do
    {world, player} = played()

    {world, _} = migrate!(world, @changed)

    garden = id(world, "garden")
    yard = id(world, "yard")
    assert get(world, "garden", "described")["name"] == "Garden"
    assert get(world, "garden", "exits") == %{"to" => %{"south" => yard}}
    assert get(world, "yard", "exits") == %{"to" => %{"north" => garden}}
    assert get(world, "hall", "described")["name"] == "Great hall"
    assert get(world, "sign", "readable") == nil

    # the gate keeps what play did to it, and goes where the EDL now says
    assert get(world, "gate", "door") == %{"is_open" => true}
    assert get(world, "gate", "location") == %{"in" => yard}
    assert OdgnEdl.entity_lineage(world, id(world, "gate")) == ["portal", "heavy"]
    assert OdgnEdl.atom_lineage(world, "heavy") == []

    # the bench is only reported; the player is untouched
    assert get(world, "old_bench", "described")["name"] == "Bench"
    assert OdgnEcs.get(world, player, "described") == %{"name" => "Pat", "description" => nil}

    refute OdgnEdl.changed?(world, @changed)
    assert {_, %Plan{updated: []}} = migrate!(world, @changed)
  end

  describe "Play state" do
    defp moved(room) do
      """
      entity hall { described { name: "Hall" } }
      entity yard { described { name: "Yard" } }
      entity lamp { described { name: "Lamp" } location { in: $#{room} } }
      entity key { described { name: "Key" } location { in: $#{room} } }
      """
    end

    test "is set where play never changed it, and kept where it did (#77)" do
      world = built(moved("hall"))
      # a player carries the key off to the yard
      :ok = OdgnEcs.put(world, id(world, "key"), "location", %{"in" => id(world, "yard")})

      # both now start in the yard
      {world, plan} = migrate!(world, moved("yard"))
      assert Enum.map(plan.updated, &{&1.name, &1.changed}) == [{"lamp", ["location"]}]
      assert plan.kept == []
      assert get(world, "lamp", "location")["in"] == id(world, "yard")

      # the key now matches the EDL, so it moves with the next edit
      {world, again} = migrate!(world, moved("hall"))
      assert again.updated |> Enum.map(& &1.name) |> Enum.sort() == ["key", "lamp"]
      assert get(world, "key", "location")["in"] == id(world, "hall")
    end

    test "is kept when the World never saved what the EDL set" do
      {world, _} = played()
      OdgnEcs.SQL.exec!(world.conn, "DELETE FROM edl_value")

      {_, plan} = migrate!(world, @changed, dry_run: true)

      # static components still take the EDL's value
      assert by_name(plan)["hall"].changed == ["described"]
      assert by_name(plan)["gate"].changed == []

      assert plan.kept == [
               %{components: ["door", "location"], eid: id(world, "gate"), name: "gate"}
             ]
    end
  end

  test "renames an entity the EDL says it was, keeping it and its state (#78)" do
    {world, _} = played()
    gate = id(world, "gate")

    renamed =
      String.replace(@original, "entity gate : portal", "entity yard_gate was gate : portal")

    {world, dry} = migrate!(world, renamed, dry_run: true)
    assert dry.renamed == [%{eid: gate, from: "gate", to: "yard_gate"}]
    assert dry.created == []
    assert dry.gone == []
    assert id(world, "gate") == gate

    {world, _} = migrate!(world, renamed)
    assert id(world, "gate") == nil
    assert id(world, "yard_gate") == gate
    assert get(world, "yard_gate", "door") == %{"is_open" => true}

    # once migrated, the marker changes nothing and can be dropped
    {world, plan} = migrate!(world, String.replace(renamed, " was gate", ""))
    assert plan.renamed == []
    assert id(world, "yard_gate") == gate
  end

  test "refuses a rename from a name the EDL still defines" do
    {world, _} = played()

    assert {:error, %Error{kind: :invalid_rename, message: message}} =
             OdgnEdl.migrate(world, @original <> "\nentity yard_gate was gate {}\n",
               dry_run: true
             )

    assert message =~ "'yard_gate' was 'gate'"
  end

  test "takes entities gone from the EDL out of play with prune" do
    {world, _} = played()
    bench = id(world, "old_bench")
    test = self()

    {world, plan} = migrate!(world, @changed, prune: &send(test, {:pruned, &1}))

    assert_received {:pruned, ^bench}
    assert plan.pruned
    assert id(world, "old_bench") == nil
    assert OdgnEcs.exists?(world, bench)
  end

  test "doesn't bring back an entity deleted in play" do
    {world, _} = played()
    :ok = OdgnEcs.delete(world, id(world, "sign"))

    {_, plan} = migrate!(world, @changed)

    assert Enum.map(plan.missing, & &1.name) == ["sign"]
    assert plan.created == ["garden"]
  end

  test "a failed :finish rolls the Migration back" do
    {world, _} = played()

    assert {:error, %Error{kind: :check_failed, message: "no"}} =
             OdgnEdl.migrate(world, @changed, finish: fn _, _ -> {:error, "no"} end)

    assert id(world, "garden") == nil
    assert OdgnEdl.changed?(world, @changed)
  end

  test "changes a component definition compatibly, and refuses one the data can't follow" do
    world = built("def mark {\n  a: int\n}\nentity m { mark { a: 1 } }")

    {world, _} =
      migrate!(world, "def mark {\n  a: int\n  b: int default 7\n}\nentity m { mark { a: 1 } }")

    assert get(world, "m", "mark") == %{"a" => 1, "b" => 7}

    assert {:error, %Error{kind: :ecs, message: message}} =
             OdgnEdl.migrate(world, "def mark {\n  a: string\n}\nentity m {}")

    assert message =~ "change type"
  end

  @tag :tmp_dir
  test "migrates a World reopened from its file", %{tmp_dir: dir} do
    path = Path.join(dir, "world.db")
    {world, _} = played(path)
    OdgnEcs.close(world)

    world = open(path)
    assert OdgnEdl.changed?(world, @changed)
    {world, _} = migrate!(world, @changed)
    OdgnEcs.close(world)

    world = open(path)
    assert get(world, "garden", "described")["name"] == "Garden"
    assert get(world, "gate", "door") == %{"is_open" => true}
    refute OdgnEdl.changed?(world, @changed)
    assert {:ok, _, :resumed} = OdgnEdl.load(world, @changed)
  end

  describe "a Build is a Migration from an empty World" do
    test "plans nothing when migrating to the EDL it was built from" do
      world = built(@original)
      {_, plan} = migrate!(world, @original)

      assert plan == %Plan{}
    end

    # What a World records and holds for each entity the EDL names, with
    # the ids it refers to replaced by Definition names
    defp snapshot(world, names) do
      name_of = world |> OdgnEdl.definition_names() |> Map.new(fn {n, e} -> {e, n} end)

      swap = fn
        f, map when is_map(map) -> Map.new(map, fn {k, v} -> {k, f.(f, v)} end)
        _, v when is_integer(v) -> Map.get(name_of, v, v)
        _, v -> v
      end

      %{
        atoms: Enum.map(~w(room portal heavy), &OdgnEdl.atom_lineage(world, &1)),
        entities:
          for name <- names do
            eid = id(world, name)

            %{
              name: name,
              components: swap.(swap, OdgnEcs.components(world, eid)),
              values:
                OdgnEdl.Record.edl_values(world, eid)
                |> Map.new(fn {c, v} -> {c, swap.(swap, JSON.decode!(v))} end),
              lineage: OdgnEdl.entity_lineage(world, eid)
            }
          end
      }
    end

    test "leaves an unplayed World as building the new EDL would" do
      {migrated, _} = migrate!(built(@original), @changed)
      names = ~w(hall yard gate sign garden)

      assert snapshot(migrated, names) == snapshot(built(@changed), names)
    end
  end

  describe "a Migration keeps components edited live (#90)" do
    defp hall_as(name) do
      ~s(entity hall { described { name: "#{name}" } }\nentity yard { described { name: "Yard" } })
    end

    # A World built with the hall named "Hall", then the hall renamed live
    defp edited_live do
      world = built(hall_as("Hall"))
      :ok = OdgnEcs.put(world, id(world, "hall"), "described", %{"name" => "Entrance"})
      world
    end

    test "records the EDL value of every component, static and Play state" do
      world = built(@original)

      assert world |> OdgnEdl.Record.edl_values(id(world, "gate")) |> Map.keys() |> Enum.sort() ==
               ~w(described door location)
    end

    test "keeps a static component changed after Build, and lists it in kept" do
      world = edited_live()
      {world, plan} = migrate!(world, hall_as("Great hall"))

      assert get(world, "hall", "described")["name"] == "Entrance"
      assert plan.kept == [%{components: ["described"], eid: id(world, "hall"), name: "hall"}]
      assert plan.updated == []
    end

    test "sets a static component left alone to the EDL's new value" do
      world = edited_live()

      {world, plan} =
        migrate!(world, String.replace(hall_as("Great hall"), "\"Yard\"", "\"Courtyard\""))

      assert get(world, "yard", "described")["name"] == "Courtyard"
      assert Enum.map(plan.updated, &{&1.name, &1.changed}) == [{"yard", ["described"]}]
    end

    test "keeps a live edit through later Migrations until it matches the EDL" do
      world = edited_live()
      {world, _} = migrate!(world, hall_as("Great hall"))

      {world, plan} = migrate!(world, hall_as("Grand hall"))
      assert length(plan.kept) == 1
      assert get(world, "hall", "described")["name"] == "Entrance"

      # the EDL adopts the edit, so the hall follows the EDL again
      {world, plan} = migrate!(world, hall_as("Entrance"))
      assert plan.kept == []
      {world, _} = migrate!(world, hall_as("Front hall"))
      assert get(world, "hall", "described")["name"] == "Front hall"
    end

    test "removes a static component the EDL stops setting, but not Play state" do
      world = built(@original)

      edl =
        @original
        |> String.replace(~s(readable { text: "Keep out" }), "")
        |> String.replace("location { in: $yard }", "")

      {world, plan} = migrate!(world, edl)

      assert get(world, "sign", "readable") == nil
      assert get(world, "sign", "location")["in"] == id(world, "yard")
      assert Enum.map(plan.updated, &{&1.name, &1.removed}) == [{"sign", ["readable"]}]
    end
  end
end
