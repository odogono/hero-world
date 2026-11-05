defmodule OdgnEdl.IncludeTest do
  use ExUnit.Case, async: true

  alias OdgnEdl.{Entity, Error, Include}

  setup do
    dir = Path.join(System.tmp_dir!(), "odgn_edl_include_#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(dir, "base/scripts"))
    on_exit(fn -> File.rm_rf!(dir) end)
    {:ok, dir: dir}
  end

  defp write(dir, name, source) do
    path = Path.join(dir, name)
    File.write!(path, source)
    path
  end

  defp names(definitions), do: for(%Entity{name: n} <- definitions, do: n)

  test "parses an include line" do
    assert {:ok, [%Include{path: "lib:a.edl"}, %Entity{name: "b"}]} =
             OdgnEdl.parse(~s(include "lib:a.edl"\nentity b { m { v: 1 } }))
  end

  test "reads a named root and a relative path in place, each once", %{dir: dir} do
    write(dir, "base/base.edl", ~s(include "more.edl"\nentity base_a { m { v: 1 } }))
    write(dir, "base/more.edl", ~s(include "base.edl"\nentity base_b { m { v: 2 } }))
    main = ~s(include "lib:base.edl"\ninclude "lib:base.edl"\nentity mine { m { v: 3 } })
    path = write(dir, "main.edl", main)

    assert {:ok, definitions, source} =
             OdgnEdl.read(main, path: path, roots: %{"lib" => Path.join(dir, "base")})

    assert names(definitions) == ["base_b", "base_a", "mine"]
    assert String.starts_with?(source, main)
    assert source =~ "base_a" and source =~ "base_b"
  end

  test "an EDL without includes keeps its own source" do
    assert {:ok, _, "entity a { m { v: 1 } }"} = OdgnEdl.read("entity a { m { v: 1 } }")
  end

  test "an included script resolves against the included file", %{dir: dir} do
    write(dir, "base/base.edl", ~s(atom room { script { src: "scripts/room.talk" } }))

    assert {:ok, [atom], _} =
             OdgnEdl.read(~s(include "lib:base.edl"), roots: %{"lib" => Path.join(dir, "base")})

    assert atom.components["script"]["src"] == Path.join(dir, "base/scripts/room.talk")
  end

  test "names an unknown root, a missing file and a relative include with no path", %{dir: dir} do
    assert {:error, %Error{kind: :include, message: msg}} = OdgnEdl.read(~s(include "nope:x.edl"))
    assert msg =~ "no root named 'nope'"

    assert {:error, %Error{kind: :include}} =
             OdgnEdl.read(~s(include "gone.edl"), path: Path.join(dir, "main.edl"))

    assert {:error, %Error{kind: :include, message: msg}} = OdgnEdl.read(~s(include "x.edl"))
    assert msg =~ ":path"
  end

  test "an entity the base already declares fails the build", %{dir: dir} do
    write(dir, "base/base.edl", ~s(def m { v: int }\nentity verbs_here { m { v: 1 } }))
    {:ok, world} = OdgnEcs.open(":memory:")

    assert {:error, %Error{kind: :duplicate_name}} =
             OdgnEdl.build(world, ~s(include "lib:base.edl"\nentity verbs_here { m { v: 2 } }),
               roots: %{"lib" => Path.join(dir, "base")}
             )
  end

  test "a changed included file means the World needs a Migration", %{dir: dir} do
    base = write(dir, "base/base.edl", ~s(entity a { m { v: 1 } }))
    opts = [roots: %{"lib" => Path.join(dir, "base")}]
    main = ~s(def m { v: int }\ninclude "lib:base.edl")
    {:ok, world} = OdgnEcs.open(":memory:")

    assert {:ok, world, :built} = OdgnEdl.load(world, main, opts)
    assert {:ok, world, :resumed} = OdgnEdl.load(world, main, opts)
    refute OdgnEdl.changed?(world, main, opts)

    File.write!(base, ~s(entity a { m { v: 2 } }))
    assert OdgnEdl.changed?(world, main, opts)
    assert {:error, %Error{kind: :migration_needed}} = OdgnEdl.load(world, main, opts)
    assert {:ok, _world, _plan} = OdgnEdl.migrate(world, main, opts)
  end
end
