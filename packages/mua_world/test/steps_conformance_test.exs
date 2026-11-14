# Runs the shared mua Step cases in spec/mua/steps (ADR 0024): what each
# Command a Character types does, Actions and all. The TypeScript Host runs
# the same files. With MUA_STEPS_RECORD=1 set, it prints what each step gave
# instead of checking it, for writing a new case.
defmodule MuaWorld.StepsConformanceTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir
  @spec_dir Path.expand("../../../spec/mua/steps", __DIR__)

  for file <- Path.wildcard(Path.join(@spec_dir, "*.json")) do
    @external_resource file
    spec = file |> File.read!() |> JSON.decode!()

    describe Path.relative_to(file, @spec_dir) do
      for c <- spec["cases"] do
        test c["name"], %{tmp_dir: dir} do
          run_case(unquote(Macro.escape(spec)), unquote(Macro.escape(c)), dir)
        end
      end
    end
  end

  defp record?, do: System.get_env("MUA_STEPS_RECORD") == "1"

  defp run_case(spec, c, dir) do
    world =
      start(Path.join(@spec_dir, spec["edl"]), dir, starting_room: spec["starting_room"])

    characters = for name <- c["join"], into: %{}, do: {name, join(world, name)}
    # what joining told everyone is not the case's
    for {_, eid} <- characters, do: received(eid)

    if record?(), do: IO.puts("\n== #{c["name"]}")

    Process.put(:names, for(%{"where" => w} <- c["steps"], {_, place} <- w, do: place))

    for step <- c["steps"] do
      actual = run_step(world, characters, step)

      if record?() do
        IO.puts(
          JSON.encode!(Map.merge(Map.take(step, ["as", "type", "advance", "mirror"]), actual))
        )
      else
        check(step, actual)
      end
    end
  end

  defp run_step(world, characters, %{"as" => name, "type" => text}) do
    {:ok, told} = MuaWorld.command(world, account(characters[name]), characters[name], text)
    told = Enum.map(told, &as_spec/1)
    %{"told" => told, "heard" => heard(characters, {name, told})}
  end

  defp run_step(world, characters, %{"advance" => seconds}) do
    :ok = run_for(world, seconds)
    %{"heard" => heard(characters, nil)}
  end

  # The Character's mirror snapshot, by label (`labelled/3`)
  defp run_step(world, characters, %{"mirror" => name}) do
    character = characters[name]
    {:ok, snapshot} = MuaWorld.mirror(world, account(character), character)
    assert snapshot.character == character
    labelled(world, characters, snapshot)
  end

  # Where each thing is: the label of what holds it
  defp run_step(world, characters, %{"where" => where}) do
    %{
      "where" =>
        for {thing, _} <- where, into: %{} do
          place = location(world, eid(world, characters, thing))
          {thing, label(world, characters, place)}
        end
    }
  end

  # Every Character's lines since the last step, for those given any. The
  # typer's subscription also hears what it was told, which `told` has, so
  # those lines are left out of its own
  defp heard(characters, typed) do
    for {name, eid} <- characters,
        lines = Enum.map(received(eid), &as_spec/1),
        lines =
          (case typed do
             {^name, told} -> lines -- told
             _ -> lines
           end),
        lines != [],
        into: %{},
        do: {name, lines}
  end

  # A line as the cases write it: a Picture by its `src`, whose URL
  # changes with the file
  defp as_spec(%{picture: %{src: src}}), do: %{"picture" => src}
  defp as_spec(line), do: line

  defp check(%{"where" => where}, actual), do: assert(actual["where"] == where)

  defp check(%{"mirror" => name} = step, actual),
    do: assert(actual == Map.take(step, ["place", "sees"]), "#{name}: mirror")

  defp check(step, actual) do
    if Map.has_key?(step, "told"),
      do: assert(actual["told"] == step["told"], "#{step["type"]}: told")

    assert actual["heard"] == Map.get(step, "heard", %{}),
           "#{step["type"] || "advance"}: heard"
  end

  # A mirror snapshot as `%{"place" => label, "sees" => %{label => rows}}`:
  # each perceived entity's shown components, with every id a label. An exit
  # with no Definition name is its place's label and its direction, as
  # `hall north`
  defp labelled(world, characters, snapshot) do
    names =
      Map.merge(
        :sys.get_state(world).world
        |> OdgnEdl.definition_names()
        |> Map.new(fn {n, e} -> {e, n} end),
        Map.new(characters, fn {n, e} -> {e, n} end)
      )

    rows = snapshot.components |> Map.values() |> List.flatten()
    label = &mirror_label(&1, names, rows)

    sees =
      for {name, list} <- snapshot.components, row <- list, reduce: %{} do
        acc ->
          fields =
            for {field, value} <- Map.delete(row, "eid"),
                into: %{},
                do: {field, mirror_ref(name, field, value, label)}

          Map.update(acc, label.(row["eid"]), %{name => fields}, &Map.put(&1, name, fields))
      end

    %{"place" => label.(snapshot.place), "sees" => sees}
  end

  defp mirror_label(eid, names, rows) do
    Map.get_lazy(names, eid, fn ->
      at = Enum.find_value(rows, &(&1["eid"] == eid && &1["in"]))
      dir = Enum.find_value(rows, &(&1["eid"] == eid && &1["dir"]))

      (at && is_binary(dir) && "#{mirror_label(at, names, rows)} #{dir}") ||
        flunk("No label for #{eid}")
    end)
  end

  defp mirror_ref("location", "in", value, label), do: label.(value)
  defp mirror_ref("portal", "door", value, label) when value != nil, do: label.(value)
  defp mirror_ref(_, _, value, _), do: value

  # A Character by its join name, or anything else by its Definition name
  defp eid(world, characters, name),
    do: characters[name] || MuaWorld.named(world, name) || flunk("No entity #{name}")

  # A Character's join name, or anything else's Definition name, looked up
  # among the names the case uses
  defp label(world, characters, eid) do
    Enum.find_value(characters, fn {name, e} -> e == eid && name end) ||
      Process.get(:names, [])
      |> Enum.find(&(MuaWorld.named(world, &1) == eid))
  end
end
