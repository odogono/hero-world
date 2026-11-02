# Adapted from packages/ecs/src/edl/__test__: the execution cases of
# edl.test.ts, and world-edl, edl-script and lineage-persist.
defmodule OdgnEdl.BuildTest do
  use ExUnit.Case, async: true

  alias OdgnEdl.Error

  @defs """
  def thing {
    size: float
    weight: float
  }
  def link { target: eid }
  def portal {
    to: eid
    msg: string
  }
  def stats { items: array }
  """

  defp build(edl, opts \\ []) do
    {:ok, world} = OdgnEcs.open(":memory:")
    OdgnEdl.build(world, @defs <> edl, opts)
  end

  defp build!(edl, opts \\ []) do
    {:ok, world} = build(edl, opts)
    world
  end

  defp one(world, opts) do
    [eid] = OdgnEcs.query(world, opts)
    eid
  end

  test "makes an entity with its components" do
    world = build!("entity chest { thing { size: 10 weight: 20 } }")
    chest = one(world, with: ["thing"])

    assert OdgnEcs.get(world, chest, "thing") == %{"size" => 10.0, "weight" => 20.0}
  end

  test "defines components from def blocks, with their defaults" do
    {:ok, world} = OdgnEcs.open(":memory:")

    {:ok, world} =
      OdgnEdl.build(world, """
      def container {
        capacity: int default 10
        is_closed: boolean default false
        label: string default "a box"
      }
      entity box { container { is_closed: true } }
      """)

    box = one(world, with: ["container"])

    assert OdgnEcs.get(world, box, "container") == %{
             "capacity" => 10,
             "is_closed" => true,
             "label" => "a box"
           }
  end

  test "resolves $name to the entity's id" do
    world =
      build!("entity parent { thing { size: 1 } } entity child { link { target: $parent } }")

    parent = one(world, with: ["thing"])
    child = one(world, with: ["link"])

    assert OdgnEcs.get(world, child, "link") == %{"target" => parent}
  end

  test "supports forward references" do
    world =
      build!("entity child { link { target: $parent } } entity parent { thing { size: 1 } }")

    assert OdgnEcs.get(world, one(world, with: ["link"]), "link")["target"] ==
             one(world, with: ["thing"])
  end

  test "resolves $name.component.property, including inherited values and array indexes" do
    world =
      build!("""
      atom heavy { thing { weight: 20 } }
      entity parent: heavy { thing { size: 10 } stats { items: [10, 20, 30] } }
      entity a { thing { size: $parent.thing.size weight: $parent.thing.weight } }
      entity b { thing { size: $parent.stats.items.1 weight: 5 } }
      """)

    a = OdgnEdl.entity_named(world, "a")
    b = OdgnEdl.entity_named(world, "b")
    assert OdgnEcs.get(world, a, "thing") == %{"size" => 10.0, "weight" => 20.0}
    assert OdgnEcs.get(world, b, "thing") == %{"size" => 20.0, "weight" => 5.0}
  end

  test "an atom never becomes an entity" do
    world = build!("atom template { thing { size: 7 weight: 9 } } entity item: template {}")
    item = one(world, with: ["thing"])

    assert OdgnEcs.get(world, item, "thing") == %{"size" => 7.0, "weight" => 9.0}
    assert OdgnEcs.query(world) == [item]
  end

  test "atoms inherit from atoms, and the rightmost atom wins property by property" do
    world =
      build!("""
      atom base { thing { size: 10 weight: 20 } }
      atom child: base { thing { size: 15 } }
      atom other { thing { size: 1 weight: 2 } }
      atom big { thing { size: 99 } }
      entity chest: child {}
      entity combined: other big {}
      """)

    assert OdgnEcs.get(world, OdgnEdl.entity_named(world, "chest"), "thing") == %{
             "size" => 15.0,
             "weight" => 20.0
           }

    assert OdgnEcs.get(world, OdgnEdl.entity_named(world, "combined"), "thing") == %{
             "size" => 99.0,
             "weight" => 2.0
           }
  end

  test "an optional property may be left out" do
    world =
      build!("""
      entity room { thing { size: 10 } }
      entity door_one { portal { to: $room } }
      entity door_two { portal { msg: "The door is locked" } }
      """)

    room = OdgnEdl.entity_named(world, "room")

    assert OdgnEcs.get(world, OdgnEdl.entity_named(world, "door_one"), "portal") == %{
             "to" => room,
             "msg" => nil
           }

    assert OdgnEcs.get(world, OdgnEdl.entity_named(world, "door_two"), "portal") == %{
             "to" => nil,
             "msg" => "The door is locked"
           }
  end

  test "keeps Lineage for entities and atoms" do
    world =
      build!("""
      atom base { thing { size: 1 weight: 2 } }
      atom heavy: base { thing { weight: 50 } }
      atom big { thing { size: 99 } }
      entity rock: heavy big {}
      entity pebble { thing { size: 1 weight: 1 } }
      """)

    rock = OdgnEdl.entity_named(world, "rock")
    assert OdgnEcs.get(world, rock, "thing")["weight"] == 50.0
    assert OdgnEdl.entity_lineage(world, rock) == ["heavy", "big"]
    assert OdgnEdl.entity_lineage(world, OdgnEdl.entity_named(world, "pebble")) == []
    assert OdgnEdl.atom_lineage(world, "heavy") == ["base"]
    assert OdgnEdl.atom_lineage(world, "base") == []
    assert OdgnEdl.atom_lineage(world, "missing") == nil
  end

  test "keeps Definition names; anonymous entities have none" do
    world = build!("entity { thing { size: 1 } } entity named { thing { size: 2 } }")

    assert OdgnEcs.query(world) |> length() == 2
    assert OdgnEdl.definition_names(world) == %{"named" => OdgnEdl.entity_named(world, "named")}
  end

  describe "Script owners" do
    @scripts """
    def door { is_locked: boolean default false }
    def script { src: string not null }
    atom exit {}
    atom door: exit {
      door   { is_locked: true }
      script { src: "door.talk" }
    }
    entity front_door: door {}
    entity vault_door: door { script { src: "scripts/vault.talk" } }
    """

    test "are the atoms and entities that declare their own script, resolved against the EDL's path" do
      {:ok, world} = OdgnEcs.open(":memory:")
      {:ok, world} = OdgnEdl.build(world, @scripts, path: "/game/edl/main.edl")
      vault = OdgnEdl.entity_named(world, "vault_door")

      assert OdgnEdl.script_owners(world) == [
               %{kind: :atom, name: "door", src: "/game/edl/door.talk"},
               %{kind: :entity, eid: vault, src: "/game/edl/scripts/vault.talk"}
             ]
    end

    test "inheritors share the atom's script and keep the component" do
      {:ok, world} = OdgnEcs.open(":memory:")
      {:ok, world} = OdgnEdl.build(world, @scripts)

      srcs =
        for eid <- OdgnEcs.query(world, with: ["script"]),
            do: OdgnEcs.get(world, eid, "script")["src"]

      assert Enum.sort(srcs) == ["door.talk", "scripts/vault.talk"]

      assert Enum.map(OdgnEdl.script_owners(world), & &1.src) == [
               "door.talk",
               "scripts/vault.talk"
             ]
    end
  end

  describe "a failed Build" do
    test "rejects an unknown reference" do
      assert {:error, %Error{kind: :unknown_reference}} =
               build("entity child { link { target: $missing } }")
    end

    test "rejects a missing component or property in a reference path" do
      assert {:error, %Error{kind: :missing_property}} =
               build(
                 "entity p { thing { size: 1 } } entity c { thing { size: $p.thing.missing } }"
               )

      assert {:error, %Error{kind: :missing_component}} =
               build("entity p { thing { size: 1 } } entity c { thing { size: $p.link.target } }")
    end

    test "rejects extending an entity" do
      assert {:error, %Error{kind: :invalid_extend, message: message}} =
               build("entity base { thing { size: 3 } } entity child: base {}")

      assert message =~ "'child' cannot extend 'base': only atoms may be extended"

      assert {:error, %Error{kind: :invalid_extend}} = build("entity base {} atom child: base {}")
    end

    test "rejects an unknown atom" do
      assert {:error, %Error{kind: :unknown_atom}} = build("entity e: nowhere {}")
    end

    test "rejects circular references and inheritance" do
      assert {:error, %Error{kind: :circular, message: message}} =
               build(
                 "entity a { thing { size: $b.thing.size } } entity b { thing { size: $a.thing.size } }"
               )

      assert message =~ ~r/circular reference/i
      assert {:error, %Error{kind: :circular}} = build("atom a: b {} atom b: a {}")
    end

    test "rejects a reserved column and an unknown column type" do
      {:ok, world} = OdgnEcs.open(":memory:")

      assert {:error,
              %Error{kind: :ecs, message: "Component 'bad' cannot define reserved column 'id'."}} =
               OdgnEdl.build(world, "def bad { id: string }")

      assert {:error, %Error{kind: :invalid_definition}} =
               OdgnEdl.build(world, "def bad { x: wibble }")
    end

    test "rejects a value that doesn't fit its component" do
      assert {:error, %Error{kind: :ecs}} = build("entity e { thing { size: \"big\" } }")
      assert {:error, %Error{kind: :ecs}} = build("entity e { undefined { x: 1 } }")
    end

    test "rejects a name defined twice" do
      assert {:error, %Error{kind: :duplicate_name}} = build("atom a {} entity a {}")
    end

    test "leaves the World as it was" do
      {:ok, world} = OdgnEcs.open(":memory:")

      assert {:error, _} =
               OdgnEdl.build(
                 world,
                 @defs <> "entity ok { thing { size: 1 } } entity bad { link { target: $nope } }"
               )

      assert OdgnEcs.query(world) == []
      refute OdgnEdl.built?(world)
      assert {:ok, _} = OdgnEdl.build(world, @defs <> "entity ok { thing { size: 1 } }")
    end
  end

  test "records what the EDL set on each named entity, for a later Migration" do
    world = build!("atom heavy { thing { weight: 2 } } entity rock: heavy { thing { size: 1 } }")
    rock = OdgnEdl.entity_named(world, "rock")

    assert OdgnEdl.Record.edl_values(world, rock) == %{"thing" => ~s({"size":1.0,"weight":2.0})}
  end

  test "a World is built only once" do
    world = build!("entity a {}")
    assert {:error, %Error{kind: :already_built}} = OdgnEdl.build(world, @defs)
  end

  describe "a World on disk" do
    @describetag :tmp_dir

    @edl """
    def stats { hp: int }
    def script { src: string }
    atom thing { stats { hp: 10 } }
    atom person: thing { script { src: "person.talk" } }
    entity hero: person { stats { hp: 20 } }
    """

    test "is resumed, not rebuilt, with its Lineage and Script owners", %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      {:ok, world} = OdgnEcs.open(path)
      assert {:ok, world, :built} = OdgnEdl.load(world, @edl, path: Path.join(dir, "world.edl"))
      hero = OdgnEdl.entity_named(world, "hero")
      :ok = OdgnEcs.put(world, hero, "stats", %{"hp" => 3})
      OdgnEcs.close(world)

      {:ok, world} = OdgnEcs.open(path)
      assert {:ok, world, :resumed} = OdgnEdl.load(world, @edl)
      assert OdgnEcs.get(world, hero, "stats") == %{"hp" => 3}
      assert OdgnEcs.query(world) == [hero]
      assert OdgnEdl.entity_lineage(world, hero) == ["person"]
      assert OdgnEdl.atom_lineage(world, "person") == ["thing"]
      assert OdgnEdl.atom_lineage(world, "thing") == []

      assert OdgnEdl.script_owners(world) == [
               %{kind: :atom, name: "person", src: Path.join(dir, "person.talk")}
             ]
    end

    test "with a changed EDL needs a Migration", %{tmp_dir: dir} do
      path = Path.join(dir, "world.db")
      {:ok, world} = OdgnEcs.open(path)
      {:ok, world, :built} = OdgnEdl.load(world, @edl)
      OdgnEcs.close(world)

      {:ok, world} = OdgnEcs.open(path)

      assert {:error, %Error{kind: :migration_needed}} =
               OdgnEdl.load(world, @edl <> "entity extra {}")
    end
  end
end
