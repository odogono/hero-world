defmodule MuaWorld.RequestTest do
  use ExUnit.Case, async: true

  alias MuaWorld.Request
  alias OdgnEcsTalk.Values

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
