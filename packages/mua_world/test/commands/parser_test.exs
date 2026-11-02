# Adapted from packages/mua/src/server/mua-world/__test__/commands.test.ts.
defmodule MuaWorld.Commands.ParserTest do
  use ExUnit.Case, async: true

  alias MuaWorld.Commands.{Parser, Verbs}

  defp parse(text), do: Parser.parse(text)

  describe "look" do
    test "parses look and its aliases" do
      assert {:ok, %{verb: "look"} = command} = parse("look")
      refute Map.has_key?(command, :target)
      assert {:ok, %{verb: "look"}} = parse("l")
      assert {:ok, %{verb: "look"}} = parse("examine")
    end

    test "parses look with a noun as examine" do
      assert {:ok, %{verb: "examine", target: "mailbox", target_scope: "here"}} =
               parse("look mailbox")
    end
  end

  describe "move" do
    test "parses go and move with a direction" do
      assert {:ok, %{verb: "move", direction: "north"}} = parse("go north")
      assert {:ok, %{verb: "move", direction: "south"}} = parse("move south")
    end

    test "parses a direction on its own, and its short form" do
      assert {:ok, %{verb: "move", direction: "north"}} = parse("n")
      assert {:ok, %{verb: "move", direction: "south"}} = parse("south")
      assert {:ok, %{verb: "move", direction: "east"}} = parse("e")
      assert {:ok, %{verb: "move", direction: "west"}} = parse("w")
      assert {:ok, %{verb: "move", direction: "northeast"}} = parse("ne")
      assert {:ok, %{verb: "move", direction: "up"}} = parse("go up")
    end

    test "asks where to go without a direction" do
      assert {:error, "Where do you want to go?"} = parse("go")
      assert {:error, "Where do you want to go?"} = parse("go banana")
    end
  end

  describe "errors" do
    test "asks for a command when there is none" do
      assert {:error, "Please enter a command."} = parse("")
      assert {:error, "Please enter a command."} = parse("   ")
    end

    test "names an unknown command" do
      assert {:error, ~s(Unknown command: "foobar")} = parse("foobar")
    end
  end

  describe "verb forms" do
    test "drops articles and keeps multi-word noun phrases" do
      assert {:ok, %{verb: "examine", target: "mailbox"}} = parse("look at the mailbox")

      assert {:ok, %{verb: "examine", target: "small brass lamp"}} =
               parse("examine small brass lamp")
    end

    test "splits a noun phrase at a preposition" do
      assert {:ok,
              %{verb: "unlock", target: "red box", indirect: "brass key", indirect_scope: "inv"}} =
               parse("unlock red box with brass key")
    end

    test "uses the form's scope" do
      assert {:ok, %{verb: "drop", target: "lamp", target_scope: "inv"}} = parse("drop lamp")
    end
  end

  describe "say" do
    test "captures the rest of the input with its case" do
      assert {:ok, %{verb: "say", text: "Hello  there, Bob"}} = parse("say Hello  there, Bob")
    end

    test "treats a leading quote as say" do
      assert {:ok, %{verb: "say", text: "Hi all"}} = parse("'Hi all")
      assert {:ok, %{verb: "say", text: "Hi all"}} = parse(~s("Hi all"))
    end

    test "says to someone" do
      assert {:ok, %{verb: "sayTo", target: "bob", text: "hi", target_scope: "room"}} =
               parse("say to bob hi")
    end

    test "asks what to say when there is nothing" do
      assert {:error, "What do you want to say?"} = parse("say")
    end
  end

  test "keeps the input as typed" do
    assert {:ok, %{verb: "look", raw: "LOOK Around"}} = parse("LOOK Around")
  end

  describe "a world's verbs" do
    @extra [
      %{
        names: ["pray", "kneel"],
        incomplete: "Pray to whom?",
        forms: [
          %{handler: "prayTo", pattern: "to obj", scope: "room", indirect_scope: nil},
          %{handler: "pray", pattern: "", scope: nil, indirect_scope: nil}
        ]
      },
      %{
        names: ["look"],
        incomplete: nil,
        forms: [%{handler: "lookUnder", pattern: "under obj", scope: nil, indirect_scope: nil}]
      }
    ]

    test "add new verbs, and forms to a built-in tried first" do
      vocabulary = Verbs.vocabulary(@extra)

      assert {:ok, %{verb: "pray"}} = Parser.parse("kneel", vocabulary)
      assert {:ok, %{verb: "prayTo", target: "altar"}} = Parser.parse("pray to altar", vocabulary)
      assert {:error, "Pray to whom?"} = Parser.parse("pray to", vocabulary)

      assert {:ok, %{verb: "lookUnder", target: "altar"}} =
               Parser.parse("look under altar", vocabulary)

      assert {:ok, %{verb: "look"}} = Parser.parse("look", vocabulary)
    end
  end

  test "lists every word that starts a command, once" do
    verbs = Verbs.list()

    for word <- ~w(look x take north n again), do: assert(word in verbs)
    assert length(Enum.uniq(verbs)) == length(verbs)
  end
end
