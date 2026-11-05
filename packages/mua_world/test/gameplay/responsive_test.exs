# The responsive base Script answers every Decision the Base Verbs raise.
defmodule MuaWorld.ResponsiveTest do
  use ExUnit.Case, async: true

  import MuaWorld.Case

  @moduletag :tmp_dir

  # A Decision a Verb asks of a thing, not of a Service, reaches a thing's
  # `responses.veto` only through a Handler of its own in responsive.talk
  test "has a Handler for every Decision the Base Verbs ask of a thing", %{tmp_dir: dir} do
    world = start("objects.edl", dir)
    source = File.read!(MuaWorld.Scripts.path("scripts/base/responsive.talk"))

    events =
      for {_verb, vetoes} <- :sys.get_state(world).vocabulary.vetoes,
          %{event: event, asks: asks} <- vetoes,
          not String.starts_with?(asks, "service:"),
          uniq: true,
          do: event

    assert events != []

    for event <- events,
        do:
          assert(source =~ ~r/^on #{event} actor, subject, deciding$/m, "no Handler for #{event}")
  end
end
