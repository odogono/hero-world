# Adapted from packages/ecs/src/edl/__test__/edl.test.ts and
# edl-component-def.test.ts (the parsing cases).
defmodule OdgnEdl.ParseTest do
  use ExUnit.Case, async: true

  alias OdgnEdl.{Atom, Column, ComponentDef, Entity, Error, Ref}

  defp parse!(edl) do
    {:ok, nodes} = OdgnEdl.parse(edl)
    nodes
  end

  test "parses a single-line atom" do
    edl = ~s(atom chest { described { name: "Chest" description: "A simple wooden chest." } })

    assert parse!(edl) == [
             %Atom{
               name: "chest",
               components: %{
                 "described" => %{"name" => "Chest", "description" => "A simple wooden chest."}
               }
             }
           ]
  end

  test "reads object and array values with or without commas" do
    props = %{"to" => 1, "one_way" => true, "tags" => ["x", "y"]}

    for edl <- [
          ~s(atom a { meta { props: { to: 1, one_way: true, tags: ["x", "y"] } } }),
          ~s(atom a {\n meta { props: { to: 1 one_way: true tags: ["x" "y"] } }\n}),
          ~s(atom a { meta { props: { to: 1, one_way: true, tags: ["x", "y",], } } })
        ] do
      assert parse!(edl) == [%Atom{name: "a", components: %{"meta" => %{"props" => props}}}]
    end
  end

  test "parses empty objects and arrays" do
    assert [%Atom{components: %{"m" => %{"o" => %{}, "a" => []}}}] =
             parse!("atom a { m { o: {} a: [] } }")
  end

  test "parses an anonymous entity" do
    assert parse!("entity {}") == [%Entity{name: nil, components: %{}}]
  end

  test "parses quoted names" do
    edl = ~s(atom "mysterious thing" {} entity "unknown thing" : "mysterious thing" {})

    assert parse!(edl) == [
             %Atom{name: "mysterious thing"},
             %Entity{name: "unknown thing", extends: ["mysterious thing"]}
           ]
  end

  test "parses string escapes in both quote styles" do
    edl = ~S(atom a { s { d: "say \"hi\"\n" q: 'it\'s' } })
    assert [%Atom{components: %{"s" => %{"d" => "say \"hi\"\n", "q" => "it's"}}}] = parse!(edl)
  end

  test "parses scalar values" do
    edl = "atom a { v { t: true f: false n: null i: -3 x: 2.5 } }"

    assert [%Atom{components: %{"v" => v}}] = parse!(edl)
    assert v == %{"t" => true, "f" => false, "n" => nil, "i" => -3, "x" => 2.5}
  end

  test "parses entity references with paths" do
    edl = """
    entity parent { thing { size: 10 weight: 20 } }
    entity child {
      link { target: $parent size: $parent.thing.size item: $parent.stats.items.1 }
    }
    """

    assert [_, %Entity{components: %{"link" => link}}] = parse!(edl)

    assert link == %{
             "target" => %Ref{name: "parent", path: []},
             "size" => %Ref{name: "parent", path: ["thing", "size"]},
             "item" => %Ref{name: "parent", path: ["stats", "items", 1]}
           }
  end

  test "parses an atom inheriting from an atom" do
    edl = """
    # atoms are templates; entities are instantiated
    atom chest {
      container { capacity: 50 is_closed: false }
    }
    entity lockable_chest: chest {
      lockable { is_locked: false key: "brass_key" }
      container { is_closed: true }
    }
    """

    assert parse!(edl) == [
             %Atom{
               name: "chest",
               components: %{"container" => %{"capacity" => 50, "is_closed" => false}}
             },
             %Entity{
               name: "lockable_chest",
               extends: ["chest"],
               components: %{
                 "lockable" => %{"is_locked" => false, "key" => "brass_key"},
                 "container" => %{"is_closed" => true}
               }
             }
           ]
  end

  test "parses multiple inheritance across lines" do
    edl = """
    atom chest_described {}
    atom chest_thing {}
    entity chest:
      chest_described
      chest_thing
      {}
    """

    assert [_, _, %Entity{extends: ["chest_described", "chest_thing"]}] = parse!(edl)
  end

  test "parses the name an entity had before a rename" do
    assert parse!("entity garden_door was shed_door : door {}") == [
             %Entity{name: "garden_door", was: "shed_door", extends: ["door"]}
           ]
  end

  test "parses a component definition" do
    edl = """
    def user {
      name: string null
      email: email not null is_unique
      age: int default 0
      height: float default 0.0
      linked: eid
      is_active: boolean default true
      created_at: datetime default current_timestamp
    }
    """

    assert parse!(edl) == [
             %ComponentDef{
               name: "user",
               columns: [
                 %Column{name: "name", type: "string"},
                 %Column{name: "email", type: "email", optional: false, unique: true},
                 %Column{name: "age", type: "int", default: "0"},
                 %Column{name: "height", type: "float", default: "0.0"},
                 %Column{name: "linked", type: "eid"},
                 %Column{name: "is_active", type: "boolean", default: "true"},
                 %Column{name: "created_at", type: "datetime", default: "current_timestamp"}
               ]
             }
           ]
  end

  test "keeps default strings with quotes and spaces, dropping inline comments" do
    edl = """
    def sample {
      note: string default "hello world" # inline comment
      tag: string default "a # b"
      flag: string default true
    }
    """

    assert [%ComponentDef{columns: columns}] = parse!(edl)

    assert columns == [
             %Column{name: "note", type: "string", default: ~s("hello world")},
             %Column{name: "tag", type: "string", default: ~s("a # b")},
             %Column{name: "flag", type: "string", default: "true"}
           ]
  end

  test "parses JSON defaults and values" do
    edl = """
    def user {
      props: json default { "name": "John", "age": 30 }
      list: json default [1, 2]
    }
    entity anon {
      user { props: { name: "Jane", age: 25, favs: [1, 2, 3] } }
    }
    """

    assert parse!(edl) == [
             %ComponentDef{
               name: "user",
               columns: [
                 %Column{name: "props", type: "json", default: %{"name" => "John", "age" => 30}},
                 %Column{name: "list", type: "json", default: [1, 2]}
               ]
             },
             %Entity{
               name: "anon",
               components: %{
                 "user" => %{"props" => %{"name" => "Jane", "age" => 25, "favs" => [1, 2, 3]}}
               }
             }
           ]
  end

  test "parses definitions of every kind mixed together" do
    edl = """
    # component first
    def user { name: string null }
    atom chest { described { name: "Chest" } }
    entity item: chest {}
    """

    assert [%ComponentDef{name: "user"}, %Atom{name: "chest"}, %Entity{extends: ["chest"]}] =
             parse!(edl)
  end

  test "rejects a command line, naming it" do
    edl = """
    entity chest {
      thing { size: 10 }
    }
    !set $chest.thing.size 30
    """

    assert {:error, %Error{line: 4} = error} = OdgnEdl.parse(edl)

    assert Exception.message(error) =~
             ~r/line 4.*!set \$chest\.thing\.size 30.*write the value inline/s
  end

  test "reports where a syntax error is" do
    edl = """
    atom ok {}

    atom broken { thing { size: } }
    """

    assert {:error, %Error{kind: :syntax, line: 3}} = OdgnEdl.parse(edl)
  end

  test "parse!/1 raises the error" do
    assert_raise Error, fn -> OdgnEdl.parse!("atom {") end
  end
end
