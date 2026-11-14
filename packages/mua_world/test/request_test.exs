defmodule MuaWorld.RequestTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias MuaWorld.Request
  alias OdgnEcs.{Column, Component}
  alias OdgnEcsEngine.Delivery
  alias OdgnEcsTalk.Values

  # Each message marks the thing it is given, then replies as its name says
  @probe """
  on accept thing
    change thing, "mark", {n: 1}
    return "Done."
  end accept

  on refuse thing
    change thing, "mark", {n: 1}
    return {refused: "No."}
  end refuse

  on garble thing
    change thing, "mark", {n: 1}
    return {nonsense: 1}
  end garble

  on dawdle thing
    change thing, "mark", {n: 1}
    wait 2 s
    return "Late."
  end dawdle

  on crash thing
    change thing, "mark", {n: 1}
    repeat forever
    end repeat
  end crash
  """

  defp engine do
    {:ok, world} = OdgnEcs.open(":memory:")
    mark = %Component{name: "mark", columns: [%Column{name: "n", type: :int}]}

    world =
      Enum.reduce(OdgnEcsTalk.components() ++ [mark], world, fn c, w ->
        elem(OdgnEcs.define(w, c), 1)
      end)

    {:ok, talk} = OdgnEcsTalk.start(world, limits: [fuel_per_run: 5_000])
    :ok = OdgnEcsTalk.put_service_script(talk, "probe", @probe)
    {:ok, thing} = OdgnEcs.create(world)
    {OdgnEcsEngine.new(world, talk), thing}
  end

  # Asks the probe `message` about the thing in one Step, reading text as
  # accepted, and returns what `ask/3` did and every mark in the World
  # after the Step's commit
  defp ask(message, setup \\ fn _ -> :ok end) do
    {engine, thing} = engine()

    {{:ok, %{result: result}}, engine} =
      OdgnEcsEngine.step(engine, fn step ->
        Request.ask(
          step,
          fn ->
            with :ok <- setup.(step) do
              {:ok,
               %Delivery{
                 to: {:service, "probe"},
                 message: message,
                 args: [OdgnEcsTalk.handle(step.talk, thing)]
               }}
            end
          end,
          fn
            text when is_binary(text) -> {:ok, text}
            _ -> :error
          end
        )
      end)

    marks =
      for eid <- OdgnEcs.query(engine.world, with: ["mark"]),
          do: OdgnEcs.get(engine.world, eid, "mark")

    {result, marks}
  end

  describe "ask/3" do
    test "an accepted reply keeps what the Script did" do
      assert ask("accept") == {{:ok, "Done."}, [%{"n" => 1}]}
    end

    test "a refusal undoes what the Script did" do
      assert ask("refuse") == {{:refused, "No."}, []}
    end

    test "a reply the asker can't read undoes it, and is logged" do
      log = capture_log(fn -> assert {{:failed, {:malformed, _}}, []} = ask("garble") end)
      assert log =~ "garble to probe replied {nonsense: 1}"
    end

    test "a Run left waiting is abandoned, and undoes what it did" do
      capture_log(fn -> assert ask("dawdle") == {{:failed, :waiting}, []} end)
    end

    test "a Script that fails undoes what it did, and is logged" do
      log = capture_log(fn -> assert {{:failed, {:failed, _}}, []} = ask("crash") end)
      assert log =~ "crash to probe failed"
    end

    test "a setup that fails undoes what it did, and sends nothing" do
      setup = fn step ->
        {:ok, other} = OdgnEcs.create(step.world)
        :ok = OdgnEcs.put(step.world, other, "mark", %{"n" => 2})
        {:error, :nope}
      end

      assert ask("accept", setup) == {{:failed, {:error, :nope}}, []}
    end
  end

  describe "reply/1" do
    test "a refusal says no with its text" do
      assert Request.reply({:replied, Values.to_value(%{"refused" => "Not now."})}) ==
               {:refused, "Not now."}
    end

    test "a refusal that isn't text is malformed" do
      value = Values.to_value(%{"refused" => 3})
      assert Request.reply({:replied, value}) == {:malformed, value}
    end

    test "any other reply is the asker's to read" do
      for value <- ["Done.", nil, 3, Values.to_value(%{"message" => "Placed."})] do
        assert Request.reply({:replied, value}) == {:replied, value}
      end
    end

    test "a Run that didn't reply failed" do
      for outcome <- [:waiting, {:error, :boom}, :passed] do
        assert Request.reply(outcome) == {:failed, outcome}
      end
    end
  end
end
