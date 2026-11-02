defmodule MuaWorld.Fixture do
  @moduledoc false
  # A chapel with a statue, a lever, a candle and a sexton. Entity 1 is the
  # Character.

  @room """
  -- Every room: answers `look` for the room that received it.
  on look who
    put the name of the target into out
    put out & ". " & the description of the target into out
    put out & " It holds " & the number of elements of the target & " things." into out
    return out
  end look

  on heard who, words
    if words is "hello" then
      ask world to announce the target, "The walls echo: hello."
    end if
  end heard
  """

  @chapel """
  -- The chapel itself passes `look` on to every room.
  on look who
    pass look
  end look

  on pull who, what
    put element what of the target otherwise nothing into thing
    if thing is nothing then
      return "There is no " & what & " to pull."
    end if
    ask world to change thing, "pulled", true
    ask world to notify who, "You pull the " & what & "."
    return ""
  end pull

  on smash who, what
    ask world to change the target, "smashed", true
    repeat forever
    end repeat
  end smash

  on pray who, what
    ask world to notify who, "You begin to pray."
    wait 5 s
    ask world to notify who, "Your prayer is answered."
    return ""
  end pray

  on ring who, what
    put element "Sexton" of the target into sexton
    ask world to startTimer sexton, 2, "chime"
    return "You set the bell swinging."
  end ring
  """

  @heavy """
  on taking who, thing, deciding
    veto "It is far too heavy."
  end taking
  """

  @sexton """
  on chime
    ask world to announce the location of me, "The bell chimes."
  end chime
  """

  def world do
    %{
      atoms: [
        %{name: "thing"},
        %{name: "room", parent: "thing", script: @room},
        %{name: "chapel", parent: "room", script: @chapel},
        %{name: "heavy", parent: "thing", script: @heavy}
      ],
      entities: [
        %{id: 1, name: "Ada", atom: "thing", location: 10, character: true},
        %{id: 10, name: "Chapel", atom: "chapel", components: %{description: "Candles flicker."}},
        %{id: 11, name: "statue", atom: "heavy", location: 10},
        %{id: 12, name: "lever", atom: "thing", location: 10},
        %{id: 13, name: "candle", atom: "thing", location: 10},
        %{id: 14, name: "Sexton", atom: "thing", location: 10, script: @sexton}
      ]
    }
  end
end
