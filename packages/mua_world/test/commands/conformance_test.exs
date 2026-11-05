# Runs the shared, language-neutral command cases in spec/mua/commands
# (ADR 0024): what a typed line reads as, before any Action runs.
defmodule MuaWorld.Commands.ConformanceTest do
  use ExUnit.Case, async: true

  alias MuaWorld.{Exits, Input}
  alias MuaWorld.Commands.Verbs

  @spec_dir Path.expand("../../../../spec/mua/commands", __DIR__)

  for file <- Path.wildcard(Path.join(@spec_dir, "*.json")) do
    @external_resource file
    spec = file |> File.read!() |> JSON.decode!()

    describe Path.relative_to(file, @spec_dir) do
      for c <- spec["cases"] do
        test c["name"] do
          run_case(unquote(Macro.escape(spec)), unquote(Macro.escape(c)))
        end
      end
    end
  end

  defp run_case(spec, c) do
    world = build(Path.join(@spec_dir, spec["edl"]))
    vocabulary = Verbs.from_world(world)
    actor = OdgnEdl.entity_named(world, spec["actor"])
    names = for {name, eid} <- OdgnEdl.definition_names(world), into: %{}, do: {eid, name}

    result =
      c["input"]
      |> List.wrap()
      |> Enum.reduce(nil, fn line, _ ->
        {result, changes} = Input.read(world, vocabulary, actor, line)
        player = OdgnEcs.get(world, actor, "player")
        :ok = OdgnEcs.put(world, actor, "player", Map.merge(player, changes))
        result
      end)

    assert actual(result, names) == c["expect"]
  end

  defp actual({:reply, message}, _names), do: %{"reply" => message}

  defp actual({:commands, commands}, names) do
    %{
      "commands" =>
        for command <- commands do
          %{
            "verb" => command.verb,
            "target" => names[command[:target_id]],
            "indirect" => names[command[:indirect_id]],
            "direction" => command[:direction],
            "text" => command[:text]
          }
          |> Map.reject(fn {_, v} -> v == nil end)
        end
    }
  end

  defp build(path) do
    {:ok, world} = OdgnEcs.open(":memory:")

    world =
      Enum.reduce(MuaWorld.Components.all(), world, fn component, world ->
        {:ok, world} = OdgnEcs.define(world, component)
        world
      end)

    {:ok, world} =
      OdgnEdl.build(world, File.read!(path), path: path, roots: MuaWorld.Scripts.roots())

    Exits.expand(world)
    world
  end
end
